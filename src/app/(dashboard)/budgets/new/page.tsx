"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  AMOUNT_RE, readError, isPositive,
  fetchFiscalYears, fetchFiscalYearDetail, fetchPostableAccounts, fetchCostCenters,
  type FiscalYear, type Period, type ChartAccount, type CostCenter,
} from "@/app/(dashboard)/budget-tax/_shared";

type DraftLine = { accountId: string; periodId: string; costCenterId: string; amount: string; note: string };

const blankLine = (): DraftLine => ({ accountId: "", periodId: "", costCenterId: "", amount: "", note: "" });

export default function BudgetNewPage() {
  const router = useRouter();
  const refs = useHrRefs();
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [refsLoading, setRefsLoading] = useState(true);

  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    Promise.all([fetchFiscalYears(), fetchPostableAccounts(), fetchCostCenters(true)])
      .then(([y, a, c]) => { if (!ignore) { setYears(y); setAccounts(a); setCostCenters(c); } })
      .catch(() => { if (!ignore) toast.error("Gagal memuat referensi."); })
      .finally(() => { if (!ignore) setRefsLoading(false); });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    let ignore = false;
    if (!fiscalYearId) {
      Promise.resolve().then(() => { if (!ignore) setPeriods([]); });
      return () => { ignore = true; };
    }
    fetchFiscalYearDetail(fiscalYearId)
      .then((d) => { if (!ignore) setPeriods(d.periods); })
      .catch(() => { if (!ignore) toast.error("Gagal memuat periode tahun fiskal."); });
    return () => { ignore = true; };
  }, [fiscalYearId]);

  const setLine = (i: number, k: keyof DraftLine, v: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    if (!fiscalYearId) { toast.error("Pilih tahun fiskal."); return; }
    const clean: Array<Record<string, unknown>> = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const emptyRow = !l.accountId && !l.periodId && !l.amount && !l.costCenterId && !l.note.trim();
      if (emptyRow) continue;
      if (!l.accountId || !l.periodId) { toast.error(`Baris ${i + 1}: akun & periode wajib diisi.`); return; }
      if (!AMOUNT_RE.test(l.amount) || !isPositive(l.amount)) { toast.error(`Baris ${i + 1}: nominal tidak valid.`); return; }
      const row: Record<string, unknown> = { accountId: l.accountId, periodId: l.periodId, amount: l.amount };
      if (l.costCenterId) row.costCenterId = l.costCenterId;
      if (l.note.trim()) row.note = l.note.trim();
      clean.push(row);
    }
    if (clean.length === 0) { toast.error("Anggaran membutuhkan minimal satu baris."); return; }

    const body: Record<string, unknown> = { name: name.trim(), fiscalYearId, lines: clean };
    if (branchId) body.branchId = branchId;
    if (notes.trim()) body.notes = notes.trim();

    void (async () => {
      setSaving(true);
      try {
        const res = await fetch("/api/budgets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
        if (res.ok) {
          const j = (await res.json()) as { data?: { id?: string } };
          toast.success("Draf anggaran dibuat.");
          const id = j?.data?.id;
          router.push(id ? `/budgets/${id}` : "/budgets");
        } else toast.error(await readError(res));
      } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
    })();
  }

  if (refsLoading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  const expenseAccounts = accounts.filter((a) => a.type === "expense" || a.type === "revenue");

  return (
    <div className="space-y-4">
      <Link href="/budgets" className="inline-flex items-center gap-1 text-sm text-zinc-500"><ArrowLeft size={16} /> Kembali</Link>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Anggaran Baru</h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anggaran Operasional 2026" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Tahun Fiskal *</label>
            <Select value={fiscalYearId} onChange={(e) => setFiscalYearId(e.target.value)}>
              <option value="">—</option>{years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
            </Select></div>
          <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select></div>
          <div className="space-y-1 sm:col-span-4"><label className="text-sm font-medium">Catatan</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
            <span className="text-sm font-medium">Baris anggaran {fiscalYearId ? "" : "(pilih tahun fiskal dulu)"}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])} disabled={!fiscalYearId}>
              <Plus size={14} className="mr-1" /> Tambah baris
            </Button>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <Select value={l.accountId} onChange={(e) => setLine(i, "accountId", e.target.value)} disabled={!fiscalYearId}>
                    <option value="">Akun *</option>{expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Select value={l.periodId} onChange={(e) => setLine(i, "periodId", e.target.value)} disabled={!fiscalYearId}>
                    <option value="">Periode *</option>{periods.map((p) => <option key={p.id} value={p.id}>P{p.periodNo}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-3">
                  <Select value={l.costCenterId} onChange={(e) => setLine(i, "costCenterId", e.target.value)}>
                    <option value="">Pusat biaya</option>{costCenters.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-2"><Input inputMode="decimal" placeholder="Nominal *" value={l.amount} onChange={(e) => setLine(i, "amount", e.target.value)} /></div>
                <div className="flex items-center justify-end sm:col-span-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)))} aria-label="Hapus baris">
                    <Trash2 size={16} className="text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="submit" loading={saving}>Simpan Draf</Button>
          <Link href="/budgets"><Button type="button" variant="outline">Batal</Button></Link>
        </div>
      </form>
    </div>
  );
}
