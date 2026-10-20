"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type AccountOption = { id: string; code: string; name: string; type: string };

type GlRow = {
  entryDate: string;
  docNo: string | null;
  lineNo: number;
  memo: string | null;
  debit: string;
  credit: string;
  balance: string;
};

type GlResult = {
  account: { id: string; code: string; name: string; type: string };
  range: { from: string; to: string };
  normalSide: string;
  openingBalance: string;
  rows: GlRow[];
  closingBalance: string;
};

export default function GeneralLedgerPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<GlResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/chart-accounts?isActive=true&isPostable=true", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((json: { data: AccountOption[] }) => setAccounts(json.data))
      .catch(() => {});
  }, []);

  async function query() {
    if (!accountId) { toast.error("Pilih akun terlebih dahulu."); return; }
    if (!dateFrom || !dateTo) { toast.error("Isi rentang tanggal."); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ accountId, from: dateFrom, to: dateTo });
      const res = await fetch(`/api/reports/general-ledger?${params}`, { credentials: "same-origin" });
      if (res.ok) {
        const json = (await res.json()) as { data: GlResult };
        setResult(json.data);
      } else {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(err?.error?.message ?? "Gagal memuat buku besar.");
        setResult(null);
      }
    } catch {
      toast.error("Koneksi terganggu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Buku Besar</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="space-y-1 min-w-[260px] flex-1">
          <label className="text-sm font-medium">Akun *</label>
          <Select className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— Pilih Akun —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </Select>
        </div>
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
          <div className="grid grid-cols-3 gap-4 text-sm">
            <p><span className="font-medium text-zinc-500">Akun:</span> {result.account.code} — {result.account.name}</p>
            <p><span className="font-medium text-zinc-500">Saldo Awal:</span> {result.openingBalance}</p>
            <p><span className="font-medium text-zinc-500">Saldo Akhir:</span> {result.closingBalance}</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-3 py-2 text-left">Tanggal</th>
                  <th className="px-3 py-2 text-left">No. Dok</th>
                  <th className="px-3 py-2 text-left">Memo</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Kredit</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <tr className="bg-zinc-50/50 dark:bg-zinc-800/30">
                  <td colSpan={5} className="px-3 py-2 text-right font-medium text-zinc-500">Saldo Awal</td>
                  <td className="px-3 py-2 text-right font-medium">{result.openingBalance}</td>
                </tr>
                {result.rows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2">{row.entryDate}</td>
                    <td className="px-3 py-2"><code className="text-xs">{row.docNo ?? "—"}</code></td>
                    <td className="px-3 py-2 text-zinc-500">{row.memo ?? ""}</td>
                    <td className="px-3 py-2 text-right">{row.debit !== "0.00" ? row.debit : ""}</td>
                    <td className="px-3 py-2 text-right">{row.credit !== "0.00" ? row.credit : ""}</td>
                    <td className="px-3 py-2 text-right font-medium">{row.balance}</td>
                  </tr>
                ))}
                <tr className="bg-zinc-50/50 dark:bg-zinc-800/30">
                  <td colSpan={5} className="px-3 py-2 text-right font-medium text-zinc-500">Saldo Akhir</td>
                  <td className="px-3 py-2 text-right font-medium">{result.closingBalance}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !result && <div className="flex justify-center py-12"><Spinner size={28} /></div>}
    </div>
  );
}
