"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Option = { id: string; code?: string; name: string };
type CustomerOption = { id: string; code: string; accountName: string };
type AgingBucket = { key: string; label: string; count: number; amount: string };
type AgingRow = { invoiceId: string; docNo: string | null; customerId: string; customerCode: string; customerName: string; currency: string; dueDate: string; daysOverdue: number; bucket: string; remainingBase: string; remainingForeign: string };
type AgingResult = { asOf: string; totalOutstandingBase: string; buckets: AgingBucket[]; rows: AgingRow[] };

export default function ArAgingReportPage() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [result, setResult] = useState<AgingResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: CustomerOption[] }) => setCustomers(j.data)).catch(() => {});
    fetch("/api/branches?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setBranches(j.data)).catch(() => {});
  }, []);

  async function query() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (asOf) params.set("asOf", asOf);
      if (customerId) params.set("customerId", customerId);
      if (branchId) params.set("branchId", branchId);
      const qs = params.toString();
      const res = await fetch(`/api/reports/ar-aging${qs ? `?${qs}` : ""}`, { credentials: "same-origin" });
      if (res.ok) { const json = (await res.json()) as { data: AgingResult }; setResult(json.data); }
      else { const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(err?.error?.message ?? "Gagal memuat aging."); setResult(null); }
    } catch { toast.error("Koneksi terganggu."); } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Aging Piutang (AR)</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="space-y-1"><label className="text-sm font-medium">Per Tanggal</label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
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
          <p className="text-sm"><span className="font-medium text-zinc-500">Total Outstanding ({result.asOf}):</span> {result.totalOutstandingBase}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            {result.buckets.map((b) => (
              <div key={b.key} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <p className="text-xs text-zinc-500">{b.label}</p>
                <p className="font-mono">{b.amount}</p>
                <p className="text-xs text-zinc-400">{b.count} faktur</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">Faktur</th><th className="px-3 py-2 text-left">Pelanggan</th><th className="px-3 py-2 text-left">Jatuh Tempo</th><th className="px-3 py-2 text-right">Terlambat (hari)</th><th className="px-3 py-2 text-left">Bucket</th><th className="px-3 py-2 text-right">Sisa (Asing)</th><th className="px-3 py-2 text-right">Sisa (Basis)</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {result.rows.map((row) => (
                  <tr key={row.invoiceId}>
                    <td className="px-3 py-2"><Link className="text-blue-600 hover:underline" href={`/sales/invoices/${row.invoiceId}`}><code className="text-xs">{row.docNo ?? row.invoiceId.slice(0, 8)}</code></Link></td>
                    <td className="px-3 py-2">{row.customerCode} — {row.customerName}</td>
                    <td className="px-3 py-2">{row.dueDate}</td>
                    <td className={`px-3 py-2 text-right font-mono ${row.daysOverdue > 0 ? "text-red-600" : ""}`}>{row.daysOverdue}</td>
                    <td className="px-3 py-2 text-zinc-500">{row.bucket}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.remainingForeign} {row.currency}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.remainingBase}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">Tidak ada piutang bersisa.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !result && <div className="flex justify-center py-12"><Spinner size={28} /></div>}
    </div>
  );
}
