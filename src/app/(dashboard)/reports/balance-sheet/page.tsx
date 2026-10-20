"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LineItem = { accountId: string; code: string; name: string; amount: string };
type BsResult = {
  asOf: string;
  assets: LineItem[];
  liabilities: LineItem[];
  equity: LineItem[];
  retainedEarnings: string;
  totals: {
    assets: string; liabilities: string; equity: string;
    retainedEarnings: string; liabilitiesAndEquity: string; balanced: boolean;
  };
};

type SectionProps = { title: string; items: LineItem[]; total: string };

function Section({ title, items, total }: SectionProps) {
  return (
    <section>
      <h2 className="mb-2 font-medium text-zinc-700 dark:text-zinc-300">{title}</h2>
      <div className="space-y-1 text-sm">
        {items.map((r) => (
          <div key={r.accountId} className="flex justify-between">
            <span><code className="mr-1 text-xs">{r.code}</code>{r.name}</span>
            <span>{r.amount}</span>
          </div>
        ))}
        <div className="flex justify-between border-t pt-1 font-semibold">
          <span>Total {title}</span><span>{total}</span>
        </div>
      </div>
    </section>
  );
}

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<BsResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function query() {
    if (!asOf) { toast.error("Isi tanggal."); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ asOf });
      const res = await fetch(`/api/reports/balance-sheet?${params}`, { credentials: "same-origin" });
      if (res.ok) {
        const json = (await res.json()) as { data: BsResult };
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
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Neraca</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="space-y-1">
          <label className="text-sm font-medium">Per Tanggal</label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <Button onClick={query} loading={loading}>Tampilkan</Button>
      </div>

      {result && (
        <div className="max-w-lg space-y-6">
          <Section title="Aset" items={result.assets} total={result.totals.assets} />
          <Section title="Kewajiban" items={result.liabilities} total={result.totals.liabilities} />
          <section>
            <h2 className="mb-2 font-medium text-zinc-700 dark:text-zinc-300">Ekuitas</h2>
            <div className="space-y-1 text-sm">
              {result.equity.map((r) => (
                <div key={r.accountId} className="flex justify-between">
                  <span><code className="mr-1 text-xs">{r.code}</code>{r.name}</span>
                  <span>{r.amount}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-zinc-500">Laba Ditahan (sementara)</span>
                <span>{result.retainedEarnings}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total Ekuitas</span><span>{result.totals.equity}</span>
              </div>
            </div>
          </section>
          <div className={`rounded-lg border p-4 font-semibold ${result.totals.balanced ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400" : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"}`}>
            <div className="flex justify-between">
              <span>Aset</span><span>{result.totals.assets}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>Kewajiban + Ekuitas</span><span>{result.totals.liabilitiesAndEquity}</span>
            </div>
            <p className="mt-2 text-xs">{result.totals.balanced ? "✓ Seimbang" : "✗ Tidak seimbang"}</p>
          </div>
        </div>
      )}
    </div>
  );
}
