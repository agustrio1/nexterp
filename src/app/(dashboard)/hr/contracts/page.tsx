"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";

type Contract = {
  id: string; docNo: string | null; employeeId: string; code: string; type: string;
  startDate: string; endDate: string | null; status: string; notes: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  pkwt: "PKWT (Waktu Tertentu)", pkwtt: "PKWTT (Tanpa Waktu)", outsourcing: "Alih Daya", intern: "Magang",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Draf", active: "Aktif", ended: "Berakhir", cancelled: "Dibatalkan",
};

export default function HRContractsPage() {
  const refs = useHrRefs();
  const [fEmp, setFEmp] = useState("");
  const [rk, setRk] = useState(0);

  const [emp, setEmp] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState("pkwt");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [status, setStatus] = useState("draft");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editType, setEditType] = useState("pkwt");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editStatus, setEditStatus] = useState("draft");
  const [editNotes, setEditNotes] = useState("");
  const [editing, setEditing] = useState(false);

  const params = new URLSearchParams();
  if (fEmp) params.set("employeeId", fEmp);
  const qs = params.toString();
  const url = qs ? `/api/hr/contracts?${qs}` : "/api/hr/contracts";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) { toast.error("Pilih karyawan."); return; }
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code.trim().toUpperCase())) { toast.error("Kode 2-20 karakter huruf/angka/strip."); return; }
    if (!start) { toast.error("Tanggal mulai wajib diisi."); return; }
    if (end && end < start) { toast.error("Tanggal selesai tidak boleh sebelum mulai."); return; }
    setSaving(true);
    const body: Record<string, unknown> = { employeeId: emp, code: code.trim().toUpperCase(), type, startDate: start, status };
    if (end) body.endDate = end;
    try {
      const res = await fetch("/api/hr/contracts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Kontrak dibuat."); setCode(""); setStart(""); setEnd(""); setStatus("draft"); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat kontrak.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  function startEdit(c: Contract) {
    setEditId(c.id); setEditType(c.type);
    setEditStart(c.startDate.slice(0, 10)); setEditEnd(c.endDate ? c.endDate.slice(0, 10) : "");
    setEditStatus(c.status); setEditNotes(c.notes ?? "");
  }

  async function onEdit() {
    if (!editId) return;
    if (!editStart) { toast.error("Tanggal mulai wajib diisi."); return; }
    if (editEnd && editEnd < editStart) { toast.error("Tanggal selesai tidak boleh sebelum mulai."); return; }
    const body: Record<string, unknown> = { type: editType, startDate: editStart, status: editStatus };
    body.endDate = editEnd || null;
    body.notes = editNotes.trim() || null;
    setEditing(true);
    try {
      const res = await fetch(`/api/hr/contracts/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Kontrak diperbarui."); setEditId(null); setRk((k) => k + 1); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  const columns: Column<Contract>[] = [
    { header: "No. Dokumen", cell: (r) => <code className="font-mono text-xs">{r.docNo ?? "—"}</code> },
    { header: "Kode", cell: (r) => r.code },
    {
      header: "Karyawan", cell: (r) => {
        const e = refs.empMap.get(r.employeeId);
        return e ? `${e.firstName} ${e.lastName ?? ""} (${e.code})` : "—";
      },
    },
    { header: "Tipe", cell: (r) => TYPE_LABEL[r.type] ?? r.type },
    { header: "Periode", cell: (r) => `${r.startDate.slice(0, 10)} — ${r.endDate ? r.endDate.slice(0, 10) : "∞"}` },
    { header: "Status", cell: (r) => STATUS_LABEL[r.status] ?? r.status },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Ubah</Button> },
  ];

  const empOptions = refs.employees.filter((x) => x.isActive).map((x) => (
    <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>
  ));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Kontrak Kerja</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-6">
        <div className="space-y-1"><label className="text-sm font-medium">Karyawan *</label>
          <Select value={emp} onChange={(e) => setEmp(e.target.value)}>
            <option value="">— Pilih —</option>
            {empOptions}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="KTR-001" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Tipe</label>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Mulai *</label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Sampai</label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div className="flex items-end gap-2">
          <div className="space-y-1"><label className="text-sm font-medium">Status</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <Button type="submit" loading={saving}>Tambah</Button>
        </div>
      </form>

      {editId && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-6">
          <div className="space-y-1"><label className="text-sm font-medium">Tipe</label>
            <Select value={editType} onChange={(e) => setEditType(e.target.value)}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Mulai</label><Input type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Sampai</label><Input type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Status</label>
            <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Catatan</label><Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></div>
          <div className="col-span-2 flex gap-2 sm:col-span-6"><Button size="sm" loading={editing} onClick={onEdit}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
        </div>
      )}

      <div className="flex gap-2">
        <Select className="w-56" value={fEmp} onChange={(e) => { setFEmp(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Karyawan</option>
          {refs.employees.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
        </Select>
      </div>
      <DataTable<Contract> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada kontrak." />
    </div>
  );
}
