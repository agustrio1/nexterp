"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  DATE_RE, AMOUNT_RE, readError, rp, isPositive,
  fetchTaxes, fetchCostCenters, fetchTaxTxnPage,
  TAX_DIRECTION_LABEL,
  type Tax, type CostCenter, type TaxTxn,
} from "@/app/(dashboard)/budget-tax/_shared";

const DIRECTIONS = ["collect", "pay"] as const;

const emptyForm = {
  taxId: "", transactionDate: "", direction: "collect", baseAmount: "",
  branchId: "", costCenterId: "", notes: "",
};

export default function TaxTransactionsPage() {
  const refs = useHrRefs();
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);

  const [rows, setRows] = useState<TaxTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [fTax, setFTax] = useState("");
  const [fDir, setFDir] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const set = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function filterParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (fTax) p.set("taxId", fTax);
    if (fDir) p.set("direction", fDir);
    if (fFrom) p.set("dateFrom", fFrom);
    if (fTo) p.set("dateTo", fTo);
    p.set("limit", "50");
    return p;
  }

  useEffect(() => {
    let ignore = false;
    Promise.all([fetchTaxes(true), fetchCostCenters(true)])
      .then(([t, c]) => { if (!ignore) { setTaxes(t); setCostCenters(c); } })
      .catch(() => { if (!ignore) toast.error("Gagal memuat referensi."); });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    let ignore = false;
    if (fFrom && fTo && fTo < fFrom) {
      Promise.resolve().then(() => { if (ignore) return; setRows([]); setNextCursor(null); setLoading(false); toast.error("Rentang tanggal tidak valid."); });
      return () => { ignore = true; };
    }
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(() => fetchTaxTxnPage(filterParams()))
      .then((page) => { if (!ignore) { setRows(page.items); setNextCursor(page.nextCursor); setLoading(false); } })
      .catch(() => { if (!ignore) { setLoading(false); toast.error("Gagal memuat transaksi pajak."); } });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fTax, fDir, fFrom, fTo]);

  async function refreshFirst() {
    try { const page = await fetchTaxTxnPage(filterParams()); setRows(page.items); setNextCursor(page.nextCursor); } catch { /* diam */ }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try { const p = filterParams(); p.set("cursor", nextCursor); const page = await fetchTaxTxnPage(p); setRows((prev) => [...prev, ...page.items]); setNextCursor(page.nextCursor); }
    catch { toast.error("Gagal memuat tambahan."); } finally { setLoadingMore(false); }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.taxId) { toast.error("Pilih pajak."); return; }
    if (!DATE_RE.test(form.transactionDate)) { toast.error("Tanggal tidak valid."); return; }
    if (!AMOUNT_RE.test(form.baseAmount) || !isPositive(form.baseAmount)) { toast.error("Nominal dasar tidak valid."); return; }
    const body: Record<string, unknown> = {
      taxId: form.taxId, transactionDate: form.transactionDate, direction: form.direction, baseAmount: form.baseAmount,
    };
    if (form.branchId) body.branchId = form.branchId;
    if (form.costCenterId) body.costCenterId = form.costCenterId;
    if (form.notes.trim()) body.notes = form.notes.trim();
    setSaving(true);
    try {
      const res = await fetch("/api/tax-transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Transaksi pajak dicatat."); setForm(emptyForm); setShowForm(false); await refreshFirst(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Transaksi Pajak</h1>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Tutup" : "Catat Transaksi"}</Button>
      </div>

      {showForm && (
        <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1"><label className="text-sm font-medium">Pajak *</label>
            <Select value={form.taxId} onChange={(e) => set("taxId", e.target.value)}>
              <option value="">—</option>{taxes.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Tanggal *</label>
            <Input type="date" value={form.transactionDate} onChange={(e) => set("transactionDate", e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Arah *</label>
            <Select value={form.direction} onChange={(e) => set("direction", e.target.value)}>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{TAX_DIRECTION_LABEL[d]}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nominal dasar *</label>
            <Input inputMode="decimal" value={form.baseAmount} onChange={(e) => set("baseAmount", e.target.value)} placeholder="0.00" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
            <Select value={form.branchId} onChange={(e) => set("branchId", e.target.value)}>
              <option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Pusat Biaya</label>
            <Select value={form.costCenterId} onChange={(e) => set("costCenterId", e.target.value)}>
              <option value="">—</option>{costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </Select></div>
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Catatan</label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button type="submit" loading={saving}>Simpan</Button>
            <Button type="button" variant="outline" onClick={() => { setForm(emptyForm); setShowForm(false); }}>Batal</Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Select className="w-44" value={fTax} onChange={(e) => setFTax(e.target.value)}>
          <option value="">Semua pajak</option>{taxes.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
        </Select>
        <Select className="w-44" value={fDir} onChange={(e) => setFDir(e.target.value)}>
          <option value="">Semua arah</option>{DIRECTIONS.map((d) => <option key={d} value={d}>{TAX_DIRECTION_LABEL[d]}</option>)}
        </Select>
        <Input className="w-40" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <Input className="w-40" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada transaksi pajak.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2">No. Dokumen</th><th className="px-3 py-2">Tanggal</th><th className="px-3 py-2">Pajak</th>
                  <th className="px-3 py-2">Arah</th><th className="px-3 py-2 text-right">Dasar</th><th className="px-3 py-2 text-right">Tarif %</th>
                  <th className="px-3 py-2 text-right">Pajak</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-3 py-2 font-mono text-xs">{t.docNo ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{t.transactionDate}</td>
                    <td className="px-3 py-2">{t.taxCode} — {t.taxName}</td>
                    <td className="px-3 py-2 text-xs">{TAX_DIRECTION_LABEL[t.direction] ?? t.direction}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(t.baseAmount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{t.rate}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(t.taxAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && <div className="flex justify-center"><Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>Muat lebih</Button></div>}
        </>
      )}
    </div>
  );
}
