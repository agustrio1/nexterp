"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import { employeeName, activeEmployees } from "@/app/(dashboard)/hr/_shared";
import {
  rp, AMOUNT_RE, RATE_RE, DATE_RE, PERIOD_KEY_RE,
  PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE, TASK_STATUS_LABEL, TASK_STATUS_STYLE,
} from "@/app/(dashboard)/projects/_shared";

type ProjectDetail = {
  id: string; code: string; projectNumber: string | null; name: string; description: string | null;
  costCenterCode: string; costCenterName: string; branchId: string | null; managerEmployeeId: string | null;
  managerName: string | null; startDate: string; endDate: string | null; totalBudget: string | null;
  progressPercent: string; status: string; isActive: boolean;
};
type Task = { id: string; name: string; assigneeEmployeeId: string | null; status: string; sortOrder: number; weightPercent: string; dueDate: string | null; notes: string | null };
type Milestone = { id: string; name: string; dueDate: string | null; isCompleted: boolean; notes: string | null };
type Assignment = { id: string; employeeId: string; employeeCode: string; employeeName: string; role: string };
type Budget = { id: string; accountId: string | null; accountCode: string | null; accountName: string | null; periodKey: string | null; amount: string; notes: string | null };

const STATUSES = ["planning", "in_progress", "on_hold", "completed", "cancelled"] as const;
const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;

