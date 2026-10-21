"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  CODE_RE, readError,
  fetchCostCenters,
  type CostCenter,
} from "@/app/(dashboard)/budget-tax/_shared";

const empty = { code: "", name: "", parentId: "", branchId: "", description: "" };

export default function CostCentersPage() {
  const refs = useHrRefs();
  const [rows, setRows] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [form, setForm] = useState(empty);

  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function reload() {
    setLoading(true);
    try { setRows(await fetchCostCenters()); }
    catch { toast.error("Gagal memuat pusat biaya."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let ignore = false;
    fetchCostCenters()
      .then((r) => { if (!ignore) setRows(r); })
      .catch(() => { if (!ignore) toast.error("Gagal memuat data."); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, []);

  function nameOf(id: string | null): string {
    if (!id) return "—";
    return rows.find((r) => r.id === id)?.name ?? "—";
  }

  function startEdit(r: CostCenter) {
    setEditingId(r.id);
    setIsActive(r.isActive);
    setForm({ code: r.code, name: r.name, parentId: r.parentId ?? "", branchId: r.branchId ?? "", description: r.description ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() { setEditingId(null); setIsActive(true); setForm(empty); }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const code = form.code.trim().toUpperCase();
    if (!CODE_RE.test(code)) { toast.error("Kode tidak valid."); return; }
    if (form.name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }

    setSaving(true);
    try {
      if (editingId) {
        const body: Record<string, unknown> = {
          name: form.name.trim(),
          parentId: form.parentId || null,
          branchId: form.branchId || null,
          description: form.description.trim() || null,
          isActive,
        };
        const res = await fetch(`/api/cost-centers/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
        if (res.ok) { toast.success("Pusat biaya diperbarui."); reset(); await reload(); } else toast.error(await readError(res));
      } else {
        const body: Record<string, unknown> = { code, name: form.name.trim() };
        if (form.parentId) body.parentId = form.parentId;
        if (form.branchId) body.branchId = form.branchId;
        if (form.description.trim()) body.description = form.description.trim();
        const res = await fetch("/api/cost-centers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
        if (res.ok) { toast.success("Pusat biaya dibuat."); reset(); await reload(); } else toast.error(await readError(res));
      }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  const parentOptions = rows.filter((r) => r.id !== editingId);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pusat Biaya</h1>

      <form onSubmit={onSave} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label>
          <Input value={form.code} onChange={(e) => set("code", e.target.value)} disabled={!!editingId} placeholder="PP-01" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Induk</label>
          <Select value={form.parentId} onChange={(e) => set("parentId", e.target.value)}>
            <option value="">— (teratas)</option>
            {parentOptions.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
          </Select></div>
        <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
          <Select value={form.branchId} onChange={(e) => set("branchId", e.target.value)}>
            <option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select></div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Deskripsi</label>
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
        {editingId && (
          <div className="flex items-center"><label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label></div>
        )}
        <div className="flex items-end gap-2">
          <Button type="submit" loading={saving}>{editingId ? "Simpan" : "Tambah"}</Button>
          {editingId && <Button type="button" variant="outline" onClick={reset}>Batal</Button>}
        </div>
      </form>
      <p className="text-xs text-zinc-500">Kode tidak dapat diubah. Pusat biaya tidak dapat dihapus — nonaktifkan bila tidak dipakai.</p>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada pusat biaya.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Kode</th><th className="px-3 py-2">Nama</th><th className="px-3 py-2">Induk</th>
                <th className="px-3 py-2">Cabang</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-xs">{nameOf(r.parentId)}</td>
                  <td className="px-3 py-2">{r.branchId ? refs.branchMap.get(r.branchId)?.name ?? "—" : "—"}</td>
                  <td className="px-3 py-2">{r.isActive ? <span className="text-green-600">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>}</td>
                  <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => startEdit(r)}>Ubah</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
