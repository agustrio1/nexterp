"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { rp, RUN_STATUS_LABEL, RUN_STATUS_STYLE } from "@/app/(dashboard)/assets/_shared";

type RunItem = {
  id: string; assetId: string; assetCode: string; assetName: string; periodKey: string;
  openingBookValue: string; depreciationAmount: string; accumulatedAfter: string; closingBookValue: string;
};
type RunDetail = {
  id: string; docNo: string | null; periodId: string; branchId: string | null;
  status: string; assetCount: number | null; totalDepreciation: string | null;
  reason: string | null; items: RunItem[];
};

export default function DepreciationRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reasonMode, setReasonMode] = useState<"cancel" | "reverse" | null>(null);
  const [reason, setReason] = useState("");

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/assets/depreciation/runs/${id}`, { credentials: "same-origin" });
    if (res.ok) { const j = (await res.json()) as { data: RunDetail }; setRun(j.data); }
    else toast.error("Gagal memuat run.");
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/assets/depreciation/runs/${id}`, { credentials: "same-origin" })
      .then((res) => res.ok ? res.json() as Promise<{ data: RunDetail }> : Promise.reject(new Error(String(res.status))))
      .then((j) => { setRun(j.data); setLoading(false); })
      .catch(() => { toast.error("Gagal memuat run."); setLoading(false); });
  }, [id]);

  async function doAction(kind: "calculate" | "approve" | "post" | "cancel" | "reverse", withReason?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/depreciation/runs/${id}/${kind}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: withReason ? JSON.stringify({ reason: withReason }) : "{}", credentials: "same-origin",
      });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) {
        const msg = kind === "calculate" ? "Run dihitung." : kind === "approve" ? "Run disetujui." : kind === "post" ? "Run diposting ke buku besar." : kind === "cancel" ? "Run dibatalkan." : "Run direversal.";
        toast.success(msg); setReasonMode(null); setReason(""); await refetch();
      } else toast.error(j?.error?.message ?? "Aksi gagal.");
    } catch { toast.error("Koneksi terganggu."); } finally { setBusy(false); }
  }

  function submitReason() {
    if (!reasonMode) return;
    if (reason.trim().length < 5) { toast.error("Alasan minimal 5 karakter."); return; }
    void doAction(reasonMode, reason.trim());
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!run) return <p className="text-zinc-500">Run tidak ditemukan.</p>;

  const s = run.status;

  return (
    <div className="space-y-4">
      <Link href="/assets/depreciation" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Run Penyusutan
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Run <code className="font-mono">{run.docNo ?? "—"}</code>{" "}
          <span className={RUN_STATUS_STYLE[run.status] ?? ""}>{RUN_STATUS_LABEL[run.status] ?? run.status}</span>
        </h1>
        <div className="flex flex-wrap gap-2">
          {(s === "draft" || s === "calculated") && <Button size="sm" loading={busy} onClick={() => void doAction("calculate")}>Hitung</Button>}
          {s === "calculated" && <Button size="sm" loading={busy} onClick={() => void doAction("approve")}>Setujui</Button>}
          {s === "approved" && <Button size="sm" loading={busy} onClick={() => void doAction("post")}>Posting</Button>}
          {(s === "draft" || s === "calculated") && <Button size="sm" variant="outline" onClick={() => setReasonMode(reasonMode === "cancel" ? null : "cancel")}>Batalkan</Button>}
          {s === "posted" && <Button size="sm" variant="outline" onClick={() => setReasonMode(reasonMode === "reverse" ? null : "reverse")}>Reversal</Button>}
        </div>
      </div>

      {(reasonMode === "cancel" || reasonMode === "reverse") && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="min-w-[240px] flex-1 space-y-1">
            <label className="text-sm font-medium">Alasan {reasonMode === "cancel" ? "pembatalan" : "reversal"} *</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Minimal 5 karakter" />
          </div>
          <Button size="sm" loading={busy} onClick={submitReason}>Konfirmasi</Button>
          <Button size="sm" variant="ghost" onClick={() => { setReasonMode(null); setReason(""); }}>Batal</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-3">
        <div><p className="text-zinc-500">Jumlah Aset</p><p className="font-medium">{run.assetCount ?? "—"}</p></div>
        <div><p className="text-zinc-500">Total Penyusutan</p><p className="font-mono font-medium">{rp(run.totalDepreciation)}</p></div>
        <div><p className="text-zinc-500">Cabang</p><p className="font-medium">{run.branchId ? "Khusus cabang" : "Semua cabang"}</p></div>
      </div>

      {run.reason && <p className="text-sm text-zinc-500">Alasan: {run.reason}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Kode</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Aset</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Periode</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Nilai Buku Awal</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Penyusutan</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Akumulasi</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Nilai Buku Akhir</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {run.items.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-zinc-500">Run belum memiliki item. Klik Hitung untuk menghitung.</td></tr>}
            {run.items.map((it) => (
              <tr key={it.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-4 py-3 font-mono text-xs">{it.assetCode}</td>
                <td className="px-4 py-3">{it.assetName}</td>
                <td className="px-4 py-3 text-zinc-500">{it.periodKey}</td>
                <td className="px-4 py-3 text-right font-mono">{rp(it.openingBookValue)}</td>
                <td className="px-4 py-3 text-right font-mono">{rp(it.depreciationAmount)}</td>
                <td className="px-4 py-3 text-right font-mono">{rp(it.accumulatedAfter)}</td>
                <td className="px-4 py-3 text-right font-mono font-medium">{rp(it.closingBookValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
