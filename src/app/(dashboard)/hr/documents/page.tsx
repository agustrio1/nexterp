"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DialogConfirm } from "@/components/ui/dialog-confirm";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";

type Document = {
  id: string; employeeId: string; category: string; name: string;
  externalRef: string | null; notes: string | null; capturedAt: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  identity: "Identitas", academic: "Ijazan/Akademik", contract: "Kontrak", tax: "Pajak", other: "Lainnya",
};

export default function HRDocumentsPage() {
  const refs = useHrRefs();
  const [emp, setEmp] = useState("");
  const [rk, setRk] = useState(0);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("identity");
  const [externalRef, setExternalRef] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("identity");
  const [editRef, setEditRef] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editing, setEditing] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) { toast.error("Pilih karyawan terlebih dahulu."); return; }
    if (!name.trim()) { toast.error("Nama dokumen wajib diisi."); return; }
    const body: Record<string, unknown> = { employeeId: emp, category, name: name.trim() };
    if (externalRef.trim()) body.externalRef = externalRef.trim();
    if (notes.trim()) body.notes = notes.trim();
    if (capturedAt) body.capturedAt = new Date(capturedAt).toISOString();
    setSaving(true);
    try {
      const res = await fetch("/api/hr/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Dokumen dicatat."); setName(""); setExternalRef(""); setNotes(""); setCapturedAt(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal mencatat dokumen.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  function startEdit(d: Document) {
    setEditId(d.id); setEditName(d.name); setEditCategory(d.category);
    setEditRef(d.externalRef ?? ""); setEditNotes(d.notes ?? "");
  }

  async function onEdit() {
    if (!editId) return;
    const body: Record<string, unknown> = { category: editCategory };
    if (editName.trim()) body.name = editName.trim();
    body.externalRef = editRef.trim() || null;
    body.notes = editNotes.trim() || null;
    setEditing(true);
    try {
      const res = await fetch(`/api/hr/documents/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Dokumen diperbarui."); setEditId(null); setRk((k) => k + 1); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  async function onDelete(id: string) {
    const res = await fetch(`/api/hr/documents/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (res.ok) { toast.success("Dokumen dihapus."); setRk((k) => k + 1); }
    else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal menghapus."); }
  }

  const columns: Column<Document>[] = [
    { header: "Nama", cell: (r) => r.name },
    { header: "Kategori", cell: (r) => CATEGORY_LABEL[r.category] ?? r.category },
    { header: "Referensi", cell: (r) => r.externalRef ?? "—" },
    { header: "Ditangkap", cell: (r) => (r.capturedAt ? new Date(r.capturedAt).toLocaleString("id-ID").slice(0, 16) : "—") },
    { header: "Catatan", cell: (r) => r.notes ?? "—" },
    {
      header: "Aksi", className: "w-[150px]", cell: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Ubah</Button>
          <DialogConfirm
            trigger={<Button variant="ghost" size="sm">Hapus</Button>}
            title={`Hapus dokumen "${r.name}"?`}
            confirmLabel="Hapus"
            destructive
            onConfirm={() => onDelete(r.id)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Dokumen Karyawan</h1>

      <div className="flex items-end gap-2">
        <div className="w-72 space-y-1">
          <label className="text-sm font-medium">Karyawan *</label>
          <Select value={emp} onChange={(e) => { setEmp(e.target.value); setRk((k) => k + 1); }}>
            <option value="">— Pilih karyawan —</option>
            {refs.employees.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
          </Select>
        </div>
      </div>

      {!emp ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50">
          Pilih karyawan untuk melihat dan mencatat dokumennya.
        </p>
      ) : (
        <>
          <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-5">
            <div className="space-y-1"><label className="text-sm font-medium">Nama Dokumen *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Kategori</label>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div className="space-y-1"><label className="text-sm font-medium">Referensi</label><Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Ditangkap Pada</label><Input type="datetime-local" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} /></div>
            <div className="flex items-end"><Button type="submit" loading={saving}>Catat</Button></div>
            <div className="space-y-1 sm:col-span-5"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </form>

          {editId && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-5">
              <div className="space-y-1"><label className="text-sm font-medium">Nama</label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Kategori</label>
                <Select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                  {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
              <div className="space-y-1"><label className="text-sm font-medium">Referensi</label><Input value={editRef} onChange={(e) => setEditRef(e.target.value)} /></div>
              <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Catatan</label><Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></div>
              <div className="col-span-2 flex gap-2 sm:col-span-5"><Button size="sm" loading={editing} onClick={onEdit}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
            </div>
          )}

          <DataTable<Document> key={rk} url={`/api/hr/documents?employeeId=${emp}`} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada dokumen untuk karyawan ini." />
        </>
      )}
    </div>
  );
}
