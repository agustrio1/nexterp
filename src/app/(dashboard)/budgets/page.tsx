"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  fetchFiscalYears, fetchBudgets,
  BUDGET_STATUS_LABEL, BUDGET_STATUS_STYLE,
  type Budget, type FiscalYear,
} from "@/app/(dashboard)/budget-tax/_shared";

export default function BudgetsPage() {
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [rows, setRows] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);

  const [fYear, setFYear] = useState("");
  const [fStatus, setFStatus] = useState("");

  useEffect(() => {
    let ignore = false;
    fetchFiscalYears().then((y) => { if (!ignore) setYears(y); }).catch(() => { /* diam */ });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    let ignore = false;
    const p = new URLSearchParams();
    if (fYear) p.set("fiscalYearId", fYear);
    if (fStatus) p.set("status", fStatus);
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(() => fetchBudgets(p))
      .then((r) => { if (!ignore) { setRows(r); setLoading(false); } })
      .catch(() => { if (!ignore) { setLoading(false); toast.error("Gagal memuat anggaran."); } });
    return () => { ignore = true; };
  }, [fYear, fStatus]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Anggaran</h1>
        <Link href="/budgets/new"><Button>Anggaran Baru</Button></Link>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Select className="w-52" value={fYear} onChange={(e) => setFYear(e.target.value)}>
          <option value="">Semua tahun fiskal</option>{years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
        </Select>
        <Select className="w-40" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Semua status</option>
          <option value="draft">Draf</option><option value="approved">Disetujui</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada anggaran.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">No. Dokumen</th><th className="px-3 py-2">Nama</th><th className="px-3 py-2">Tahun Fiskal</th>
                <th className="px-3 py-2">Cabang</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2 font-mono text-xs">{b.docNo ?? "—"}</td>
                  <td className="px-3 py-2">{b.name}</td>
                  <td className="px-3 py-2">{b.fiscalYearCode}</td>
                  <td className="px-3 py-2">{b.branchName ?? "—"}</td>
                  <td className="px-3 py-2"><span className={BUDGET_STATUS_STYLE[b.status] ?? ""}>{BUDGET_STATUS_LABEL[b.status] ?? b.status}</span></td>
                  <td className="px-3 py-2"><Link href={`/budgets/${b.id}`}><Button size="sm" variant="ghost">Buka</Button></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
