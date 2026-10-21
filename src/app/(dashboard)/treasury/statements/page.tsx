"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  AMOUNT_RE, DATE_RE, readError, rp,
  fetchBankAccounts, fetchStatementPage, fetchCashPage,
  DIRECTION_LABEL,
  type StatementLine, type BankAccount, type CashTxn,
} from "@/app/(dashboard)/treasury/_shared";

/* Satu baris impor: tanggal|arah(in/out)|nominal|deskripsi[|referensi] */
function parseImport(text: string): { errors: string[]; lines: Array<Record<string, unknown>> } {
  const errors: string[] = [];
  const lines: Array<Record<string, unknown>> = [];
  const raw = text.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  raw.forEach((line, i) => {
    const parts = line.split("|").map((p) => p.trim());
    const where = `Baris ${i + 1}`;
    if (parts.length < 4) { errors.push(`${where}: minimal 4 kolom (tanggal|arah|nominal|deskripsi).`); return; }
    const [date, dir, amt, desc, ref] = parts;
    if (!DATE_RE.test(date)) { errors.push(`${where}: tanggal harus YYYY-MM-DD.`); return; }
    if (dir !== "in" && dir !== "out") { errors.push(`${where}: arah harus in atau out.`); return; }
    if (!AMOUNT_RE.test(amt) || !/[1-9]/.test(amt.replace(".", ""))) { errors.push(`${where}: nominal tidak valid.`); return; }
    if (desc.length < 1) { errors.push(`${where}: deskripsi wajib.`); return; }
    const obj: Record<string, unknown> = { statementDate: date, direction: dir, amount: amt, description: desc };
    if (ref) obj.reference = ref;
    lines.push(obj);
  });
  return { errors, lines };
}

