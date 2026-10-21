"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";

type Position = {
  id: string; code: string; name: string; departmentId: string | null;
  jobGrade: number | null; isActive: boolean;
};

export default function HRPositionsPage() {
  const refs = useHrRefs();
  const [isActive, setIsActive] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nDept, setNDept] = useState("");
  const [jobGrade, setJobGrade] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDept, setEditDept] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editing, setEditing] = useState(false);

  const params = new URLSearchParams();
  if (isActive) params.set("isActive", isActive);
  if (departmentId) params.set("departmentId", departmentId);
  const qs = params.toString();
  const url = qs ? `/api/hr/positions?${qs}` : "/api/hr/positions";

  function startEdit(p: Position) {
    setEditId(p.id);
    setEditName(p.name);
    setEditDept(p.departmentId ?? "");
    setEditGrade(p.jobGrade === null ? "" : String(p.jobGrade));
    setEditActive(p.isActive);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code.trim().toUpperCase())) { toast.error("Kode 2-20 karakter huruf/angka/strip, diawali huruf/angka."); return; }
    if (name.trim().length < 2) { toast.error("Nama jabatan minimal 2 karakter."); return; }
    if (jobGrade && !/^\d+$/.test(jobGrade)) { toast.error("Grade harus bilangan bulat ≥ 0."); return; }
    const body: Record<string, unknown> = { code: code.trim().toUpperCase(), name: name.trim() };
    if (nDept) body.departmentId = nDept;
    if (jobGrade) body.jobGrade = Number(jobGrade);
    setSaving(true);
    try {
      const res = await fetch("/api/hr/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Jabatan dibuat."); setCode(""); setName(""); setNDept(""); setJobGrade(""); setRefreshKey((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat jabatan.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onEdit() {
    if (!editId) return;
    if (editGrade && !/^\d+$/.test(editGrade)) { toast.error("Grade harus bilangan bulat ≥ 0."); return; }
    const body: Record<string, unknown> = { isActive: editActive };
    if (editName.trim().length >= 2) body.name = editName.trim();
    body.departmentId = editDept || null;
    body.jobGrade = editGrade === "" ? null : Number(editGrade);
    setEditing(true);
    try {
      const res = await fetch(`/api/hr/positions/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Jabatan diperbarui."); setEditId(null); setRefreshKey((k) => k + 1); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  const columns: Column<Position>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Departemen", cell: (r) => (r.departmentId ? refs.deptMap.get(r.departmentId)?.name ?? "—" : "—") },
    { header: "Grade", cell: (r) => r.jobGrade ?? "—" },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Ubah</Button> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Jabatan</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-5">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="JBT-001" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Departemen</label>
          <Select value={nDept} onChange={(e) => setNDept(e.target.value)}>
            <option value="">— Tanpa departemen —</option>
            {refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Grade</label><Input value={jobGrade} onChange={(e) => setJobGrade(e.target.value)} placeholder="0" /></div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      {editId && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-5">
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama</label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Departemen</label>
            <Select value={editDept} onChange={(e) => setEditDept(e.target.value)}>
              <option value="">— Tanpa departemen —</option>
              {refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Grade</label><Input value={editGrade} onChange={(e) => setEditGrade(e.target.value)} /></div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} /> Aktif</label>
            <div className="flex gap-2"><Button size="sm" loading={editing} onClick={onEdit}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Select className="w-36" value={isActive} onChange={(e) => { setIsActive(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua Aktif</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
        <Select className="w-48" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua Departemen</option>
          {refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </div>
      <DataTable<Position> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada jabatan." />
    </div>
  );
}
