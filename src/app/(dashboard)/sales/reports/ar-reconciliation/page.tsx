"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type ReconLine = { label: string; subledger: string; gl: string; difference: string; matched: boolean };
type ReconResult = {
  accounts: { arAccountId: string; inventoryAccountId: string };
  inputs: { invoicePostedTotalBase: string; paymentPostedTotalBase: string; creditNotePostedTotalBase: string; inventoryLayerValue: string };
  lines: ReconLine[];
  balanced: boolean;
};

export default function ArReconciliationReportPage() {
  const [result, setResult] = useState<ReconResult | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/reports/ar-reconciliation", { credentials: "same-origin" });
      if (res.ok) { const json = (await res.json()) as { data: ReconResult }; setResult(json.data); }
      else { const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(err?.error?.message ?? "Gagal memuat rekonsiliasi."); setResult(null); }
    } catch { toast.error("Koneksi terganggu."); } finally { setLoading(false); }
  }

  useEffect(() => {
    fetch("/api/reports/ar-reconciliation", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: ReconResult }) => setResult(j.data))
      .catch(() => toast.error("Gagal memuat rekonsiliasi."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Rekonsiliasi AR (Subledger vs GL)</h1>
        <Button variant="outline" size="sm" onClick={load} loading={loading}>Muat Ulang</Button>
      </div>
      <p className="text-sm text-zinc-500">Posisi kini: subledger piutang = faktur posted − pembayaran posted − nota kredit posted; persediaan = nilai lapisan sisa. Dibandingkan saldo GL akun terkait (jurnal posted + reversed).</p>

      {loading && !result && <div className="flex justify-center py-12"><Spinner size={28} /></div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <p><span className="font-medium text-zinc-500">Faktur Posted:</span> <span className="font-mono">{result.inputs.invoicePostedTotalBase}</span></p>
            <p><span className="font-medium text-zinc-500">Pembayaran Posted:</span> <span className="font-mono">{result.inputs.paymentPostedTotalBase}</span></p>
            <p><span className="font-medium text-zinc-500">Nota Kredit Posted:</span> <span className="font-mono">{result.inputs.creditNotePostedTotalBase}</span></p>
            <p><span className="font-medium text-zinc-500">Nilai Lapisan Stok:</span> <span className="font-mono">{result.inputs.inventoryLayerValue}</span></p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">Komponen</th><th className="px-3 py-2 text-right">Subledger</th><th className="px-3 py-2 text-right">GL</th><th className="px-3 py-2 text-right">Selisih</th><th className="px-3 py-2 text-left">Cocok?</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {result.lines.map((l) => (
                  <tr key={l.label}>
                    <td className="px-3 py-2">{l.label}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.subledger}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.gl}</td>
                    <td className={`px-3 py-2 text-right font-mono ${l.matched ? "" : "text-red-600 font-medium"}`}>{l.difference}</td>
                    <td className="px-3 py-2">{l.matched ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">Cocok</span> : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">Beda</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={`rounded-lg border px-4 py-3 text-sm font-medium ${result.balanced ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300" : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"}`}>
            {result.balanced ? "SEIMBANG — subledger cocok dengan GL untuk semua komponen." : "TIDAK SEIMBANG — ada selisih antara subledger dan GL; periksa jurnal posted/reversed dan akun AR/Persediaan."}
          </div>

          <p className="text-xs text-zinc-400">Akun GL: AR <code className="font-mono">{result.accounts.arAccountId.slice(0, 8)}</code>, Persediaan <code className="font-mono">{result.accounts.inventoryAccountId.slice(0, 8)}</code></p>
        </div>
      )}
    </div>
  );
}
