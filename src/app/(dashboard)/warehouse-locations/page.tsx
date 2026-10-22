"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Warehouse = { id: string; code: string; name: string };
type Loc = {
  id: string; warehouseId: string; warehouseCode: string; warehouseName: string;
  code: string; name: string; isActive: boolean; description: string | null;
};

const CODE_RE = /^[A-Z0-9][A-Z0-9._-]{1,19}$/;

async function readError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Gagal (${res.status}).`;
}

export default function WarehouseLocationsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [rows, setRows] = useState<Loc[]>([]);
  const [loading, setLoading] = useState(true);
  const [fWarehouse, setFWarehouse] = useState("");
  const [fActive, setFActive] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (fWarehouse) p.set("warehouseId", fWarehouse);
      if (fActive) p.set("isActive", fActive);
      const qs = p.toString();
      const [wRes, lRes] = await Promise.all([
        fetch("/api/warehouses?isActive=true", { credentials: "same-origin" }),
        fetch(`/api/warehouse-locations${qs ? `?${qs}` : ""}`, { credentials: "same-origin" }),
      ]);
      const wj = (wRes.ok ? await wRes.json() : { data: [] }) as { data?: Warehouse[] };
      setWarehouses(wj.data ?? []);
      if (!lRes.ok) throw new Error();
      const lj = (await lRes.json()) as { data?: Loc[] };
      setRows(lj.data ?? []);
    } catch { toast.error("Gagal memuat lokasi gudang."); } finally { setLoading(false); }
  }

  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => { if (!ignore) void load(); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fWarehouse, fActive]);

  function resetForm() {
    setEditId(null); setWarehouseId(""); setCode(""); setName(""); setDescription(""); setIsActive(true);
  }

  function startEdit(l: Loc) {
    setEditId(l.id); setWarehouseId(l.warehouseId); setCode(l.code); setName(l.name);
    setDescription(l.description ?? ""); setIsActive(l.isActive); setShowForm(true);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    if (description.trim().length > 500) { toast.error("Deskripsi maksimal 500 karakter."); return; }
    setSaving(true);
    try {
      let res: Response;
      if (editId) {
        res = await fetch(`/api/warehouse-locations/${editId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null, isActive }),
          credentials: "same-origin",
        });
      } else {
        if (!warehouseId) { toast.error("Pilih gudang."); setSaving(false); return; }
        if (!CODE_RE.test(code.trim())) { toast.error("Kode lokasi harus huruf/angka kapital (2-20)."); setSaving(false); return; }
        const body: Record<string, unknown> = { warehouseId, code: code.trim(), name: name.trim() };
        if (description.trim()) body.description = description.trim();
        res = await fetch("/api/warehouse-locations", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body), credentials: "same-origin",
        });
      }
      if (res.ok) { toast.success(editId ? "Lokasi diperbarui." : "Lokasi dibuat."); resetForm(); setShowForm(false); await load(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Lokasi Gudang</h1>
        <Button onClick={() => { setShowForm((s) => !s); if (showForm) resetForm(); }}>{showForm ? "Tutup" : "Tambah Lokasi"}</Button>
      </div>

      {showForm && (
        <form onSubmit={onSave} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1"><label className="text-sm font-medium">Gudang *</label>
            <Select value={warehouseId} disabled={!!editId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">—</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Kode *</label>
            <Input value={code} disabled={!!editId} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="mis. A-01" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nama *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          {editId && (
            <div className="space-y-1"><label className="text-sm font-medium">Status</label>
              <Select value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true")}>
                <option value="true">Aktif</option><option value="false">Nonaktif</option>
              </Select></div>
          )}
          <div className="space-y-1 sm:col-span-4"><label className="text-sm font-medium">Deskripsi</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button type="submit" loading={saving}>{editId ? "Simpan Perubahan" : "Simpan"}</Button>
            <Button type="button" variant="outline" onClick={() => { resetForm(); setShowForm(false); }}>Batal</Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Select className="w-52" value={fWarehouse} onChange={(e) => setFWarehouse(e.target.value)}>
          <option value="">Semua gudang</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </Select>
        <Select className="w-40" value={fActive} onChange={(e) => setFActive(e.target.value)}>
          <option value="">Semua status</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada lokasi gudang.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Gudang</th><th className="px-3 py-2">Kode</th><th className="px-3 py-2">Nama</th>
                <th className="px-3 py-2">Deskripsi</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2 text-xs">{l.warehouseCode} — {l.warehouseName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.code}</td>
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2 text-xs">{l.description ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{l.isActive ? "Aktif" : "Nonaktif"}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => startEdit(l)}>Ubah</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
