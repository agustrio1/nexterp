"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";

type LeaveType = {
  id: string; code: string; name: string; paid: boolean;
  defaultQuotaDays: string | null; requiresApproval: boolean; isActive: boolean;
};
type Balance = {
  id: string; employeeId: string; leaveTypeId: string; year: number; totalDays: string; usedDays: string;
};
type LeaveRequest = {
  id: string; docNo: string | null; employeeId: string; leaveTypeId: string;
  startDate: string; endDate: string; days: string; status: string; reason: string | null;
};

const REQ_LABEL: Record<string, string> = {
  draft: "Draf", pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak", cancelled: "Dibatalkan",
};
const DECIMAL_RE = /^\d{1,12}(\.\d{1,2})?$/;

export default function HRLeavesPage() {
  const refs = useHrRefs();
  const [rkTypes, setRkTypes] = useState(0);
  const [rkBal, setRkBal] = useState(0);
  const [rkReq, setRkReq] = useState(0);
  const [reqEmp, setReqEmp] = useState("");

  const [types, setTypes] = useState<LeaveType[]>([]);

  useEffect(() => {
    fetch("/api/hr/leave-types", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: LeaveType[] }) => setTypes(j.data))
      .catch(() => {});
  }, [rkTypes]);

  const typeMap = new Map(types.map((t) => [t.id, t.name]));
  const activeTypes = types.filter((t) => t.isActive);

  /* ---- form jenis cuti ---- */
  const [tCode, setTCode] = useState("");
  const [tName, setTName] = useState("");
  const [tPaid, setTPaid] = useState(true);
  const [tQuota, setTQuota] = useState("12");
  const [tApproval, setTApproval] = useState(true);
  const [tSaving, setTSaving] = useState(false);
  const [tEditId, setTEditId] = useState<string | null>(null);
  const [tEditName, setTEditName] = useState("");
  const [tEditPaid, setTEditPaid] = useState(true);
  const [tEditQuota, setTEditQuota] = useState("");
  const [tEditApproval, setTEditApproval] = useState(true);
  const [tEditActive, setTEditActive] = useState(true);
  const [tEditing, setTEditing] = useState(false);

  /* ---- form saldo ---- */
  const [bEmp, setBEmp] = useState("");
  const [bType, setBType] = useState("");
  const [bYear, setBYear] = useState(String(new Date().getFullYear()));
  const [bTotal, setBTotal] = useState("12");
  const [bSaving, setBSaving] = useState(false);

  /* ---- form pengajuan ---- */
  const [rEmp, setREmp] = useState("");
  const [rType, setRType] = useState("");
  const [rStart, setRStart] = useState("");
  const [rEnd, setREnd] = useState("");
  const [rDays, setRDays] = useState("1");
  const [rReason, setRReason] = useState("");
  const [rSaving, setRSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function post(url: string, body: Record<string, unknown>, okMsg: string, done: () => void) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success(okMsg); done(); }
      else toast.error(j?.error?.message ?? "Gagal.");
    } catch { toast.error("Koneksi terganggu."); }
    return true;
  }

  async function patch(url: string, body: Record<string, unknown>, okMsg: string, done: () => void) {
    try {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success(okMsg); done(); }
      else toast.error(j?.error?.message ?? "Gagal.");
    } catch { toast.error("Koneksi terganggu."); }
    return true;
  }

  async function onCreateType(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(tCode.trim().toUpperCase())) { toast.error("Kode 2-20 karakter huruf/angka/strip."); return; }
    if (tName.trim().length < 2) { toast.error("Nama jenis cuti minimal 2 karakter."); return; }
    if (tQuota && !DECIMAL_RE.test(tQuota)) { toast.error("Kuota desimal maks 2 angka di koma."); return; }
    setTSaving(true);
    const body: Record<string, unknown> = { code: tCode.trim().toUpperCase(), name: tName.trim(), paid: tPaid, requiresApproval: tApproval };
    if (tQuota) body.defaultQuotaDays = tQuota;
    await post("/api/hr/leave-types", body, "Jenis cuti dibuat.", () => {
      setTCode(""); setTName(""); setRkTypes((k) => k + 1);
    });
    setTSaving(false);
  }

  function startTypeEdit(t: LeaveType) {
    setTEditId(t.id); setTEditName(t.name); setTEditPaid(t.paid);
    setTEditQuota(t.defaultQuotaDays ?? ""); setTEditApproval(t.requiresApproval); setTEditActive(t.isActive);
  }

  async function onEditType() {
    if (!tEditId) return;
    if (tEditQuota && !DECIMAL_RE.test(tEditQuota)) { toast.error("Kuota desimal maks 2 angka di koma."); return; }
    setTEditing(true);
    const body: Record<string, unknown> = { paid: tEditPaid, requiresApproval: tEditApproval, isActive: tEditActive };
    if (tEditName.trim().length >= 2) body.name = tEditName.trim();
    body.defaultQuotaDays = tEditQuota || null;
    await patch(`/api/hr/leave-types/${tEditId}`, body, "Jenis cuti diperbarui.", () => { setTEditId(null); setRkTypes((k) => k + 1); });
    setTEditing(false);
  }

  async function onSetBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!bEmp) { toast.error("Pilih karyawan."); return; }
    if (!bType) { toast.error("Pilih jenis cuti."); return; }
    if (!/^(19|20)\d{2}$/.test(bYear)) { toast.error("Tahun 1900-9999."); return; }
    if (!DECIMAL_RE.test(bTotal)) { toast.error("Total hari desimal tidak valid."); return; }
    setBSaving(true);
    await post("/api/hr/leave-balances", { employeeId: bEmp, leaveTypeId: bType, year: Number(bYear), totalDays: bTotal }, "Saldo cuti disimpan.", () => setRkBal((k) => k + 1));
    setBSaving(false);
  }

  async function onCreateRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!rEmp) { toast.error("Pilih karyawan."); return; }
    if (!rType) { toast.error("Pilih jenis cuti."); return; }
    if (!rStart || !rEnd) { toast.error("Tanggal mulai/selesai wajib diisi."); return; }
    if (rEnd < rStart) { toast.error("Tanggal selesai tidak boleh sebelum mulai."); return; }
    if (!DECIMAL_RE.test(rDays)) { toast.error("Jumlah hari desimal tidak valid."); return; }
    setRSaving(true);
    const body: Record<string, unknown> = { employeeId: rEmp, leaveTypeId: rType, startDate: rStart, endDate: rEnd, days: rDays };
    if (rReason.trim()) body.reason = rReason.trim();
    await post("/api/hr/leave-requests", body, "Pengajuan cuti dibuat (draf).", () => {
      setRStart(""); setREnd(""); setRReason(""); setRkReq((k) => k + 1);
    });
    setRSaving(false);
  }

  async function onAction(id: string, action: "submit" | "approve" | "reject" | "cancel", okMsg: string) {
    setBusyId(id);
    await post(`/api/hr/leave-requests/${id}`, { action }, okMsg, () => { setRkReq((k) => k + 1); setRkBal((k) => k + 1); });
    setBusyId(null);
  }

  const empCell = (id: string) => {
    const e = refs.empMap.get(id);
    return e ? `${e.firstName} ${e.lastName ?? ""} (${e.code})` : "—";
  };

  const typeColumns: Column<LeaveType>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Berbayar", cell: (r) => (r.paid ? "Ya" : "Tidak") },
    { header: "Kuota Default", cell: (r) => r.defaultQuotaDays ?? "—" },
    { header: "Perlu Persetujuan", cell: (r) => (r.requiresApproval ? "Ya" : "Tidak") },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Button variant="ghost" size="sm" onClick={() => startTypeEdit(r)}>Ubah</Button> },
  ];

  const balColumns: Column<Balance>[] = [
    { header: "Karyawan", cell: (r) => empCell(r.employeeId) },
    { header: "Jenis Cuti", cell: (r) => typeMap.get(r.leaveTypeId) ?? "—" },
    { header: "Tahun", cell: (r) => r.year },
    { header: "Total", cell: (r) => r.totalDays },
    { header: "Terpakai", cell: (r) => r.usedDays },
    { header: "Sisa", cell: (r) => (Number(r.totalDays) - Number(r.usedDays)).toFixed(1) },
  ];

  const reqColumns: Column<LeaveRequest>[] = [
    { header: "No. Dokumen", cell: (r) => <code className="font-mono text-xs">{r.docNo ?? "—"}</code> },
    { header: "Karyawan", cell: (r) => empCell(r.employeeId) },
    { header: "Jenis", cell: (r) => typeMap.get(r.leaveTypeId) ?? "—" },
    { header: "Periode", cell: (r) => `${r.startDate.slice(0, 10)} — ${r.endDate.slice(0, 10)}` },
    { header: "Hari", cell: (r) => r.days },
    { header: "Status", cell: (r) => REQ_LABEL[r.status] ?? r.status },
    {
      header: "Aksi", className: "w-[240px]", cell: (r) => (
        <div className="flex gap-1">
          {r.status === "draft" && <Button size="sm" variant="outline" loading={busyId === r.id} onClick={() => void onAction(r.id, "submit", "Pengajuan dikirim.")}>Kirim</Button>}
          {r.status === "pending" && <>
            <Button size="sm" variant="outline" loading={busyId === r.id} onClick={() => void onAction(r.id, "approve", "Pengajuan disetujui.")}>Setujui</Button>
            <Button size="sm" variant="outline" loading={busyId === r.id} onClick={() => void onAction(r.id, "reject", "Pengajuan ditolak.")}>Tolak</Button>
          </>}
          {(r.status === "draft" || r.status === "pending") && <Button size="sm" variant="ghost" loading={busyId === r.id} onClick={() => void onAction(r.id, "cancel", "Pengajuan dibatalkan.")}>Batal</Button>}
        </div>
      ),
    },
  ];

  const reqParams = new URLSearchParams();
  if (reqEmp) reqParams.set("employeeId", reqEmp);
  const reqQs = reqParams.toString();
  const reqUrl = reqQs ? `/api/hr/leave-requests?${reqQs}` : "/api/hr/leave-requests";

  const empOptions = refs.employees.filter((x) => x.isActive).map((x) => (
    <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>
  ));

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Cuti</h1>

      {/* ---------------- Jenis Cuti ---------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Jenis Cuti</h2>
        <form onSubmit={onCreateType} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-6">
          <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={tCode} onChange={(e) => setTCode(e.target.value)} placeholder="ANNL" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={tName} onChange={(e) => setTName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Kuota Default</label><Input value={tQuota} onChange={(e) => setTQuota(e.target.value)} /></div>
          <div className="flex flex-col gap-1 pt-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tPaid} onChange={(e) => setTPaid(e.target.checked)} /> Berbayar</label></div>
          <div className="flex flex-col gap-1 pt-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tApproval} onChange={(e) => setTApproval(e.target.checked)} /> Perlu Persetujuan</label></div>
          <div className="flex items-end"><Button type="submit" loading={tSaving}>Tambah</Button></div>
        </form>
        {tEditId && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-6">
            <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama</label><Input value={tEditName} onChange={(e) => setTEditName(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Kuota Default</label><Input value={tEditQuota} onChange={(e) => setTEditQuota(e.target.value)} /></div>
            <div className="flex flex-col gap-1 pt-5">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tEditPaid} onChange={(e) => setTEditPaid(e.target.checked)} /> Berbayar</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tEditApproval} onChange={(e) => setTEditApproval(e.target.checked)} /> Persetujuan</label>
            </div>
            <div className="flex flex-col gap-1 pt-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tEditActive} onChange={(e) => setTEditActive(e.target.checked)} /> Aktif</label></div>
            <div className="flex items-end gap-2"><Button size="sm" loading={tEditing} onClick={onEditType}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setTEditId(null)}>Batal</Button></div>
          </div>
        )}
        <DataTable<LeaveType> key={rkTypes} url="/api/hr/leave-types" columns={typeColumns} rowKey={(r) => r.id} emptyMessage="Belum ada jenis cuti." />
      </section>

      {/* ---------------- Saldo Cuti ---------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Saldo Cuti</h2>
        <form onSubmit={onSetBalance} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-5">
          <div className="space-y-1"><label className="text-sm font-medium">Karyawan *</label>
            <Select value={bEmp} onChange={(e) => setBEmp(e.target.value)}>
              <option value="">— Pilih —</option>
              {empOptions}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Jenis Cuti *</label>
            <Select value={bType} onChange={(e) => setBType(e.target.value)}>
              <option value="">— Pilih —</option>
              {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Tahun *</label><Input value={bYear} onChange={(e) => setBYear(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Total Hari *</label><Input value={bTotal} onChange={(e) => setBTotal(e.target.value)} /></div>
          <div className="flex items-end"><Button type="submit" loading={bSaving}>Simpan Saldo</Button></div>
        </form>
        <DataTable<Balance> key={rkBal} url="/api/hr/leave-balances" columns={balColumns} rowKey={(r) => r.id} emptyMessage="Belum ada saldo cuti." />
      </section>

      {/* ---------------- Pengajuan Cuti ---------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Pengajuan Cuti</h2>
        <form onSubmit={onCreateRequest} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-6">
          <div className="space-y-1"><label className="text-sm font-medium">Karyawan *</label>
            <Select value={rEmp} onChange={(e) => setREmp(e.target.value)}>
              <option value="">— Pilih —</option>
              {empOptions}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Jenis Cuti *</label>
            <Select value={rType} onChange={(e) => setRType(e.target.value)}>
              <option value="">— Pilih —</option>
              {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Mulai *</label><Input type="date" value={rStart} onChange={(e) => setRStart(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Selesai *</label><Input type="date" value={rEnd} onChange={(e) => setREnd(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Jumlah Hari *</label><Input value={rDays} onChange={(e) => setRDays(e.target.value)} /></div>
          <div className="flex items-end"><Button type="submit" loading={rSaving}>Ajukan</Button></div>
          <div className="space-y-1 sm:col-span-6"><label className="text-sm font-medium">Alasan</label><Input value={rReason} onChange={(e) => setRReason(e.target.value)} /></div>
        </form>
        <div className="flex gap-2">
          <Select className="w-56" value={reqEmp} onChange={(e) => { setReqEmp(e.target.value); setRkReq((k) => k + 1); }}>
            <option value="">Semua Karyawan</option>
            {refs.employees.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
          </Select>
        </div>
        <DataTable<LeaveRequest> key={rkReq} url={reqUrl} columns={reqColumns} rowKey={(r) => r.id} emptyMessage="Belum ada pengajuan cuti." />
      </section>
    </div>
  );
}
