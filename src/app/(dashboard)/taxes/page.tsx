"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  CODE_RE, DATE_RE, RATE_RE, readError,
  fetchTaxes, fetchTaxRates, fetchPostableAccounts,
  TAX_KIND_LABEL,
  type Tax, type TaxRate, type ChartAccount,
} from "@/app/(dashboard)/budget-tax/_shared";

const KINDS = ["output", "input", "withholding"] as const;
const empty = { code: "", name: "", kind: "output", taxAccountId: "", description: "" };

export default function TaxesPage() {
  const [rows, setRows] = useState<Tax[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [form, setForm] = useState(empty);

  const [ratesFor, setRatesFor] = useState<string | null>(null);
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [rateForm, setRateForm] = useState({ rate: "", effectiveFrom: "", source: "", note: "" });
  const [rateSaving, setRateSaving] = useState(false);

  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function reload() {
    setLoading(true);
    try { setRows(await fetchTaxes()); } catch { toast.error("Gagal memuat pajak."); } finally { setLoading(false); }
  }

  useEffect(() => {
    let ignore = false;
    Promise.all([fetchTaxes(), fetchPostableAccounts()])
      .then(([t, a]) => { if (!ignore) { setRows(t); setAccounts(a); } })
      .catch(() => { if (!ignore) toast.error("Gagal memuat data."); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, []);

  function startEdit(r: Tax) {
    setEditingId(r.id); setIsActive(r.isActive);
    setForm({ code: r.code, name: r.name, kind: r.kind, taxAccountId: r.taxAccountId, description: r.description ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function reset() { setEditingId(null); setIsActive(true); setForm(empty); }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const code = form.code.trim().toUpperCase();
    if (!CODE_RE.test(code)) { toast.error("Kode pajak tidak valid."); return; }
    if (form.name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    if (!form.taxAccountId) { toast.error("Pilih akun GL pajak."); return; }

    setSaving(true);
    try {
      if (editingId) {
        const body = { name: form.name.trim(), kind: form.kind, taxAccountId: form.taxAccountId, isActive, description: form.description.trim() || null };
        const res = await fetch(`/api/taxes/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
        if (res.ok) { toast.success("Pajak diperbarui."); reset(); await reload(); } else toast.error(await readError(res));
      } else {
        const body: Record<string, unknown> = { code, name: form.name.trim(), kind: form.kind, taxAccountId: form.taxAccountId };
        if (form.description.trim()) body.description = form.description.trim();
        const res = await fetch("/api/taxes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
        if (res.ok) { toast.success("Pajak dibuat."); reset(); await reload(); } else toast.error(await readError(res));
      }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function openRates(taxId: string) {
    if (ratesFor === taxId) { setRatesFor(null); return; }
    setRatesFor(taxId); setRates([]); setRatesLoading(true);
    setRateForm({ rate: "", effectiveFrom: "", source: "", note: "" });
    try { setRates(await fetchTaxRates(taxId)); } catch { toast.error("Gagal memuat tarif."); } finally { setRatesLoading(false); }
  }

  async function addRate(e: React.FormEvent) {
    e.preventDefault();
    if (!ratesFor) return;
    if (!RATE_RE.test(rateForm.rate) || Number(rateForm.rate) > 100) { toast.error("Tarif harus 0..100 (maks 4 desimal)."); return; }
    if (!DATE_RE.test(rateForm.effectiveFrom)) { toast.error("Tanggal berlaku tidak valid."); return; }
    if (rateForm.source.trim().length < 3) { toast.error("Sumber resmi minimal 3 karakter."); return; }
    setRateSaving(true);
    try {
      const body: Record<string, unknown> = { rate: rateForm.rate, effectiveFrom: rateForm.effectiveFrom, source: rateForm.source.trim() };
      if (rateForm.note.trim()) body.note = rateForm.note.trim();
      const res = await fetch(`/api/taxes/${ratesFor}/rates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Tarif ditambahkan."); setRates(await fetchTaxRates(ratesFor)); setRateForm({ rate: "", effectiveFrom: "", source: "", note: "" }); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setRateSaving(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pajak</h1>

      <form onSubmit={onSave} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label>
          <Input value={form.code} onChange={(e) => set("code", e.target.value)} disabled={!!editingId} placeholder="PPN" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Jenis *</label>
          <Select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{TAX_KIND_LABEL[k]}</option>)}
          </Select></div>
        <div className="space-y-1"><label className="text-sm font-medium">Akun GL pajak *</label>
          <Select value={form.taxAccountId} onChange={(e) => set("taxAccountId", e.target.value)}>
            <option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </Select></div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Deskripsi</label>
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
        {editingId && (
          <div className="flex items-center"><label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label></div>
        )}
        <div className="flex items-end gap-2">
          <Button type="submit" loading={saving}>{editingId ? "Simpan" : "Tambah Pajak"}</Button>
          {editingId && <Button type="button" variant="outline" onClick={reset}>Batal</Button>}
        </div>
      </form>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada pajak.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Kode</th><th className="px-3 py-2">Nama</th><th className="px-3 py-2">Jenis</th>
                <th className="px-3 py-2">Akun GL</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">{TAX_KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.accountCode} — {r.accountName}</td>
                  <td className="px-3 py-2">{r.isActive ? <span className="text-green-600">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>}</td>
                  <td className="px-3 py-2"><div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>Ubah</Button>
                    <Button size="sm" variant="outline" onClick={() => void openRates(r.id)}>{ratesFor === r.id ? "Tutup tarif" : "Tarif"}</Button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ratesFor && (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Tarif pajak</h2>
          {ratesLoading ? <div className="flex justify-center py-4"><Spinner size={22} /></div> : rates.length === 0 ? (
            <p className="text-sm text-zinc-400">Belum ada tarif.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-1">Tarif %</th><th className="py-1">Berlaku sejak</th><th className="py-1">Sumber</th><th className="py-1">Catatan</th>
              </tr></thead>
              <tbody>{rates.map((rt) => (
                <tr key={rt.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="py-1 font-mono">{rt.rate}</td><td className="py-1">{rt.effectiveFrom}</td><td className="py-1 text-xs">{rt.source}</td><td className="py-1 text-xs text-zinc-500">{rt.note ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <form onSubmit={addRate} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Input inputMode="decimal" placeholder="Tarif % *" value={rateForm.rate} onChange={(e) => setRateForm((f) => ({ ...f, rate: e.target.value }))} />
            <Input type="date" placeholder="Berlaku *" value={rateForm.effectiveFrom} onChange={(e) => setRateForm((f) => ({ ...f, effectiveFrom: e.target.value }))} />
            <Input placeholder="Sumber resmi *" value={rateForm.source} onChange={(e) => setRateForm((f) => ({ ...f, source: e.target.value }))} />
            <Input placeholder="Catatan" value={rateForm.note} onChange={(e) => setRateForm((f) => ({ ...f, note: e.target.value }))} />
            <Button type="submit" loading={rateSaving}>Tambah tarif</Button>
          </form>
          <p className="text-xs text-zinc-500">Tarif berlaku = effectiveFrom terbaru yang ≤ tanggal transaksi. Sumber resmi wajib — sistem tidak mengarang tarif.</p>
        </div>
      )}
    </div>
  );
}
