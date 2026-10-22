"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Unit = { id: string; code: string; name: string; symbol: string | null; isActive: boolean };

const CODE_RE = /^[A-Z0-9][A-Z0-9._-]{1,29}$/;

async function readError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Gagal (${res.status}).`;
}

export default function UnitsPage() {
  const [rows, setRows] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [fActive, setFActive] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [isActive, setIsActive] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const qs = fActive ? `?isActive=${fActive}` : "";
      const res = await fetch(`/api/units${qs}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error();
      const j = (await res.json()) as { data?: Unit[] };
      setRows(j.data ?? []);
    } catch { toast.error("Gagal memuat satuan."); } finally { setLoading(false); }
  }

  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => { if (!ignore) void load(); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fActive]);

  function resetForm() {
    setEditId(null); setCode(""); setName(""); setSymbol(""); setIsActive(true);
  }

  function startEdit(u: Unit) {
    setEditId(u.id); setCode(u.code); setName(u.name); setSymbol(u.symbol ?? ""); setIsActive(u.isActive);
    setShowForm(true);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    if (symbol.trim().length > 10) { toast.error("Simbol maksimal 10 karakter."); return; }
    setSaving(true);
    try {
      let res: Response;
      if (editId) {
        res = await fetch(`/api/units/${editId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), symbol: symbol.trim() || null, isActive }),
          credentials: "same-origin",
        });
      } else {
        if (!CODE_RE.test(code.trim())) { toast.error("Kode harus huruf/angka kapital (min 2)."); setSaving(false); return; }
        const body: Record<string, unknown> = { code: code.trim(), name: name.trim() };
        if (symbol.trim()) body.symbol = symbol.trim();
        res = await fetch("/api/units", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body), credentials: "same-origin",
        });
      }
      if (res.ok) { toast.success(editId ? "Satuan diperbarui." : "Satuan dibuat."); resetForm(); setShowForm(false); await load(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Satuan (Unit of Measure)</h1>
        <Button onClick={() => { setShowForm((s) => !s); if (showForm) resetForm(); }}>{showForm ? "Tutup" : "Tambah Satuan"}</Button>
      </div>

      {showForm && (
        <form onSubmit={onSave} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1"><label className="text-sm font-medium">Kode *</label>
            <Input value={code} disabled={!!editId} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="mis. PCS" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nama *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Simbol</label>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="maks 10" /></div>
          {editId && (
            <div className="space-y-1"><label className="text-sm font-medium">Status</label>
              <Select value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true")}>
                <option value="true">Aktif</option><option value="false">Nonaktif</option>
              </Select></div>
          )}
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button type="submit" loading={saving}>{editId ? "Simpan Perubahan" : "Simpan"}</Button>
            <Button type="button" variant="outline" onClick={() => { resetForm(); setShowForm(false); }}>Batal</Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Select className="w-40" value={fActive} onChange={(e) => setFActive(e.target.value)}>
          <option value="">Semua status</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada satuan.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Kode</th><th className="px-3 py-2">Nama</th>
                <th className="px-3 py-2">Simbol</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2 font-mono text-xs">{u.code}</td>
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2">{u.symbol ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{u.isActive ? "Aktif" : "Nonaktif"}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => startEdit(u)}>Ubah</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
