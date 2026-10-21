"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import { employeeName } from "@/app/(dashboard)/hr/_shared";

type Attendance = {
  id: string; employeeId: string; workDate: string; shiftId: string | null;
  checkInAt: string | null; checkOutAt: string | null; status: string;
  overtimeMinutes: number; notes: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  present: "Hadir", absent: "Alpa", late: "Terlambat", leave: "Cuti", sick: "Sakit", permit: "Izin",
};

/** ISO datetime dari <input type="datetime-local"> (waktu lokal → UTC). */
function toIso(local: string): string { return new Date(local).toISOString(); }

export default function HRAttendancePage() {
  const refs = useHrRefs();
  const [employeeId, setEmployeeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [rEmp, setREmp] = useState("");
  const [rDate, setRDate] = useState("");
  const [rShift, setRShift] = useState("");
  const [rIn, setRIn] = useState("");
  const [rOut, setROut] = useState("");
  const [rStatus, setRStatus] = useState("present");
  const [rOt, setROt] = useState("");
  const [rNotes, setRNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const params = new URLSearchParams();
  if (employeeId) params.set("employeeId", employeeId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const url = qs ? `/api/hr/attendance?${qs}` : "/api/hr/attendance";

  async function onRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!rEmp) { toast.error("Pilih karyawan."); return; }
    if (!rDate) { toast.error("Tanggal kerja wajib diisi."); return; }
    if (rIn && Number.isNaN(Date.parse(rIn))) { toast.error("Jam masuk tidak valid."); return; }
    if (rOut && Number.isNaN(Date.parse(rOut))) { toast.error("Jam keluar tidak valid."); return; }
    if (rOt && !/^\d{1,3}$/.test(rOt)) { toast.error("Menit lembur 0-960."); return; }
    const body: Record<string, unknown> = { employeeId: rEmp, workDate: rDate, status: rStatus };
    if (rShift) body.shiftId = rShift;
    if (rIn) body.checkInAt = toIso(rIn);
    if (rOut) body.checkOutAt = toIso(rOut);
    if (rOt) body.overtimeMinutes = Number(rOt);
    if (rNotes.trim()) body.notes = rNotes.trim();
    setSaving(true);
    try {
      const res = await fetch("/api/hr/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Absensi dicatat."); setRIn(""); setROut(""); setROt(""); setRNotes(""); setRefreshKey((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal mencatat absensi.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  const columns: Column<Attendance>[] = [
    { header: "Tanggal", cell: (r) => r.workDate.slice(0, 10) },
    { header: "Karyawan", cell: (r) => { const e = refs.empMap.get(r.employeeId); return e ? `${employeeName(e)} (${e.code})` : "—"; } },
    { header: "Shift", cell: (r) => (r.shiftId ? refs.shiftMap.get(r.shiftId)?.name ?? "—" : "—") },
    { header: "Masuk", cell: (r) => (r.checkInAt ? new Date(r.checkInAt).toLocaleString("id-ID").slice(0, 16) : "—") },
    { header: "Keluar", cell: (r) => (r.checkOutAt ? new Date(r.checkOutAt).toLocaleString("id-ID").slice(0, 16) : "—") },
    { header: "Status", cell: (r) => STATUS_LABEL[r.status] ?? r.status },
    { header: "Lembur (menit)", cell: (r) => (r.overtimeMinutes ? r.overtimeMinutes : "—") },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Absensi</h1>

      <form onSubmit={onRecord} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Karyawan *</label>
          <Select value={rEmp} onChange={(e) => setREmp(e.target.value)}>
            <option value="">— Pilih karyawan —</option>
            {refs.employees.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Tanggal *</label><Input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Shift</label>
          <Select value={rShift} onChange={(e) => setRShift(e.target.value)}>
            <option value="">— Tanpa shift —</option>
            {refs.shifts.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Status</label>
          <Select value={rStatus} onChange={(e) => setRStatus(e.target.value)}>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Jam Masuk</label><Input type="datetime-local" value={rIn} onChange={(e) => setRIn(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Jam Keluar</label><Input type="datetime-local" value={rOut} onChange={(e) => setROut(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Lembur (menit)</label><Input value={rOt} onChange={(e) => setROt(e.target.value)} placeholder="0" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Catatan</label><Input value={rNotes} onChange={(e) => setRNotes(e.target.value)} /></div>
        <div className="flex items-end sm:col-span-4"><Button type="submit" loading={saving}>Catat Absensi</Button></div>
      </form>

      <div className="flex flex-wrap gap-2">
        <Select className="w-56" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua Karyawan</option>
          {refs.employees.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
        </Select>
        <Input className="w-40" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setRefreshKey((k) => k + 1); }} placeholder="Dari" />
        <Input className="w-40" type="date" value={to} onChange={(e) => { setTo(e.target.value); setRefreshKey((k) => k + 1); }} placeholder="Sampai" />
      </div>
      <DataTable<Attendance> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada catatan absensi." />
    </div>
  );
}
