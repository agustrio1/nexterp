"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Shift = {
  id: string; code: string; name: string; workStart: string | null; workEnd: string | null; isActive: boolean;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function HRShiftsPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [workStart, setWorkStart] = useState("");
  const [workEnd, setWorkEnd] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editing, setEditing] = useState(false);

  function startEdit(s: Shift) {
    setEditId(s.id);
    setEditName(s.name);
    setEditStart(s.workStart ? s.workStart.slice(0, 5) : "");
    setEditEnd(s.workEnd ? s.workEnd.slice(0, 5) : "");
    setEditActive(s.isActive);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code.trim().toUpperCase())) { toast.error("Kode 2-20 karakter huruf/angka/strip."); return; }
    if (name.trim().length < 2) { toast.error("Nama shift minimal 2 karakter."); return; }
    if (workStart && !TIME_RE.test(workStart)) { toast.error("Jam mulai harus HH:MM."); return; }
    if (workEnd && !TIME_RE.test(workEnd)) { toast.error("Jam selesai harus HH:MM."); return; }
    const body: Record<string, unknown> = { code: code.trim().toUpperCase(), name: name.trim() };
    if (workStart) body.workStart = workStart;
    if (workEnd) body.workEnd = workEnd;
    setSaving(true);
    try {
      const res = await fetch("/api/hr/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Shift dibuat."); setCode(""); setName(""); setWorkStart(""); setWorkEnd(""); setRefreshKey((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat shift.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onEdit() {
    if (!editId) return;
    if (editStart && !TIME_RE.test(editStart)) { toast.error("Jam mulai harus HH:MM."); return; }
    if (editEnd && !TIME_RE.test(editEnd)) { toast.error("Jam selesai harus HH:MM."); return; }
    const body: Record<string, unknown> = { isActive: editActive };
    if (editName.trim().length >= 2) body.name = editName.trim();
    body.workStart = editStart || null;
    body.workEnd = editEnd || null;
    setEditing(true);
    try {
      const res = await fetch(`/api/hr/shifts/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Shift diperbarui."); setEditId(null); setRefreshKey((k) => k + 1); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  const columns: Column<Shift>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Jam Mulai", cell: (r) => r.workStart?.slice(0, 5) ?? "—" },
    { header: "Jam Selesai", cell: (r) => r.workEnd?.slice(0, 5) ?? "—" },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Ubah</Button> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Shift Kerja</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-5">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SFT-PGI" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Jam Mulai</label><Input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Jam Selesai</label><Input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} /></div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      {editId && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-5">
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama</label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Jam Mulai</label><Input type="time" value={editStart} onChange={(e) => setEditStart(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Jam Selesai</label><Input type="time" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} /></div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} /> Aktif</label>
            <div className="flex gap-2"><Button size="sm" loading={editing} onClick={onEdit}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
          </div>
        </div>
      )}

      <DataTable<Shift> key={refreshKey} url="/api/hr/shifts" columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada shift." />
    </div>
  );
}
