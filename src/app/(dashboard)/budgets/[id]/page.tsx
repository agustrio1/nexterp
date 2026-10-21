"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  AMOUNT_RE, readError, rp, isPositive,
  fetchBudgetDetail, fetchBudgetRealization, fetchFiscalYearDetail,
  fetchPostableAccounts, fetchCostCenters,
  BUDGET_STATUS_LABEL, BUDGET_STATUS_STYLE, COST_TYPE_LABEL,
  type BudgetDetail, type Period, type ChartAccount, type CostCenter, type BudgetRealization,
} from "@/app/(dashboard)/budget-tax/_shared";

type DraftLine = { accountId: string; periodId: string; costCenterId: string; amount: string; note: string };
const blankLine = (): DraftLine => ({ accountId: "", periodId: "", costCenterId: "", amount: "", note: "" });

export default function BudgetDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [detail, setDetail] = useState<BudgetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [periods, setPeriods] = useState<Period[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  const [recon, setRecon] = useState<BudgetRealization | null>(null);
  const [reconLoading, setReconLoading] = useState(false);

  const load = useCallback(async () => {
    const d = await fetchBudgetDetail(id);
    setDetail(d);
    setName(d.name);
    setNotes(d.notes ?? "");
    setLines(d.lines.map((l) => ({
      accountId: l.accountId, periodId: l.periodId, costCenterId: l.costCenterId ?? "",
      amount: l.amount, note: l.note ?? "",
    })));
  }, [id]);

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(load)
      .then(() => { if (!ignore) setLoading(false); })
      .catch(() => { if (!ignore) { setLoading(false); setNotFound(true); } });
    return () => { ignore = true; };
  }, [id, load]);

  /* Muat referensi (periode FY, akun, pusat biaya) saat mode ubah. */
  useEffect(() => {
    if (!editing || !detail) return;
    let ignore = false;
    Promise.all([fetchFiscalYearDetail(detail.fiscalYearId), fetchPostableAccounts(), fetchCostCenters(true)])
      .then(([fy, a, c]) => { if (!ignore) { setPeriods(fy.periods); setAccounts(a); setCostCenters(c); } })
      .catch(() => { if (!ignore) toast.error("Gagal memuat referensi."); });
    return () => { ignore = true; };
  }, [editing, detail]);

  const setLine = (i: number, k: keyof DraftLine, v: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  async function saveChanges() {
    if (!detail) return;
    if (name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    const clean: Array<Record<string, unknown>> = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const emptyRow = !l.accountId && !l.periodId && !l.amount && !l.costCenterId && !l.note.trim();
      if (emptyRow) continue;
      if (!l.accountId || !l.periodId) { toast.error(`Baris ${i + 1}: akun & periode wajib.`); return; }
      if (!AMOUNT_RE.test(l.amount) || !isPositive(l.amount)) { toast.error(`Baris ${i + 1}: nominal tidak valid.`); return; }
      const row: Record<string, unknown> = { accountId: l.accountId, periodId: l.periodId, amount: l.amount };
      if (l.costCenterId) row.costCenterId = l.costCenterId;
      if (l.note.trim()) row.note = l.note.trim();
      clean.push(row);
    }
    if (clean.length === 0) { toast.error("Minimal satu baris."); return; }

    setSaving(true);
    try {
      const hRes = await fetch(`/api/budgets/${detail.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), notes: notes.trim() || null }), credentials: "same-origin" });
      if (!hRes.ok) { toast.error(await readError(hRes)); return; }
      const lRes = await fetch(`/api/budgets/${detail.id}/lines`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: clean }), credentials: "same-origin" });
      if (!lRes.ok) { toast.error(await readError(lRes)); return; }
      toast.success("Anggaran disimpan.");
      setEditing(false);
      await load();
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function approve() {
    if (!detail) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/budgets/${detail.id}/approve`, { method: "POST", credentials: "same-origin" });
      if (res.ok) { toast.success("Anggaran disetujui & dikunci."); await load(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setApproving(false); }
  }

  async function showRealization() {
    setReconLoading(true);
    try { setRecon(await fetchBudgetRealization(id)); }
    catch { toast.error("Gagal memuat realisasi."); }
    finally { setReconLoading(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (notFound || !detail) return (
    <div className="space-y-4">
      <Link href="/budgets" className="inline-flex items-center gap-1 text-sm text-zinc-500"><ArrowLeft size={16} /> Kembali</Link>
      <p className="text-sm text-zinc-400">Anggaran tidak ditemukan.</p>
    </div>
  );

  const isDraft = detail.status === "draft";
  const total = detail.lines.reduce((s, l) => s + Number(l.amount), 0);
  const expenseAccounts = accounts.filter((a) => a.type === "expense" || a.type === "revenue");

  return (
    <div className="space-y-4">
      <Link href="/budgets" className="inline-flex items-center gap-1 text-sm text-zinc-500"><ArrowLeft size={16} /> Kembali ke daftar</Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{detail.name}</h1>
          <p className="text-sm text-zinc-500">{detail.docNo ?? "Draf"} · TF {detail.fiscalYearCode} · {detail.branchName ?? "Seluruh cabang"}</p>
        </div>
        <span className={BUDGET_STATUS_STYLE[detail.status] ?? ""}>{BUDGET_STATUS_LABEL[detail.status] ?? detail.status}</span>
      </div>

      {detail.notes && !editing && <p className="text-sm text-zinc-600 dark:text-zinc-400">Catatan: {detail.notes}</p>}

      <div className="flex flex-wrap gap-2">
        {isDraft && !editing && <Button variant="outline" onClick={() => setEditing(true)}>Ubah</Button>}
        {isDraft && !editing && detail.lines.length > 0 && <Button loading={approving} onClick={() => void approve()}>Setujui &amp; Kunci</Button>}
        <Button variant="outline" loading={reconLoading} onClick={() => void showRealization()}>Lihat Realisasi</Button>
      </div>

      {!editing ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Periode</th><th className="px-3 py-2">Akun</th><th className="px-3 py-2">Tipe</th>
                <th className="px-3 py-2">Pusat Biaya</th><th className="px-3 py-2 text-right">Nominal</th><th className="px-3 py-2">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2">P{l.periodNo}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.accountCode} — {l.accountName}</td>
                  <td className="px-3 py-2 text-xs">{COST_TYPE_LABEL[l.accountType] ?? l.accountType}</td>
                  <td className="px-3 py-2 text-xs">{l.costCenterCode ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{rp(l.amount)}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{l.note ?? "—"}</td>
                </tr>
              ))}
              {detail.lines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-zinc-400">Belum ada baris.</td></tr>}
            </tbody>
            {detail.lines.length > 0 && (
              <tfoot><tr className="border-t border-zinc-200 dark:border-zinc-800"><td colSpan={4} className="px-3 py-2 text-right text-xs uppercase text-zinc-500">Total</td><td className="px-3 py-2 text-right font-mono">{rp(total)}</td><td /></tr></tfoot>
            )}
          </table>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Catatan</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus size={14} className="mr-1" /> Tambah baris</Button>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <Select value={l.accountId} onChange={(e) => setLine(i, "accountId", e.target.value)}>
                    <option value="">Akun *</option>{expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Select value={l.periodId} onChange={(e) => setLine(i, "periodId", e.target.value)}>
                    <option value="">Periode *</option>{periods.map((p) => <option key={p.id} value={p.id}>P{p.periodNo}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Select value={l.costCenterId} onChange={(e) => setLine(i, "costCenterId", e.target.value)}>
                    <option value="">Pusat biaya</option>{costCenters.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-3"><Input inputMode="decimal" placeholder="Nominal *" value={l.amount} onChange={(e) => setLine(i, "amount", e.target.value)} /></div>
                <div className="flex items-center justify-end sm:col-span-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)))}><Trash2 size={16} className="text-red-500" /></Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button loading={saving} onClick={() => void saveChanges()}>Simpan</Button>
            <Button variant="outline" onClick={() => { setEditing(false); void load(); }}>Batal</Button>
          </div>
        </div>
      )}

      {recon && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Realisasi vs Anggaran</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2">Periode</th><th className="px-3 py-2">Akun</th>
                  <th className="px-3 py-2 text-right">Anggaran</th><th className="px-3 py-2 text-right">Realisasi</th>
                  <th className="px-3 py-2 text-right">Selisih</th><th className="px-3 py-2 text-right">% Realisasi</th>
                </tr>
              </thead>
              <tbody>
                {recon.lines.map((l, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-3 py-2">P{l.periodNo}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.accountCode} — {l.accountName}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(l.budget)}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(l.actual)}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(l.variance)}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.realizationPct === null ? "—" : `${Number(l.realizationPct).toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 dark:border-zinc-800">
                  <td colSpan={2} className="px-3 py-2 text-right text-xs uppercase text-zinc-500">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{rp(recon.totals.budget)}</td>
                  <td className="px-3 py-2 text-right font-mono">{rp(recon.totals.actual)}</td>
                  <td className="px-3 py-2 text-right font-mono">{rp(recon.totals.variance)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