async function readErr(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Gagal (${res.status}).`;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const refs = useHrRefs();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [rk, setRk] = useState(0);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [branchId, setBranchId] = useState("");
  const [manager, setManager] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState("");
  const [status, setStatus] = useState("planning");
  const [isActive, setIsActive] = useState(true);

  const [tName, setTName] = useState("");
  const [tAssignee, setTAssignee] = useState("");
  const [tWeight, setTWeight] = useState("");
  const [tDue, setTDue] = useState("");

  const [msName, setMsName] = useState("");
  const [msDue, setMsDue] = useState("");

  const [asEmp, setAsEmp] = useState("");
  const [asRole, setAsRole] = useState("");

  const [bPeriod, setBPeriod] = useState("");
  const [bAmount, setBAmount] = useState("");

  const [pManual, setPManual] = useState(false);
  const [pPercent, setPPercent] = useState("");

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`, { credentials: "same-origin" });
    if (res.ok) { const j = (await res.json()) as { data: ProjectDetail }; setProject(j.data); }
    setRk((k) => k + 1);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/projects/${id}`, { credentials: "same-origin" })
      .then((res) => res.ok ? res.json() as Promise<{ data: ProjectDetail }> : Promise.reject(new Error(String(res.status))))
      .then((j) => {
        const p = j.data;
        setProject(p); setLoading(false);
        setName(p.name); setDescription(p.description ?? ""); setBranchId(p.branchId ?? ""); setManager(p.managerEmployeeId ?? "");
        setStartDate(p.startDate); setEndDate(p.endDate ?? ""); setBudget(p.totalBudget ?? ""); setStatus(p.status); setIsActive(p.isActive);
      })
      .catch(() => { toast.error("Gagal memuat proyek."); setLoading(false); });
  }, [id]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!project) return <p className="text-zinc-500">Proyek tidak ditemukan.</p>;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Proyek diperbarui."); await refetch(); }
      else toast.error(await readErr(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setBusy(false); }
  }

  function onSave() {
    if (name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    const body: Record<string, unknown> = {
      name: name.trim(), status, isActive,
      description: description.trim() || null,
      branchId: branchId || null,
      managerEmployeeId: manager || null,
      endDate: endDate || null,
      totalBudget: budget || null,
    };
    if (startDate) body.startDate = startDate;
    void patch(body);
  }

  async function send(path: string, method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success(okMsg); await refetch(); }
      else toast.error(await readErr(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setBusy(false); }
  }

  function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (tName.trim().length < 2) { toast.error("Nama tugas minimal 2 karakter."); return; }
    if (tWeight && !RATE_RE.test(tWeight)) { toast.error("Bobot tidak valid (maks 5 digit, 4 desimal)."); return; }
    if (tDue && !DATE_RE.test(tDue)) { toast.error("Jatuh tempo tidak valid."); return; }
    const body: Record<string, unknown> = { name: tName.trim() };
    if (tAssignee) body.assigneeEmployeeId = tAssignee;
    if (tWeight) body.weightPercent = tWeight;
    if (tDue) body.dueDate = tDue;
    void send(`/api/projects/${id}/tasks`, "POST", body, "Tugas dibuat.");
    setTName(""); setTAssignee(""); setTWeight(""); setTDue("");
  }

  function createMilestone(e: React.FormEvent) {
    e.preventDefault();
    if (msName.trim().length < 2) { toast.error("Nama milestone minimal 2 karakter."); return; }
    const body: Record<string, unknown> = { name: msName.trim() };
    if (msDue) body.dueDate = msDue;
    void send(`/api/projects/${id}/milestones`, "POST", body, "Milestone dibuat.");
    setMsName(""); setMsDue("");
  }

  function createAssignment(e: React.FormEvent) {
    e.preventDefault();
    if (!asEmp) { toast.error("Pilih karyawan."); return; }
    if (asRole.trim().length < 2) { toast.error("Peran minimal 2 karakter."); return; }
    void send(`/api/projects/${id}/assignments`, "POST", { employeeId: asEmp, role: asRole.trim() }, "Penugasan dibuat.");
    setAsEmp(""); setAsRole("");
  }

  function createBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!AMOUNT_RE.test(bAmount)) { toast.error("Nominal anggaran tidak valid."); return; }
    if (bPeriod && !PERIOD_KEY_RE.test(bPeriod)) { toast.error("Periode harus YYYY-MM."); return; }
    const body: Record<string, unknown> = { amount: bAmount };
    if (bPeriod) body.periodKey = bPeriod;
    void send(`/api/projects/${id}/budgets`, "POST", body, "Anggaran ditambahkan.");
    setBPeriod(""); setBAmount("");
  }

  function updateProgress() {
    const body: Record<string, unknown> = {};
    if (pManual) {
      if (!RATE_RE.test(pPercent)) { toast.error("Progres tidak valid (0-100)."); return; }
      body.progressPercent = pPercent;
    }
    void send(`/api/projects/${id}/progress`, "POST", body, "Progres diperbarui.");
  }

  const taskCols: Column<Task>[] = [
    { header: "#", cell: (r) => r.sortOrder },
    { header: "Tugas", cell: (r) => r.name },
    { header: "Penanggung Jawab", cell: (r) => (r.assigneeEmployeeId ? employeeName(refs.empMap.get(r.assigneeEmployeeId)) : "—") },
    { header: "Bobot %", cell: (r) => r.weightPercent },
    { header: "Jatuh Tempo", cell: (r) => r.dueDate ?? "—" },
    { header: "Status", cell: (r) => <span className={TASK_STATUS_STYLE[r.status] ?? ""}>{TASK_STATUS_LABEL[r.status] ?? r.status}</span> },
    {
      header: "Aksi", className: "w-[160px]", cell: (r) => (
        <Select className="w-36" value={r.status} onChange={(e) => void send(`/api/projects/${id}/tasks/${r.id}`, "PATCH", { status: e.target.value }, "Status tugas diperbarui.")}>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
        </Select>
      ),
    },
  ];
  const msCols: Column<Milestone>[] = [
    { header: "Milestone", cell: (r) => r.name },
    { header: "Jatuh Tempo", cell: (r) => r.dueDate ?? "—" },
    { header: "Catatan", cell: (r) => r.notes ?? "—" },
    {
      header: "Selesai", cell: (r) => (
        <input type="checkbox" checked={r.isCompleted} onChange={(e) => void send(`/api/projects/${id}/milestones/${r.id}`, "PATCH", { isCompleted: e.target.checked }, "Milestone diperbarui.")} />
      ),
    },
  ];
  const asCols: Column<Assignment>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.employeeCode}</code> },
    { header: "Karyawan", cell: (r) => r.employeeName },
    { header: "Peran", cell: (r) => r.role },
    {
      header: "Aksi", className: "w-[100px]", cell: (r) => (
        <Button size="sm" variant="ghost" onClick={() => void send(`/api/projects/${id}/assignments/${r.id}`, "DELETE", {}, "Penugasan dicabut.")}>Cabut</Button>
      ),
    },
  ];
  const bCols: Column<Budget>[] = [
    { header: "Akun", cell: (r) => (r.accountCode ? `${r.accountCode} — ${r.accountName ?? ""}` : "Agregat") },
    { header: "Periode", cell: (r) => r.periodKey ?? "—" },
    { header: "Nominal", cell: (r) => <span className="font-mono">{rp(r.amount)}</span> },
    {
      header: "Aksi", className: "w-[100px]", cell: (r) => (
        <Button size="sm" variant="ghost" onClick={() => void send(`/api/projects/${id}/budgets/${r.id}`, "DELETE", {}, "Anggaran dihapus.")}>Hapus</Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Daftar Proyek
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <code className="font-mono">{project.code}</code> — {project.name}{" "}
          <span className={PROJECT_STATUS_STYLE[project.status] ?? ""}>{PROJECT_STATUS_LABEL[project.status] ?? project.status}</span>
        </h1>
        <span className="text-sm text-zinc-500">Progres: <b className="font-mono">{project.progressPercent}%</b></span>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-4">
        <div><p className="text-zinc-500">No. Proyek</p><p className="font-mono font-medium">{project.projectNumber ?? "—"}</p></div>
        <div><p className="text-zinc-500">Cost Center</p><p className="font-medium">{project.costCenterCode}</p></div>
        <div><p className="text-zinc-500">Manajer</p><p className="font-medium">{project.managerName ?? "—"}</p></div>
        <div><p className="text-zinc-500">Anggaran Total</p><p className="font-mono font-medium">{rp(project.totalBudget)}</p></div>
      </div>

      <section className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Manajer</label>
          <Select value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">—</option>{activeEmployees(refs.employees).map((em) => <option key={em.id} value={em.id}>{employeeName(em)}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Tgl. Mulai</label><Input value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Tgl. Selesai</label><Input value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Anggaran Total</label><Input value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Status</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}</Select>
        </div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Deskripsi</label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="flex items-center"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label></div>
        <div className="flex items-end"><Button loading={busy} onClick={onSave}>Simpan</Button></div>
      </section>

      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pManual} onChange={(e) => setPManual(e.target.checked)} /> Progres manual</label></div>
        {pManual && <div className="space-y-1"><label className="text-sm font-medium">Progres %</label><Input className="w-28" value={pPercent} onChange={(e) => setPPercent(e.target.value)} /></div>}
        <Button size="sm" loading={busy} onClick={updateProgress}>{pManual ? "Set Progres" : "Hitung dari Tugas"}</Button>
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Tugas</h2>
        <form onSubmit={createTask} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={tName} onChange={(e) => setTName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Penanggung Jawab</label>
            <Select value={tAssignee} onChange={(e) => setTAssignee(e.target.value)}>
              <option value="">—</option>{activeEmployees(refs.employees).map((em) => <option key={em.id} value={em.id}>{employeeName(em)}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Bobot %</label><Input className="w-24" value={tWeight} onChange={(e) => setTWeight(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Jatuh Tempo</label><Input value={tDue} onChange={(e) => setTDue(e.target.value)} placeholder="2026-03-01" /></div>
          <Button type="submit" size="sm" loading={busy}>Tambah</Button>
        </form>
        <DataTable<Task> key={`t${rk}`} url={`/api/projects/${id}/tasks`} columns={taskCols} rowKey={(r) => r.id} emptyMessage="Belum ada tugas." />
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Milestone</h2>
        <form onSubmit={createMilestone} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={msName} onChange={(e) => setMsName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Jatuh Tempo</label><Input value={msDue} onChange={(e) => setMsDue(e.target.value)} placeholder="2026-03-01" /></div>
          <Button type="submit" size="sm" loading={busy}>Tambah</Button>
        </form>
        <DataTable<Milestone> key={`m${rk}`} url={`/api/projects/${id}/milestones`} columns={msCols} rowKey={(r) => r.id} emptyMessage="Belum ada milestone." />
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Penugasan Tim</h2>
        <form onSubmit={createAssignment} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><label className="text-sm font-medium">Karyawan *</label>
            <Select value={asEmp} onChange={(e) => setAsEmp(e.target.value)}>
              <option value="">—</option>{activeEmployees(refs.employees).map((em) => <option key={em.id} value={em.id}>{employeeName(em)}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Peran *</label><Input value={asRole} onChange={(e) => setAsRole(e.target.value)} placeholder="Anggota" /></div>
          <Button type="submit" size="sm" loading={busy}>Tugaskan</Button>
        </form>
        <DataTable<Assignment> key={`a${rk}`} url={`/api/projects/${id}/assignments`} columns={asCols} rowKey={(r) => r.id} emptyMessage="Belum ada penugasan." />
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Anggaran Proyek</h2>
        <form onSubmit={createBudget} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><label className="text-sm font-medium">Periode (YYYY-MM)</label><Input value={bPeriod} onChange={(e) => setBPeriod(e.target.value)} placeholder="2026-01" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nominal *</label><Input value={bAmount} onChange={(e) => setBAmount(e.target.value)} /></div>
          <Button type="submit" size="sm" loading={busy}>Tambah</Button>
        </form>
        <DataTable<Budget> key={`b${rk}`} url={`/api/projects/${id}/budgets`} columns={bCols} rowKey={(r) => r.id} emptyMessage="Belum ada anggaran." />
      </section>
    </div>
  );
}
