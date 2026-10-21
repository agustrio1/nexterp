"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  DATE_RE, SIGNED_AMOUNT_RE, INT_0_30_RE, readError, rp,
  fetchBankAccounts, fetchReconPage,
  RECON_STATUS_LABEL, RECON_STATUS_STYLE,
  type Reconciliation, type BankAccount,
} from "@/app/(dashboard)/treasury/_shared";

const positive = (v: string) => SIGNED_AMOUNT_RE.test(v) && /[1-9]/.test(v.replace(".", "").replace("-", ""));

const emptyForm = {
  bankAccountId: "", startDate: "", endDate: "",
  statementOpeningBalance: "", statementClosingBalance: "", notes: "",
  autoMatch: false, toleranceDays: "3",
};

export default function ReconciliationsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [rows, setRows] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [fBank, setFBank] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const set = (k: keyof typeof emptyForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function filterParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (fBank) p.set("bankAccountId", fBank);
    if (fStatus) p.set("status", fStatus);
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
      Promise.resolve().then(() => { if (ignore) return; setRows([]); setNextCursor(null); setLoading(false); toast.error("Rentang tanggal tidak valid."); });
      return () => { ignore = true; };
    }
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(() => fetchReconPage(filterParams()))
      .then((page) => { if (!ignore) { setRows(page.items); setNextCursor(page.nextCursor); setLoading(false); } })
      .catch(() => { if (!ignore) { setLoading(false); toast.error("Gagal memuat rekonsiliasi."); } });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fBank, fStatus, fFrom, fTo]);

  async function refreshFirst() {
    try { const page = await fetchReconPage(filterParams()); setRows(page.items); setNextCursor(page.nextCursor); } catch { /* diam */ }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const p = filterParams(); p.set("cursor", nextCursor);
      const page = await fetchReconPage(p);
      setRows((prev) => [...prev, ...page.items]); setNextCursor(page.nextCursor);
    } catch { toast.error("Gagal memuat tambahan."); } finally { setLoadingMore(false); }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.bankAccountId) { toast.error("Pilih rekening."); return; }
    if (!DATE_RE.test(form.startDate) || !DATE_RE.test(form.endDate)) { toast.error("Tanggal tidak valid."); return; }
    if (form.endDate < form.startDate) { toast.error("Tanggal akhir tidak boleh sebelum tanggal awal."); return; }
    if (!positive(form.statementOpeningBalance) || !positive(form.statementClosingBalance)) { toast.error("Saldo statement tidak valid (boleh negatif)."); return; }

    const body: Record<string, unknown> = {
      bankAccountId: form.bankAccountId,
      startDate: form.startDate,
      endDate: form.endDate,
      statementOpeningBalance: form.statementOpeningBalance,
      statementClosingBalance: form.statementClosingBalance,
    };
    if (form.notes.trim()) body.notes = form.notes.trim();
    if (form.autoMatch) {
      body.autoMatch = true;
      if (form.toleranceDays && INT_0_30_RE.test(form.toleranceDays)) body.toleranceDays = Number(form.toleranceDays);
    }

    setSaving(true);
    try {
      const res = await fetch("/api/reconciliations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) {
        const j = (await res.json()) as { data?: { id?: string } };
        toast.success("Rekonsiliasi dibuat.");
        setForm(emptyForm); setShowForm(false);
        const id = j?.data?.id;
        if (id) router.push(`/treasury/reconciliations/${id}`);
        else await refreshFirst();
      } else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Rekonsiliasi Bank</h1>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Tutup" : "Rekonsiliasi Baru"}</Button>
      </div>

      {showForm && (
        <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Rekening *</label>
            <Select value={form.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)}>
              <option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Tanggal awal *</label>
            <Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Tanggal akhir *</label>
            <Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Saldo awal statement *</label>
            <Input inputMode="decimal" value={form.statementOpeningBalance} onChange={(e) => set("statementOpeningBalance", e.target.value)} placeholder="0.00" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Saldo akhir statement *</label>
            <Input inputMode="decimal" value={form.statementClosingBalance} onChange={(e) => set("statementClosingBalance", e.target.value)} placeholder="0.00" /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.autoMatch} onChange={(e) => set("autoMatch", e.target.checked)} /> Auto-cocokkan saat membuat</label>
          {form.autoMatch && (
            <div className="space-y-1"><label className="text-sm font-medium">Toleransi hari (0–30)</label>
              <Input inputMode="numeric" value={form.toleranceDays} onChange={(e) => set("toleranceDays", e.target.value)} /></div>
          )}
          <div className="space-y-1 sm:col-span-4"><label className="text-sm font-medium">Catatan</label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button type="submit" loading={saving}>Buat &amp; Buka</Button>
            <Button type="button" variant="outline" onClick={() => { setForm(emptyForm); setShowForm(false); }}>Batal</Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Select className="w-44" value={fBank} onChange={(e) => setFBank(e.target.value)}>
          <option value="">Semua rekening</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </Select>
        <Select className="w-36" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Semua status</option>
          <option value="draft">Draf</option><option value="final">Final</option>
        </Select>
        <Input className="w-40" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <Input className="w-40" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada rekonsiliasi.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2">No. Dokumen</th><th className="px-3 py-2">Rekening</th><th className="px-3 py-2">Periode</th>
                  <th className="px-3 py-2 text-right">Saldo Akhir Statement</th><th className="px-3 py-2 text-right">Saldo Buku</th>
                  <th className="px-3 py-2">Status</th><th className="px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-3 py-2 font-mono text-xs">{r.docNo ?? "—"}</td>
                    <td className="px-3 py-2">{r.bankAccountCode} — {r.bankAccountName}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{r.startDate} s/d {r.endDate}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(r.statementClosingBalance)}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(r.bookBalanceEnd)}</td>
                    <td className="px-3 py-2"><span className={RECON_STATUS_STYLE[r.status] ?? ""}>{RECON_STATUS_LABEL[r.status] ?? r.status}</span></td>
                    <td className="px-3 py-2"><Link href={`/treasury/reconciliations/${r.id}`}><Button size="sm" variant="ghost">Buka</Button></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && <div className="flex justify-center"><Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>Muat lebih</Button></div>}
        </>
      )}
    </div>
  );
}
