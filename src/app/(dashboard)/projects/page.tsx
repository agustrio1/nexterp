"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import { employeeName, activeEmployees } from "@/app/(dashboard)/hr/_shared";
import { CODE_RE, AMOUNT_RE, DATE_RE, rp, PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE } from "@/app/(dashboard)/projects/_shared";

type Project = {
  id: string; code: string; projectNumber: string | null; name: string; costCenterCode: string;
  branchId: string | null; managerEmployeeId: string | null; startDate: string; endDate: string | null;
  totalBudget: string | null; progressPercent: string; status: string; isActive: boolean;
};

const STATUSES = ["planning", "in_progress", "on_hold", "completed", "cancelled"] as const;

export default function ProjectsPage() {
  const refs = useHrRefs();
  const [fStatus, setFStatus] = useState("");
  const [fBranch, setFBranch] = useState("");
  const [fActive, setFActive] = useState("");
  const [rk, setRk] = useState(0);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [branchId, setBranchId] = useState("");
  const [manager, setManager] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState("");
  const [status, setStatus] = useState<string>("planning");
  const [saving, setSaving] = useState(false);

  const params = new URLSearchParams();
  if (fStatus) params.set("status", fStatus);
  if (fBranch) params.set("branchId", fBranch);
  if (fActive) params.set("isActive", fActive);
  const qs = params.toString();
  const url = qs ? `/api/projects?${qs}` : "/api/projects";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code.trim().toUpperCase())) { toast.error("Kode proyek tidak valid."); return; }
    if (name.trim().length < 2) { toast.error("Nama proyek minimal 2 karakter."); return; }
    if (!startDate || !DATE_RE.test(startDate)) { toast.error("Tanggal mulai wajib (YYYY-MM-DD)."); return; }
    if (endDate && !DATE_RE.test(endDate)) { toast.error("Tanggal selesai tidak valid."); return; }
    if (budget && !AMOUNT_RE.test(budget)) { toast.error("Anggaran total tidak valid."); return; }
    const body: Record<string, unknown> = { code: code.trim().toUpperCase(), name: name.trim(), startDate, status };
    if (description.trim()) body.description = description.trim();
    if (branchId) body.branchId = branchId;
    if (manager) body.managerEmployeeId = manager;
    if (endDate) body.endDate = endDate;
    if (budget) body.totalBudget = budget;
    setSaving(true);
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) {
        toast.success("Proyek dibuat.");
        setCode(""); setName(""); setDescription(""); setBranchId(""); setManager(""); setStartDate(""); setEndDate(""); setBudget(""); setStatus("planning"); setRk((k) => k + 1);
      } else toast.error(j?.error?.message ?? "Gagal membuat proyek.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  const columns: Column<Project>[] = [
    { header: "Kode", cell: (r) => <Link className="font-mono text-xs text-blue-600 hover:underline" href={`/projects/${r.id}`}>{r.code}</Link> },
    { header: "No. Proyek", cell: (r) => <code className="font-mono text-xs">{r.projectNumber ?? "—"}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Cost Center", cell: (r) => r.costCenterCode },
    { header: "Cabang", cell: (r) => (r.branchId ? refs.branchMap.get(r.branchId)?.name ?? "—" : "—") },
    { header: "Manajer", cell: (r) => (r.managerEmployeeId ? employeeName(refs.empMap.get(r.managerEmployeeId)) : "—") },
    { header: "Mulai", cell: (r) => r.startDate },
    { header: "Anggaran", cell: (r) => <span className="font-mono">{rp(r.totalBudget)}</span> },
    { header: "Progres %", cell: (r) => r.progressPercent },
    { header: "Status", cell: (r) => <span className={PROJECT_STATUS_STYLE[r.status] ?? ""}>{PROJECT_STATUS_LABEL[r.status] ?? r.status}</span> },
    { header: "Aksi", className: "w-[90px]", cell: (r) => <Link href={`/projects/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Proyek</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PRJ-001" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Manajer</label>
          <Select value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">—</option>
            {activeEmployees(refs.employees).map((em) => <option key={em.id} value={em.id}>{employeeName(em)}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Tgl. Mulai *</label><Input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="2026-01-01" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Tgl. Selesai</label><Input value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="2026-06-30" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Anggaran Total</label><Input value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Status *</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}</Select>
        </div>
        <div className="space-y-1 sm:col-span-3"><label className="text-sm font-medium">Deskripsi</label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah Proyek</Button></div>
      </form>
      <p className="text-xs text-zinc-500">Tanpa cost center yang ditautkan, sistem membuat cost center baru otomatis (butuh izin pusat biaya).</p>

      <div className="flex flex-wrap gap-2">
        <Select className="w-44" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Status</option>{STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
        </Select>
        <Select className="w-40" value={fBranch} onChange={(e) => { setFBranch(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Cabang</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select className="w-32" value={fActive} onChange={(e) => { setFActive(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
      </div>
      <DataTable<Project> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada proyek." />
    </div>
  );
}
