"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  INT_0_30_RE, readError, rp, fetchCashPage, fetchReconDetail,
  DIRECTION_LABEL, RECON_STATUS_LABEL, RECON_STATUS_STYLE,
  type ReconDetail, type StatementLine, type CashTxn,
} from "@/app/(dashboard)/treasury/_shared";

export default function ReconciliationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [detail, setDetail] = useState<ReconDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [tolerance, setTolerance] = useState("3");
  const [autoMatching, setAutoMatching] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const [matchLine, setMatchLine] = useState<StatementLine | null>(null);
  const [candidates, setCandidates] = useState<CashTxn[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [pickTxn, setPickTxn] = useState("");
  const [matching, setMatching] = useState(false);

  const load = useCallback(async () => {
    const d = await fetchReconDetail(id);
    setDetail(d);
  }, [id]);

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(() => fetchReconDetail(id))
      .then((d) => { if (!ignore) { setDetail(d); setLoading(false); } })
      .catch(() => { if (!ignore) { setLoading(false); setNotFound(true); } });
    return () => { ignore = true; };
  }, [id]);

  async function runAutoMatch() {
    setAutoMatching(true);
    try {
      const body: Record<string, unknown> = {};
      if (tolerance && INT_0_30_RE.test(tolerance)) body.toleranceDays = Number(tolerance);
      const res = await fetch(`/api/reconciliations/${id}/auto-match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) {
        const j = (await res.json()) as { data?: { matchedCount?: number } };
        toast.success(`${j?.data?.matchedCount ?? 0} baris dicocokkan otomatis.`);
        await load();
      } else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setAutoMatching(false); }
  }

  async function runFinalize() {
    setFinalizing(true);
    try {
      const res = await fetch(`/api/reconciliations/${id}/finalize`, { method: "POST", credentials: "same-origin" });
      if (res.ok) { toast.success("Rekonsiliasi difinalkan."); await load(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setFinalizing(false); }
  }

  async function openMatch(line: StatementLine) {
    if (!detail) return;
    setMatchLine(line); setPickTxn(line.matchedCashTransactionId ?? ""); setCandidates([]); setCandLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("bankAccountId", detail.bankAccountId);
      p.set("status", "posted");
      p.set("limit", "200");
      const page = await fetchCashPage(p);
      setCandidates(page.items);
    } catch { toast.error("Gagal memuat kandidat."); } finally { setCandLoading(false); }
  }

  async function applyMatch(cashTransactionId: string | null) {
    if (!matchLine) return;
    setMatching(true);
    try {
      const res = await fetch(`/api/bank-statement-lines/${matchLine.id}/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cashTransactionId }), credentials: "same-origin" });
      if (res.ok) { toast.success(cashTransactionId ? "Baris dicocokkan." : "Cocokan dilepas."); setMatchLine(null); await load(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setMatching(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (notFound || !detail) return (
    <div className="space-y-4">
      <Link href="/treasury/reconciliations" className="inline-flex items-center gap-1 text-sm text-zinc-500"><ArrowLeft size={16} /> Kembali</Link>
      <p className="text-sm text-zinc-400">Rekonsiliasi tidak ditemukan.</p>
    </div>
  );

  const isDraft = detail.status === "draft";
  const s = detail.summary;

  return (
    <div className="space-y-4">
      <Link href="/treasury/reconciliations" className="inline-flex items-center gap-1 text-sm text-zinc-500"><ArrowLeft size={16} /> Kembali ke daftar</Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Rekonsiliasi {detail.docNo ?? detail.id.slice(0, 8)}</h1>
          <p className="text-sm text-zinc-500">{detail.bankAccountCode} — {detail.bankAccountName} · {detail.startDate} s/d {detail.endDate}</p>
        </div>
        <span className={RECON_STATUS_STYLE[detail.status] ?? ""}>{RECON_STATUS_LABEL[detail.status] ?? detail.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Saldo Awal Statement" value={rp(detail.statementOpeningBalance)} />
        <Stat label="Saldo Akhir Statement" value={rp(detail.statementClosingBalance)} />
        <Stat label="Saldo Buku Awal" value={rp(detail.bookBalanceStart)} />
        <Stat label="Saldo Buku Akhir" value={rp(detail.bookBalanceEnd)} />
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-4">
        <div><div className="text-xs uppercase text-zinc-500">Total Baris</div><div className="font-mono">{s.totalLines}</div></div>
        <div><div className="text-xs uppercase text-zinc-500">Tercocokkan</div><div className="font-mono text-green-600">{s.matchedLines}</div></div>
        <div><div className="text-xs uppercase text-zinc-500">Belum Cocok</div><div className="font-mono text-amber-600">{s.unmatchedLines}</div></div>
        <div><div className="text-xs uppercase text-zinc-500">Mutasi Bersih</div><div className="font-mono">{rp(s.netStatementMovement)}</div></div>
      </div>

      {detail.notes && <p className="text-sm text-zinc-600 dark:text-zinc-400">Catatan: {detail.notes}</p>}

      {isDraft && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="space-y-1"><label className="text-xs font-medium text-zinc-500">Toleransi hari (0–30)</label>
            <Input className="w-28" inputMode="numeric" value={tolerance} onChange={(e) => setTolerance(e.target.value)} /></div>
          <Button variant="outline" loading={autoMatching} onClick={() => void runAutoMatch()}>Auto-cocokkan</Button>
          <Button loading={finalizing} onClick={() => void runFinalize()}>Finalkan</Button>
          <span className="text-xs text-zinc-500">Final hanya bila semua baris tercocok &amp; saldo akhir statement = saldo buku.</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-2">Tanggal</th><th className="px-3 py-2">Deskripsi</th>
              <th className="px-3 py-2">Arah</th><th className="px-3 py-2 text-right">Nominal</th>
              <th className="px-3 py-2">Cocokan</th>{isDraft && <th className="px-3 py-2">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((l) => (
              <tr key={l.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                <td className="px-3 py-2 whitespace-nowrap">{l.statementDate}</td>
                <td className="px-3 py-2"><div>{l.description}</div>{l.reference && <div className="text-xs text-zinc-400">{l.reference}</div>}</td>
                <td className="px-3 py-2">{DIRECTION_LABEL[l.direction] ?? l.direction}</td>
                <td className="px-3 py-2 text-right font-mono">{rp(l.amount)}</td>
                <td className="px-3 py-2 text-xs">{l.matchedCashTransactionDocNo ? <span className="text-green-600">{l.matchedCashTransactionDocNo}</span> : <span className="text-zinc-400">belum</span>}</td>
                {isDraft && <td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => void openMatch(l)}>Cocokkan</Button></td>}
              </tr>
            ))}
            {detail.lines.length === 0 && (
              <tr><td colSpan={isDraft ? 6 : 5} className="px-3 py-6 text-center text-sm text-zinc-400">Tidak ada baris statement dalam rentang ini.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {matchLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Cocokkan baris mutasi</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {matchLine.statementDate} · {DIRECTION_LABEL[matchLine.direction] ?? matchLine.direction} · {rp(matchLine.amount)} · {matchLine.description}
            </p>
            <div className="mt-4 space-y-1">
              <label className="text-sm font-medium">Transaksi kas terposting</label>
              {candLoading ? (
                <div className="flex justify-center py-4"><Spinner size={22} /></div>
              ) : (
                <Select value={pickTxn} onChange={(e) => setPickTxn(e.target.value)}>
                  <option value="">— lepas / tidak cocok —</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.docNo ?? c.id.slice(0, 8)} · {c.transactionDate} · {c.type === "receipt" ? "↑" : c.type === "disbursement" ? "↓" : "⇄"} {rp(c.amount)}</option>
                  ))}
                </Select>
              )}
              {candidates.length === 0 && !candLoading && <p className="text-xs text-zinc-400">Tidak ada transaksi terposting untuk rekening ini.</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setMatchLine(null)} disabled={matching}>Batal</Button>
              <Button size="sm" loading={matching} onClick={() => void applyMatch(pickTxn || null)}>{pickTxn ? "Cocokkan" : "Lepas Cocokan"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-lg text-zinc-900 dark:text-zinc-50">{value}</div>
    </div>
  );
}
