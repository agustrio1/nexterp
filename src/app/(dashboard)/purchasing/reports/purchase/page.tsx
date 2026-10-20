"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Option = { id: string; code?: string; name: string };
type PurRow = { supplierId: string; supplierCode: string; supplierName: string; poCount: number; poValue: string; receivedQty: string; receivedValue: string; invoiceCount: number; invoiceValue: string; paymentCount: number; paymentValue: string; outstanding: string };
type PurTotals = { poCount: number; poValue: string; invoiceValue: string; paymentValue: string; outstanding: string };
type PurResult = { from: string | null; to: string | null; totals: PurTotals; rows: PurRow[] };

export default function PurchaseReportPage() {
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [result, setResult] = useState<PurResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/purchasing/suppliers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setSuppliers(j.data)).catch(() => {});
    fetch("/api/branches?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setBranches(j.data)).catch(() => {});
  }, []);

  async function query() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (supplierId) params.set("supplierId", supplierId);
      if (branchId) params.set("branchId", branchId);
      const qs = params.toString();
      const res = await fetch(`/api/reports/purchase${qs ? `?${qs}` : ""}`, { credentials: "same-origin" });
      if (res.ok) { const json = (await res.json()) as { data: PurResult }; setResult(json.data); }
      else { const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(err?.error?.message ?? "Gagal memuat laporan."); setResult(null); }
    } catch { toast.error("Koneksi terganggu."); } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Laporan Pembelian</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="space-y-1"><label className="text-sm font-medium">Dari</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Sampai</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Pemasok</label>
          <Select className="w-52" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Semua pemasok</option>
            {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.code} — {s.name}</option>))}
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
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <p><span className="font-medium text-zinc-500">Nilai PO:</span> {result.totals.poValue} ({result.totals.poCount} PO)</p>
            <p><span className="font-medium text-zinc-500">Nilai Invoice:</span> {result.totals.invoiceValue}</p>
            <p><span className="font-medium text-zinc-500">Nilai Pembayaran:</span> {result.totals.paymentValue}</p>
            <p><span className="font-medium text-zinc-500">Sisa Utang:</span> {result.totals.outstanding}</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">Pemasok</th><th className="px-3 py-2 text-right">PO</th><th className="px-3 py-2 text-right">Nilai PO</th><th className="px-3 py-2 text-right">Diterima</th><th className="px-3 py-2 text-right">Invoice</th><th className="px-3 py-2 text-right">Nilai Invoice</th><th className="px-3 py-2 text-right">Bayar</th><th className="px-3 py-2 text-right">Sisa</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {result.rows.map((row) => (
                  <tr key={row.supplierId}>
                    <td className="px-3 py-2">{row.supplierCode} — {row.supplierName}</td>
                    <td className="px-3 py-2 text-right">{row.poCount}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.poValue}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.receivedValue}</td>
                    <td className="px-3 py-2 text-right">{row.invoiceCount}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.invoiceValue}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.paymentValue}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{row.outstanding}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-zinc-500">Tidak ada data pembelian pada rentang ini.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !result && <div className="flex justify-center py-12"><Spinner size={28} /></div>}
    </div>
  );
}