export default function StatementsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [rows, setRows] = useState<StatementLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [fBank, setFBank] = useState("");
  const [fMatched, setFMatched] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const [importBank, setImportBank] = useState("");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const [matchLine, setMatchLine] = useState<StatementLine | null>(null);
  const [candidates, setCandidates] = useState<CashTxn[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [pickTxn, setPickTxn] = useState("");
  const [matching, setMatching] = useState(false);

  function filterParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (fBank) p.set("bankAccountId", fBank);
    if (fMatched) p.set("matched", fMatched);
    if (fFrom) p.set("dateFrom", fFrom);
    if (fTo) p.set("dateTo", fTo);
    p.set("limit", "50");
    return p;
  }

  useEffect(() => {
    let ignore = false;
    fetchBankAccounts(true)
      .then((b) => { if (!ignore) setAccounts(b); })
      .catch(() => { if (!ignore) toast.error("Gagal memuat rekening."); });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    let ignore = false;
    if (fFrom && fTo && fTo < fFrom) {
      Promise.resolve().then(() => {
        if (ignore) return;
        setRows([]); setNextCursor(null); setLoading(false); toast.error("Rentang tanggal tidak valid.");
      });
      return () => { ignore = true; };
    }
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(() => fetchStatementPage(filterParams()))
      .then((page) => { if (!ignore) { setRows(page.items); setNextCursor(page.nextCursor); setLoading(false); } })
      .catch(() => { if (!ignore) { setLoading(false); toast.error("Gagal memuat mutasi."); } });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fBank, fMatched, fFrom, fTo]);

  async function refreshFirst() {
    try { const page = await fetchStatementPage(filterParams()); setRows(page.items); setNextCursor(page.nextCursor); }
    catch { /* diam */ }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const p = filterParams(); p.set("cursor", nextCursor);
      const page = await fetchStatementPage(p);
      setRows((prev) => [...prev, ...page.items]); setNextCursor(page.nextCursor);
    } catch { toast.error("Gagal memuat tambahan."); } finally { setLoadingMore(false); }
  }

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importBank) { toast.error("Pilih rekening untuk impor."); return; }
    const { errors, lines } = parseImport(importText);
    if (errors.length) { toast.error(errors[0]); return; }
    if (!lines.length) { toast.error("Tidak ada baris untuk diimpor."); return; }
    setImporting(true);
    try {
      const res = await fetch("/api/bank-statement-lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bankAccountId: importBank, lines }), credentials: "same-origin" });
      if (res.ok) {
        const j = (await res.json()) as { data?: { imported?: number } };
        toast.success(`${j?.data?.imported ?? lines.length} baris diimpor.`);
        setImportText("");
        if (!fBank || fBank !== importBank) setFBank(importBank); else await refreshFirst();
      } else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setImporting(false); }
  }

  async function openMatch(line: StatementLine) {
    setMatchLine(line); setPickTxn(""); setCandidates([]); setCandLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("bankAccountId", line.bankAccountId);
      p.set("status", "posted");
      p.set("limit", "200");
      const page = await fetchCashPage(p);
      setCandidates(page.items);
    } catch { toast.error("Gagal memuat kandidat transaksi."); } finally { setCandLoading(false); }
  }

  async function applyMatch(cashTransactionId: string | null) {
    if (!matchLine) return;
    setMatching(true);
    try {
      const res = await fetch(`/api/bank-statement-lines/${matchLine.id}/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cashTransactionId }), credentials: "same-origin" });
      if (res.ok) { toast.success(cashTransactionId ? "Baris dicocokkan." : "Cocokan dilepas."); setMatchLine(null); await refreshFirst(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setMatching(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Mutasi Bank</h1>

      <form onSubmit={onImport} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><label className="text-sm font-medium">Rekening tujuan impor *</label>
            <Select value={importBank} onChange={(e) => setImportBank(e.target.value)}>
              <option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </Select></div>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Baris mutasi (satu per baris)</label>
          <textarea
            className="flex min-h-28 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            placeholder={"#tanggal|arah|nominal|deskripsi[|referensi]\n2026-01-05|in|1500000.00|Transfer masuk customer|REF-001\n2026-01-07|out|250000.00|Biaya admin"}
            value={importText} onChange={(e) => setImportText(e.target.value)} />
          <p className="text-xs text-zinc-500">arah: <code>in</code> (masuk) / <code>out</code> (keluar). Baris diawali <code>#</code> diabaikan.</p>
        </div>
        <Button type="submit" loading={importing}>Impor Mutasi</Button>
      </form>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Select className="w-44" value={fBank} onChange={(e) => setFBank(e.target.value)}>
          <option value="">Semua rekening</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </Select>
        <Select className="w-40" value={fMatched} onChange={(e) => setFMatched(e.target.value)}>
          <option value="">Cocokan: semua</option>
          <option value="true">Tercocokkan</option>
          <option value="false">Belum tercocok</option>
        </Select>
        <Input className="w-40" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <Input className="w-40" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada mutasi bank.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2">Tanggal</th><th className="px-3 py-2">Rekening</th><th className="px-3 py-2">Deskripsi</th>
                  <th className="px-3 py-2">Arah</th><th className="px-3 py-2 text-right">Nominal</th>
                  <th className="px-3 py-2">Cocokan</th><th className="px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-3 py-2 whitespace-nowrap">{l.statementDate}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.bankAccountCode}</td>
                    <td className="px-3 py-2"><div>{l.description}</div>{l.reference && <div className="text-xs text-zinc-400">{l.reference}</div>}</td>
                    <td className="px-3 py-2">{DIRECTION_LABEL[l.direction] ?? l.direction}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(l.amount)}</td>
                    <td className="px-3 py-2 text-xs">{l.matchedCashTransactionDocNo ? <span className="text-green-600">{l.matchedCashTransactionDocNo}</span> : <span className="text-zinc-400">belum</span>}</td>
                    <td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => void openMatch(l)}>Cocokkan</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && <div className="flex justify-center"><Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>Muat lebih</Button></div>}
        </>
      )}

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
                    <option key={c.id} value={c.id}>{c.docNo ?? c.id.slice(0, 8)} · {c.transactionDate} · {TXN_DIR(c)} {rp(c.amount)}</option>
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

function TXN_DIR(t: CashTxn): string {
  if (t.type === "receipt") return "↑";
  if (t.type === "disbursement") return "↓";
  return "⇄";
}
