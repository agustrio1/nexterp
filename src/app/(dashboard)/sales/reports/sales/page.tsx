"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Option = { id: string; code?: string; name: string };
type CustomerOption = { id: string; code: string; accountName: string };
type SalesRow = { customerId: string; customerCode: string; customerName: string; soCount: number; soValue: string; deliveredQty: string; deliveredValue: string; invoiceCount: number; invoiceValue: string; creditValue: string; paymentCount: number; paymentValue: string; outstanding: string };
type SalesTotals = { soCount: number; soValue: string; invoiceValue: string; creditValue: string; paymentValue: string; outstanding: string };
type SalesResult = { from: string | null; to: string | null; totals: SalesTotals; rows: SalesRow[] };

export default function SalesReportPage() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [result, setResult] = useState<SalesResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: CustomerOption[] }) => setCustomers(j.data)).catch(() => {});
    fetch("/api/branches?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setBranches(j.data)).catch(() => {});
  }, []);

  async function query() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (customerId) params.set("customerId", customerId);
      if (branchId) params.set("branchId", branchId);
      const qs = params.toString();
      const res = await fetch(`/api/reports/sales${qs ? `?${qs}` : ""}`, { credentials: "same-origin" });
      if (res.ok) { const json = (await res.json()) as { data: SalesResult }; setResult(json.data); }
      else { const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(err?.error?.message ?? "Gagal memuat laporan."); setResult(null); }
    } catch { toast.error("Koneksi terganggu."); } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Laporan Penjualan</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="space-y-1"><label className="text-sm font-medium">Dari</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Sampai</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Pelanggan</label>
          <Select className="w-52" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Semua pelanggan</option>
            {customers.map((c) => (<option key={c.id} value={c.id}>{c.code} — {c.accountName}</option>))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Cabang</label>
          <Select className="w-44" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Semua cabang</option>
            {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
          </Select>
        </div>
        <Button onClick={query} loading={loading}>Tampilkan</Button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <p><span className="font-medium text-zinc-500">Nilai SO:</span> {result.totals.soValue} ({result.totals.soCount} SO)</p>
            <p><span className="font-medium text-zinc-500">Nilai Faktur:</span> {result.totals.invoiceValue}</p>
            <p><span className="font-medium text-zinc-500">Nota Kredit:</span> {result.totals.creditValue}</p>
            <p><span className="font-medium text-zinc-500">Pembayaran:</span> {result.totals.paymentValue}</p>
            <p><span className="font-medium text-zinc-500">Sisa Piutang:</span> {result.totals.outstanding}</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">Pelanggan</th><th className="px-3 py-2 text-right">SO</th><th className="px-3 py-2 text-right">Nilai SO</th><th className="px-3 py-2 text-right">Qty Kirim</th><th className="px-3 py-2 text-right">Nilai Kirim</th><th className="px-3 py-2 text-right">Faktur</th><th className="px-3 py-2 text-right">Nilai Faktur</th><th className="px-3 py-2 text-right">Kredit</th><th className="px-3 py-2 text-right">Bayar</th><th className="px-3 py-2 text-right">Sisa</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {result.rows.map((row) => (
                  <tr key={row.customerId}>
                    <td className="px-3 py-2">{row.customerCode} — {row.customerName}</td>
                    <td className="px-3 py-2 text-right">{row.soCount}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.soValue}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.deliveredQty}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.deliveredValue}</td>
                    <td className="px-3 py-2 text-right">{row.invoiceCount}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.invoiceValue}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.creditValue}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.paymentValue}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{row.outstanding}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-zinc-500">Tidak ada data penjualan pada rentang ini.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !result && <div className="flex justify-center py-12"><Spinner size={28} /></div>}
    </div>
  );
}
