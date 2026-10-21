"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  rp, RUN_STATUS_LABEL, RUN_STATUS_STYLE, COMPONENT_KIND_LABEL,
} from "@/app/(dashboard)/payroll/_shared";

type RunComponent = { label: string; kind: string; amount: string; basisSnapshot: unknown };
type RunItem = {
  id: string; employeeId: string; employeeCode: string; employeeName: string;
  grossEarnings: string; totalDeductions: string; netPay: string; components: RunComponent[];
};
type RunDetail = {
  id: string; docNo: string | null; periodId: string; branchId: string | null;
  status: string; employeeCount: number | null; totalEarnings: string;
  totalDeductions: string; totalNet: string; reason: string | null; items: RunItem[];
};

export default function PayrollRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reasonMode, setReasonMode] = useState<"cancel" | "reverse" | null>(null);
  const [reason, setReason] = useState("");

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/payroll/runs/${id}`, { credentials: "same-origin" });
    if (res.ok) { const j = (await res.json()) as { data: RunDetail }; setRun(j.data); }
    else toast.error("Gagal memuat run.");
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/payroll/runs/${id}`, { credentials: "same-origin" })
      .then((res) => res.ok ? res.json() as Promise<{ data: RunDetail }> : Promise.reject(new Error(String(res.status))))
      .then((j) => { setRun(j.data); setLoading(false); })
      .catch(() => { toast.error("Gagal memuat run."); setLoading(false); });
  }, [id]);

  async function doAction(action: "calculate" | "approve" | "post" | "cancel" | "reverse", withReason?: string) {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action };
      if (withReason) body.reason = withReason;
      const res = await fetch(`/api/payroll/runs/${id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) {
        const msg = action === "calculate" ? "Run dihitung." : action === "approve" ? "Run disetujui." : action === "post" ? "Run diposting, slip diterbitkan." : action === "cancel" ? "Run dibatalkan." : "Run direversal.";
        toast.success(msg);
        setReasonMode(null); setReason("");
        await refetch();
      } else toast.error(j?.error?.message ?? "Aksi gagal.");
    } catch { toast.error("Koneksi terganggu."); } finally { setBusy(false); }
  }

  function submitReason() {
    if (!reasonMode) return;
    if (reason.trim().length < 3) { toast.error("Alasan minimal 3 karakter."); return; }
    void doAction(reasonMode, reason.trim());
  }

  function toggleItem(iid: string) {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(iid)) n.delete(iid); else n.add(iid); return n; });
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!run) return <p className="text-zinc-500">Run tidak ditemukan.</p>;

  const s = run.status;
  const itemTotal = run.items.length;

  return (
    <div className="space-y-4">
      <Link href="/payroll/runs" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Run Payroll
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Run <code className="font-mono">{run.docNo ?? "—"}</code>{" "}
          <span className={RUN_STATUS_STYLE[run.status] ?? ""}>{RUN_STATUS_LABEL[run.status] ?? run.status}</span>
        </h1>
        <div className="flex flex-wrap gap-2">
          {s === "draft" && <Button size="sm" loading={busy} onClick={() => void doAction("calculate")}>Hitung</Button>}
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
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Minimal 3 karakter" />
          </div>
          <Button size="sm" loading={busy} onClick={submitReason}>Konfirmasi</Button>
          <Button size="sm" variant="ghost" onClick={() => { setReasonMode(null); setReason(""); }}>Batal</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-4">
        <div><p className="text-zinc-500">Karyawan</p><p className="font-medium">{run.employeeCount ?? "—"} (item: {itemTotal})</p></div>
        <div><p className="text-zinc-500">Total Bruto</p><p className="font-mono font-medium">{rp(run.totalEarnings)}</p></div>
        <div><p className="text-zinc-500">Total Potongan</p><p className="font-mono font-medium">{rp(run.totalDeductions)}</p></div>
        <div><p className="text-zinc-500">Total Bersih</p><p className="font-mono font-medium">{rp(run.totalNet)}</p></div>
      </div>

      {run.reason && <p className="text-sm text-zinc-500">Alasan: {run.reason}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="w-[40px] px-4 py-3"></th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Kode</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Nama</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Bruto</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Potongan</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Bersih</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {run.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Run belum memiliki item. Klik Hitung untuk menghitung.</td></tr>}
            {run.items.map((it) => (
              <>
                <tr key={it.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-3"><button className="text-zinc-400 hover:text-zinc-700" onClick={() => toggleItem(it.id)}>{expanded.has(it.id) ? "▾" : "▸"}</button></td>
                  <td className="px-4 py-3 font-mono text-xs">{it.employeeCode}</td>
                  <td className="px-4 py-3">{it.employeeName}</td>
                  <td className="px-4 py-3 text-right font-mono">{rp(it.grossEarnings)}</td>
                  <td className="px-4 py-3 text-right font-mono">{rp(it.totalDeductions)}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{rp(it.netPay)}</td>
                </tr>
                {expanded.has(it.id) && (
                  <tr key={`${it.id}-c`} className="bg-zinc-50/60 dark:bg-zinc-800/30">
                    <td colSpan={6} className="px-10 py-3">
                      {it.components.length === 0 ? <p className="text-xs text-zinc-500">Tidak ada rincian komponen.</p> : (
                        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                          {it.components.map((c, idx) => (
                            <div key={idx} className="flex justify-between text-xs">
                              <span>{c.label} <span className="text-zinc-400">({COMPONENT_KIND_LABEL[c.kind] ?? c.kind})</span></span>
                              <span className="font-mono">{rp(c.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {(s === "posted") && (
        <div className="text-sm">
          <Link href="/payroll/payslips" className="text-blue-600 hover:underline">Lihat slip gaji terkait →</Link>
        </div>
      )}
    </div>
  );
}
