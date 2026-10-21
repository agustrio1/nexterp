"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";

type Overtime = {
  id: string; docNo: string | null; employeeId: string; workDate: string;
  startAt: string; endAt: string; hours: string; status: string; reason: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draf", pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak",
};
const DECIMAL_RE = /^\d{1,12}(\.\d{1,2})?$/;

function toIso(local: string): string { return new Date(local).toISOString(); }

export default function HROvertimePage() {
  const refs = useHrRefs();
  const [fEmp, setFEmp] = useState("");
  const [rk, setRk] = useState(0);

  const [emp, setEmp] = useState("");
  const [date, setDate] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [hours, setHours] = useState("1");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (fEmp) params.set("employeeId", fEmp);
  const qs = params.toString();
  const url = qs ? `/api/hr/overtime-requests?${qs}` : "/api/hr/overtime-requests";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) { toast.error("Pilih karyawan."); return; }
    if (!date) { toast.error("Tanggal kerja wajib diisi."); return; }
    if (!startAt || !endAt) { toast.error("Jam mulai/selesai wajib diisi."); return; }
    if (!DECIMAL_RE.test(hours)) { toast.error("Jam lembur desimal tidak valid."); return; }
    const body: Record<string, unknown> = { employeeId: emp, workDate: date, startAt: toIso(startAt), endAt: toIso(endAt), hours };
    if (reason.trim()) body.reason = reason.trim();
    setSaving(true);
    try {
      const res = await fetch("/api/hr/overtime-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Pengajuan lembur dibuat (draf)."); setDate(""); setStartAt(""); setEndAt(""); setReason(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal mengajukan lembur.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onAction(id: string, action: "submit" | "approve" | "reject", okMsg: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/hr/overtime-requests/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success(okMsg); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal memproses pengajuan.");
    } catch { toast.error("Koneksi terganggu."); } finally { setBusyId(null); }
  }

  const columns: Column<Overtime>[] = [
    { header: "No. Dokumen", cell: (r) => <code className="font-mono text-xs">{r.docNo ?? "—"}</code> },
    {
      header: "Karyawan", cell: (r) => {
        const e = refs.empMap.get(r.employeeId);
        return e ? `${e.firstName} ${e.lastName ?? ""} (${e.code})` : "—";
      },
    },
    { header: "Tanggal", cell: (r) => r.workDate.slice(0, 10) },
    { header: "Mulai", cell: (r) => new Date(r.startAt).toLocaleString("id-ID").slice(0, 16) },
    { header: "Selesai", cell: (r) => new Date(r.endAt).toLocaleString("id-ID").slice(0, 16) },
    { header: "Jam", cell: (r) => r.hours },
    { header: "Status", cell: (r) => STATUS_LABEL[r.status] ?? r.status },
    {
      header: "Aksi", className: "w-[200px]", cell: (r) => (
        <div className="flex gap-1">
          {r.status === "draft" && <Button size="sm" variant="outline" loading={busyId === r.id} onClick={() => void onAction(r.id, "submit", "Pengajuan dikirim.")}>Kirim</Button>}
          {r.status === "pending" && <>
            <Button size="sm" variant="outline" loading={busyId === r.id} onClick={() => void onAction(r.id, "approve", "Pengajuan disetujui.")}>Setujui</Button>
            <Button size="sm" variant="outline" loading={busyId === r.id} onClick={() => void onAction(r.id, "reject", "Pengajuan ditolak.")}>Tolak</Button>
          </>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Lembur</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-6">
        <div className="space-y-1"><label className="text-sm font-medium">Karyawan *</label>
          <Select value={emp} onChange={(e) => setEmp(e.target.value)}>
            <option value="">— Pilih —</option>
            {refs.employees.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Tanggal *</label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Jam Mulai *</label><Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Jam Selesai *</label><Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Total Jam *</label><Input value={hours} onChange={(e) => setHours(e.target.value)} /></div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Ajukan</Button></div>
        <div className="space-y-1 sm:col-span-6"><label className="text-sm font-medium">Alasan</label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </form>

      <div className="flex gap-2">
        <Select className="w-56" value={fEmp} onChange={(e) => { setFEmp(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Karyawan</option>
          {refs.employees.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
        </Select>
      </div>
      <DataTable<Overtime> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada pengajuan lembur." />
    </div>
  );
}
