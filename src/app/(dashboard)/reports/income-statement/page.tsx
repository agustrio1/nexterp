"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LineItem = { accountId: string; code: string; name: string; amount: string };
type IsResult = {
  range: { from: string; to: string };
  revenue: LineItem[];
  expense: LineItem[];
  totalRevenue: string;
  totalExpense: string;
  netIncome: string;
};

export default function IncomeStatementPage() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<IsResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function query() {
    if (!dateFrom || !dateTo) { toast.error("Isi rentang tanggal."); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: dateFrom, to: dateTo });
      const res = await fetch(`/api/reports/income-statement?${params}`, { credentials: "same-origin" });
      if (res.ok) {
        const json = (await res.json()) as { data: IsResult };
        setResult(json.data);
      } else {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(err?.error?.message ?? "Gagal memuat laporan.");
        setResult(null);
      }
    } catch { toast.error("Koneksi terganggu."); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Laporan Laba Rugi</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="space-y-1">
          <label className="text-sm font-medium">Dari</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Sampai</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <Button onClick={query} loading={loading}>Tampilkan</Button>
      </div>

      {result && (
        <div className="max-w-lg space-y-6">
          <section>
            <h2 className="mb-2 font-medium text-zinc-700 dark:text-zinc-300">Pendapatan</h2>
            <div className="space-y-1 text-sm">
              {result.revenue.map((r) => (
                <div key={r.accountId} className="flex justify-between">
                  <span><code className="mr-1 text-xs">{r.code}</code>{r.name}</span>
                  <span>{r.amount}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total Pendapatan</span><span>{result.totalRevenue}</span>
              </div>
            </div>
          </section>
          <section>
            <h2 className="mb-2 font-medium text-zinc-700 dark:text-zinc-300">Beban</h2>
            <div className="space-y-1 text-sm">
              {result.expense.map((r) => (
                <div key={r.accountId} className="flex justify-between">
                  <span><code className="mr-1 text-xs">{r.code}</code>{r.name}</span>
                  <span>{r.amount}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total Beban</span><span>{result.totalExpense}</span>
              </div>
            </div>
          </section>
          <div className={`rounded-lg border p-4 text-lg font-bold ${parseFloat(result.netIncome) >= 0 ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400" : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"}`}>
            <div className="flex justify-between">
              <span>Laba Bersih</span><span>{result.netIncome}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
