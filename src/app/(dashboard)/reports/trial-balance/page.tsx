"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TbRow = { accountId: string; code: string; name: string; type: string; debit: string; credit: string };
type TbResult = {
  range: { from: string; to: string };
  rows: TbRow[];
  totals: { debit: string; credit: string; balanced: boolean };
};

export default function TrialBalancePage() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<TbResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function query() {
    if (!dateFrom || !dateTo) { toast.error("Isi rentang tanggal."); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: dateFrom, to: dateTo });
      const res = await fetch(`/api/reports/trial-balance?${params}`, { credentials: "same-origin" });
      if (res.ok) {
        const json = (await res.json()) as { data: TbResult };
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
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Neraca Saldo</h1>

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
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-4 py-2 text-left">Kode</th>
                  <th className="px-4 py-2 text-left">Nama Akun</th>
                  <th className="px-4 py-2 text-right">Debit</th>
                  <th className="px-4 py-2 text-right">Kredit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {result.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="px-4 py-2"><code className="text-xs">{r.code}</code></td>
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-4 py-2 text-right">{r.debit !== "0.00" ? r.debit : ""}</td>
                    <td className="px-4 py-2 text-right">{r.credit !== "0.00" ? r.credit : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-300 dark:border-zinc-600 font-semibold">
                  <td className="px-4 py-2" colSpan={2}>TOTAL</td>
                  <td className="px-4 py-2 text-right">{result.totals.debit}</td>
                  <td className="px-4 py-2 text-right">{result.totals.credit}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className={`text-sm font-medium ${result.totals.balanced ? "text-green-600" : "text-red-600"}`}>
            {result.totals.balanced ? "✓ Neraca saldo seimbang." : "✗ Neraca saldo TIDAK seimbang."}
          </p>
        </div>
      )}
    </div>
  );
}
