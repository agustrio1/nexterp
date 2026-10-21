"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  AMOUNT_RE, DATE_RE, readError, rp,
  fetchBankAccounts, fetchPostableAccounts, fetchCostCenters, fetchCashPage,
  TXN_TYPE_LABEL, TXN_STATUS_LABEL, TXN_STATUS_STYLE,
  type CashTxn, type BankAccount, type ChartAccountRef, type CostCenterRef,
} from "@/app/(dashboard)/treasury/_shared";

const TYPES = ["receipt", "disbursement", "transfer"] as const;
const STATUSES = ["draft", "posted", "reversed", "cancelled"] as const;

const emptyForm = {
  transactionDate: "", type: "receipt", bankAccountId: "", contraAccountId: "",
  counterpartBankAccountId: "", amount: "", branchId: "", costCenterId: "",
  description: "", reference: "",
};

type ActionState = { id: string; docNo: string | null; kind: "cancel" | "reverse" } | null;

export default function CashTransactionsPage() {
  const refs = useHrRefs();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [glAccounts, setGlAccounts] = useState<ChartAccountRef[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenterRef[]>([]);

  const [rows, setRows] = useState<CashTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [fBank, setFBank] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [action, setAction] = useState<ActionState>(null);
  const [reason, setReason] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [acting, setActing] = useState(false);

  const set = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function filterParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (fBank) p.set("bankAccountId", fBank);
    if (fType) p.set("type", fType);
    if (fStatus) p.set("status", fStatus);
    if (fFrom) p.set("dateFrom", fFrom);
    if (fTo) p.set("dateTo", fTo);
    p.set("limit", "50");
    return p;
  }

  /* Muat referensi (rekening, akun GL, pusat biaya) sekali. */
  useEffect(() => {
    let ignore = false;
    Promise.all([fetchBankAccounts(true), fetchPostableAccounts(), fetchCostCenters()])
      .then(([b, g, c]) => {
        if (ignore) return;
        setAccounts(b);
        setGlAccounts(g);
        setCostCenters(c);
      })
      .catch(() => { if (!ignore) toast.error("Gagal memuat referensi."); });
    return () => { ignore = true; };
  }, []);

  /* Muat halaman pertama tiap filter berubah (semua setState di callback promise). */
  useEffect(() => {
    let ignore = false;
    if (fFrom && fTo && fTo < fFrom) {
      Promise.resolve().then(() => {
        if (ignore) return;
        setRows([]); setNextCursor(null); setLoading(false);
        toast.error("Rentang tanggal tidak valid.");
      });
      return () => { ignore = true; };
    }
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(() => fetchCashPage(filterParams()))
      .then((page) => { if (!ignore) { setRows(page.items); setNextCursor(page.nextCursor); setLoading(false); } })
      .catch(() => { if (!ignore) { setLoading(false); toast.error("Gagal memuat transaksi."); } });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fBank, fType, fStatus, fFrom, fTo]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const p = filterParams();
      p.set("cursor", nextCursor);
      const page = await fetchCashPage(p);
      setRows((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch { toast.error("Gagal memuat tambahan."); } finally { setLoadingMore(false); }
  }

  function resetForm() { setForm(emptyForm); setShowForm(false); }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!DATE_RE.test(form.transactionDate)) { toast.error("Tanggal transaksi tidak valid."); return; }
    if (!form.bankAccountId) { toast.error("Pilih rekening sumber."); return; }
    if (!AMOUNT_RE.test(form.amount) || !/[1-9]/.test(form.amount.replace(".", ""))) { toast.error("Nominal tidak valid."); return; }
    if (form.description.trim().length < 3) { toast.error("Deskripsi minimal 3 karakter."); return; }

    const body: Record<string, unknown> = {
      transactionDate: form.transactionDate,
      type: form.type,
      bankAccountId: form.bankAccountId,
      amount: form.amount,
      description: form.description.trim(),
    };
    if (form.type === "transfer") {
      if (!form.counterpartBankAccountId || form.counterpartBankAccountId === form.bankAccountId) {
        toast.error("Pilih rekening tujuan transfer (berbeda dari asal)."); return;
      }
      body.counterpartBankAccountId = form.counterpartBankAccountId;
    } else {
      if (!form.contraAccountId) { toast.error("Pilih akun lawan (GL)."); return; }
      body.contraAccountId = form.contraAccountId;
    }
    if (form.branchId) body.branchId = form.branchId;
    if (form.costCenterId) body.costCenterId = form.costCenterId;
    if (form.reference.trim()) body.reference = form.reference.trim();

    setSaving(true);
    try {
      const res = await fetch("/api/cash-transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Draf transaksi dibuat."); resetForm(); await refreshFirst(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function refreshFirst() {
    try {
      const page = await fetchCashPage(filterParams());
      setRows(page.items); setNextCursor(page.nextCursor);
    } catch { /* diam */ }
  }

  async function runAction() {
    if (!action) return;
    if (reason.trim().length < 5) { toast.error("Alasan minimal 5 karakter."); return; }
    const body: Record<string, unknown> = { reason: reason.trim() };
    if (action.kind === "reverse" && entryDate) {
      if (!DATE_RE.test(entryDate)) { toast.error("Tanggal jurnal tidak valid."); return; }
      body.entryDate = entryDate;
    }
    setActing(true);
    try {
      const res = await fetch(`/api/cash-transactions/${action.id}/${action.kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success(action.kind === "cancel" ? "Transaksi dibatalkan." : "Transaksi direversal."); setAction(null); setReason(""); setEntryDate(""); await refreshFirst(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setActing(false); }
  }

  async function doPost(t: CashTxn) {
    const res = await fetch(`/api/cash-transactions/${t.id}/post`, { method: "POST", credentials: "same-origin" });
    if (res.ok) { toast.success("Transaksi diposting."); await refreshFirst(); }
    else toast.error(await readError(res));
  }

  const openActions = (t: CashTxn) =>
    t.status === "draft"
      ? [
          <Button key="p" size="sm" onClick={() => void doPost(t)}>Posting</Button>,
          <Button key="c" size="sm" variant="outline" onClick={() => { setAction({ id: t.id, docNo: t.docNo, kind: "cancel" }); setReason(""); }}>Batal</Button>,
        ]
      : t.status === "posted"
        ? [<Button key="r" size="sm" variant="outline" onClick={() => { setAction({ id: t.id, docNo: t.docNo, kind: "reverse" }); setReason(""); setEntryDate(""); }}>Reversal</Button>]
        : <span className="text-xs text-zinc-400">—</span>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Transaksi Kas &amp; Bank</h1>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Tutup" : "Transaksi Baru"}</Button>
      </div>

      {showForm && (
        <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1"><label className="text-sm font-medium">Tanggal *</label>
            <Input type="date" value={form.transactionDate} onChange={(e) => set("transactionDate", e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Jenis *</label>
            <Select value={form.type} onChange={(e) => set("type", e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{TXN_TYPE_LABEL[t]}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Rekening {form.type === "transfer" ? "asal" : "*"} *</label>
            <Select value={form.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)}>
              <option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nominal *</label>
            <Input inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" /></div>
          {form.type === "transfer" ? (
            <div className="space-y-1"><label className="text-sm font-medium">Rekening tujuan *</label>
              <Select value={form.counterpartBankAccountId} onChange={(e) => set("counterpartBankAccountId", e.target.value)}>
                <option value="">—</option>{accounts.filter((a) => a.id !== form.bankAccountId).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </Select></div>
          ) : (
            <div className="space-y-1"><label className="text-sm font-medium">Akun lawan (GL) *</label>
              <Select value={form.contraAccountId} onChange={(e) => set("contraAccountId", e.target.value)}>
                <option value="">—</option>{glAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </Select></div>
          )}
          <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
            <Select value={form.branchId} onChange={(e) => set("branchId", e.target.value)}>
              <option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Pusat Biaya</label>
            <Select value={form.costCenterId} onChange={(e) => set("costCenterId", e.target.value)}>
              <option value="">—</option>{costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Referensi</label>
            <Input value={form.reference} onChange={(e) => set("reference", e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-4"><label className="text-sm font-medium">Deskripsi *</label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button type="submit" loading={saving}>Simpan Draf</Button>
            <Button type="button" variant="outline" onClick={resetForm}>Batal</Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Select className="w-44" value={fBank} onChange={(e) => setFBank(e.target.value)}>
          <option value="">Semua rekening</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </Select>
        <Select className="w-36" value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">Semua jenis</option>{TYPES.map((t) => <option key={t} value={t}>{TXN_TYPE_LABEL[t]}</option>)}
        </Select>
        <Select className="w-36" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Semua status</option>{STATUSES.map((s) => <option key={s} value={s}>{TXN_STATUS_LABEL[s]}</option>)}
        </Select>
        <Input className="w-40" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <Input className="w-40" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada transaksi.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2">No. Dokumen</th><th className="px-3 py-2">Tanggal</th><th className="px-3 py-2">Jenis</th>
                  <th className="px-3 py-2">Rekening</th><th className="px-3 py-2">Lawan</th><th className="px-3 py-2 text-right">Nominal</th>
                  <th className="px-3 py-2">Status</th><th className="px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-3 py-2 font-mono text-xs">{t.docNo ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{t.transactionDate}</td>
                    <td className="px-3 py-2">{TXN_TYPE_LABEL[t.type] ?? t.type}</td>
                    <td className="px-3 py-2">{t.bankAccountCode}</td>
                    <td className="px-3 py-2 text-xs">{t.type === "transfer" ? (t.counterpartCode ?? "—") : (t.contraAccountCode ?? "—")}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(t.amount)}</td>
                    <td className="px-3 py-2"><span className={TXN_STATUS_STYLE[t.status] ?? ""}>{TXN_STATUS_LABEL[t.status] ?? t.status}</span></td>
                    <td className="px-3 py-2"><div className="flex gap-2">{openActions(t)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && (
            <div className="flex justify-center"><Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>Muat lebih</Button></div>
          )}
        </>
      )}

      {action && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {action.kind === "cancel" ? "Batalkan draf" : "Reversal transaksi"} {action.docNo ? `(${action.docNo})` : ""}
            </h2>
            <div className="mt-4 space-y-3">
              <div className="space-y-1"><label className="text-sm font-medium">Alasan * (min. 5)</label>
                <textarea className="flex min-h-20 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              {action.kind === "reverse" && (
                <div className="space-y-1"><label className="text-sm font-medium">Tanggal jurnal (opsional)</label>
                  <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setAction(null)} disabled={acting}>Batal</Button>
              <Button variant="destructive" size="sm" loading={acting} onClick={() => void runAction()}>Konfirmasi</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
