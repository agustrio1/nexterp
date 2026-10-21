"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";

type Program = { id: string; code: string; name: string; provider: string | null; isActive: boolean };
type Enrollment = { id: string; programId: string; employeeId: string; status: string; completedAt: string | null };

const ENROLL_LABEL: Record<string, string> = {
  enrolled: "Terdaftar", in_progress: "Berjalan", completed: "Selesai", cancelled: "Dibatalkan",
};

export default function HRTrainingPage() {
  const refs = useHrRefs();
  const [rkProg, setRkProg] = useState(0);
  const [rkEnroll, setRkEnroll] = useState(0);
  const [fProgram, setFProgram] = useState("");
  const [programs, setPrograms] = useState<Program[]>([]);

  /* program form */
  const [pCode, setPCode] = useState("");
  const [pName, setPName] = useState("");
  const [pProvider, setPProvider] = useState("");
  const [pSaving, setPSaving] = useState(false);
  const [pEditId, setPEditId] = useState<string | null>(null);
  const [pEditName, setPEditName] = useState("");
  const [pEditProvider, setPEditProvider] = useState("");
  const [pEditActive, setPEditActive] = useState(true);
  const [pEditing, setPEditing] = useState(false);

  /* enrollment form */
  const [eProgram, setEProgram] = useState("");
  const [eEmp, setEEmp] = useState("");
  const [eStatus, setEStatus] = useState("enrolled");
  const [eSaving, setESaving] = useState(false);
  const [enrollEditId, setEnrollEditId] = useState<string | null>(null);
  const [enrollStatus, setEnrollStatus] = useState("enrolled");
  const [enrollEditing, setEnrollEditing] = useState(false);

  async function loadPrograms() {
    try {
      const res = await fetch("/api/hr/training/programs", { credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: Program[] }; setPrograms(j.data); }
    } catch { /* biarkan kosong */ }
  }

  // muat awal daftar program (untuk select & mapping nama) — setState hanya di .then
  useEffect(() => {
    fetch("/api/hr/training/programs", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: Program[] }) => setPrograms(j.data))
      .catch(() => {});
  }, []);

  const progMap = new Map(programs.map((p) => [p.id, p]));

  async function postJson(url: string, method: string, body: Record<string, unknown>, okMsg: string, done: () => void) {
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success(okMsg); await loadPrograms(); done(); }
      else toast.error(j?.error?.message ?? "Gagal.");
    } catch { toast.error("Koneksi terganggu."); }
  }

  async function onCreateProgram(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(pCode.trim().toUpperCase())) { toast.error("Kode 2-20 karakter huruf/angka/strip."); return; }
    if (pName.trim().length < 2) { toast.error("Nama program minimal 2 karakter."); return; }
    setPSaving(true);
    const body: Record<string, unknown> = { code: pCode.trim().toUpperCase(), name: pName.trim() };
    if (pProvider.trim()) body.provider = pProvider.trim();
    await postJson("/api/hr/training/programs", "POST", body, "Program dibuat.", () => {
      setPCode(""); setPName(""); setPProvider(""); setRkProg((k) => k + 1);
    });
    setPSaving(false);
  }

  function startProgEdit(p: Program) {
    setPEditId(p.id); setPEditName(p.name); setPEditProvider(p.provider ?? ""); setPEditActive(p.isActive);
  }

  async function onEditProgram() {
    if (!pEditId) return;
    setPEditing(true);
    const body: Record<string, unknown> = { isActive: pEditActive };
    if (pEditName.trim().length >= 2) body.name = pEditName.trim();
    body.provider = pEditProvider.trim() || null;
    await postJson(`/api/hr/training/programs/${pEditId}`, "PATCH", body, "Program diperbarui.", () => { setPEditId(null); setRkProg((k) => k + 1); });
    setPEditing(false);
  }

  async function onCreateEnrollment(e: React.FormEvent) {
    e.preventDefault();
    if (!eProgram) { toast.error("Pilih program."); return; }
    if (!eEmp) { toast.error("Pilih karyawan."); return; }
    setESaving(true);
    const body: Record<string, unknown> = { programId: eProgram, employeeId: eEmp, status: eStatus };
    await postJson("/api/hr/training/enrollments", "POST", body, "Pendaftaran dibuat.", () => {
      setEEmp(""); setRkEnroll((k) => k + 1);
    });
    setESaving(false);
  }

  async function onEditEnrollment() {
    if (!enrollEditId) return;
    setEnrollEditing(true);
    const body: Record<string, unknown> = { status: enrollStatus };
    if (enrollStatus === "completed") body.completedAt = new Date().toISOString();
    await postJson(`/api/hr/training/enrollments/${enrollEditId}`, "PATCH", body, "Status pendaftaran diperbarui.", () => {
      setEnrollEditId(null); setRkEnroll((k) => k + 1);
    });
    setEnrollEditing(false);
  }

  const progColumns: Column<Program>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Penyelenggara", cell: (r) => r.provider ?? "—" },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Button variant="ghost" size="sm" onClick={() => startProgEdit(r)}>Ubah</Button> },
  ];

  const enrollColumns: Column<Enrollment>[] = [
    { header: "Program", cell: (r) => progMap.get(r.programId)?.name ?? "—" },
    {
      header: "Karyawan", cell: (r) => {
        const e = refs.empMap.get(r.employeeId);
        return e ? `${e.firstName} ${e.lastName ?? ""} (${e.code})` : "—";
      },
    },
    { header: "Status", cell: (r) => ENROLL_LABEL[r.status] ?? r.status },
    { header: "Selesai Pada", cell: (r) => (r.completedAt ? new Date(r.completedAt).toLocaleString("id-ID").slice(0, 16) : "—") },
    {
      header: "Aksi", className: "w-[80px]", cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => { setEnrollEditId(r.id); setEnrollStatus(r.status); }}>Ubah</Button>
      ),
    },
  ];

  const enrollParams = new URLSearchParams();
  if (fProgram) enrollParams.set("programId", fProgram);
  const enrollQs = enrollParams.toString();
  const enrollUrl = enrollQs ? `/api/hr/training/enrollments?${enrollQs}` : "/api/hr/training/enrollments";

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pelatihan</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Program Pelatihan</h2>
        <form onSubmit={onCreateProgram} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={pCode} onChange={(e) => setPCode(e.target.value)} placeholder="TRN-001" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={pName} onChange={(e) => setPName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Penyelenggara</label><Input value={pProvider} onChange={(e) => setPProvider(e.target.value)} /></div>
          <div className="flex items-end"><Button type="submit" loading={pSaving}>Tambah</Button></div>
        </form>
        {pEditId && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-4">
            <div className="space-y-1"><label className="text-sm font-medium">Nama</label><Input value={pEditName} onChange={(e) => setPEditName(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Penyelenggara</label><Input value={pEditProvider} onChange={(e) => setPEditProvider(e.target.value)} /></div>
            <div className="flex flex-col gap-2 pt-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pEditActive} onChange={(e) => setPEditActive(e.target.checked)} /> Aktif</label></div>
            <div className="flex items-end gap-2"><Button size="sm" loading={pEditing} onClick={onEditProgram}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setPEditId(null)}>Batal</Button></div>
          </div>
        )}
        <DataTable<Program> key={rkProg} url="/api/hr/training/programs" columns={progColumns} rowKey={(r) => r.id} emptyMessage="Belum ada program pelatihan." />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Pendaftaran Pelatihan</h2>
        <form onSubmit={onCreateEnrollment} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1"><label className="text-sm font-medium">Program *</label>
            <Select value={eProgram} onChange={(e) => setEProgram(e.target.value)}>
              <option value="">— Pilih —</option>
              {programs.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Karyawan *</label>
            <Select value={eEmp} onChange={(e) => setEEmp(e.target.value)}>
              <option value="">— Pilih —</option>
              {refs.employees.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Status</label>
            <Select value={eStatus} onChange={(e) => setEStatus(e.target.value)}>
              {Object.entries(ENROLL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="flex items-end"><Button type="submit" loading={eSaving}>Daftarkan</Button></div>
        </form>
        {enrollEditId && (
          <div className="flex items-end gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <div className="w-48 space-y-1"><label className="text-sm font-medium">Status Pendaftaran</label>
              <Select value={enrollStatus} onChange={(e) => setEnrollStatus(e.target.value)}>
                {Object.entries(ENROLL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <Button size="sm" loading={enrollEditing} onClick={onEditEnrollment}>Simpan</Button>
            <Button size="sm" variant="ghost" onClick={() => setEnrollEditId(null)}>Batal</Button>
          </div>
        )}
        <div className="flex gap-2">
          <Select className="w-56" value={fProgram} onChange={(e) => { setFProgram(e.target.value); setRkEnroll((k) => k + 1); }}>
            <option value="">Semua Program</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <DataTable<Enrollment> key={rkEnroll} url={enrollUrl} columns={enrollColumns} rowKey={(r) => r.id} emptyMessage="Belum ada pendaftaran pelatihan." />
      </section>
    </div>
  );
}
