"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type AccountOption = { id: string; code: string; name: string };
type FiscalYear = { id: string; code: string; startDate: string; endDate: string };

type Line = { accountId: string; side: "debit" | "credit"; amount: string; memo: string };

export default function OpeningBalancePage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [description, setDescription] = useState("Saldo Awal");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { accountId: "", side: "debit", amount: "", memo: "" },
    { accountId: "", side: "credit", amount: "", memo: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/chart-accounts?isActive=true&isPostable=true", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((json: { data: AccountOption[] }) => setAccounts(json.data))
      .catch(() => {});
    fetch("/api/fiscal-years", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((json: { data: FiscalYear[] }) => setFiscalYears(json.data))
      .catch(() => {});
  }, []);

  function addLine() { setLines((prev) => [...prev, { accountId: "", side: "debit", amount: "", memo: "" }]); }
  function removeLine(idx: number) { if (lines.length > 2) setLines((prev) => prev.filter((_, i) => i !== idx)); }
  function updateLine(idx: number, patch: Partial<Line>) { setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))); }

  const totalDebit = lines.filter((l) => l.side === "debit").reduce((s, l) => s + parseFloat(l.amount || "0"), 0);
  const totalCredit = lines.filter((l) => l.side === "credit").reduce((s, l) => s + parseFloat(l.amount || "0"), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fiscalYearId) { toast.error("Pilih tahun fiskal."); return; }
    if (!description.trim() || description.trim().length < 3) { toast.error("Deskripsi minimal 3 karakter."); return; }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].accountId) { toast.error(`Baris ${i + 1}: pilih akun.`); return; }
      if (!lines[i].amount || !/^\d{1,16}(\.\d{1,2})?$/.test(lines[i].amount)) { toast.error(`Baris ${i + 1}: nominal tidak valid.`); return; }
    }
    if (!balanced) { toast.error("Saldo awal tidak seimbang."); return; }

    const body = {
      fiscalYearId,
      description: description.trim(),
      reference: reference.trim() || undefined,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        side: l.side,
        amount: l.amount,
        memo: l.memo.trim() || undefined,
      })),
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/opening-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      if (res.ok) {
        const json = (await res.json()) as { data: { id: string } };
        toast.success("Draf saldo awal dibuat. Posting lewat halaman jurnal.");
        router.push(`/journal-entries/${json.data.id}`);
      } else {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(err?.error?.message ?? "Gagal membuat saldo awal.");
      }
    } catch { toast.error("Koneksi terganggu."); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Saldo Awal</h1>
      <p className="text-sm text-zinc-500">Membuat draf jurnal saldo awal untuk tahun fiskal terpilih. Posting dilakukan terpisah melalui halaman jurnal.</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tahun Fiskal *</label>
            <Select className="w-full" value={fiscalYearId} onChange={(e) => setFiscalYearId(e.target.value)}>
              <option value="">— Pilih —</option>
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>{fy.code} ({fy.startDate} — {fy.endDate})</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Referensi</label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Opsional" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Deskripsi *</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} required minLength={3} />
        </div>

        {/* Lines table */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Akun</th>
                <th className="px-3 py-2 text-left">Sisi</th>
                <th className="px-3 py-2 text-left">Nominal</th>
                <th className="px-3 py-2 text-left">Memo</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2 text-zinc-500">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <Select className="w-full min-w-[160px]" value={line.accountId} onChange={(e) => updateLine(idx, { accountId: e.target.value })}>
                      <option value="">— Pilih Akun —</option>
                      {accounts.map((a) => (<option key={a.id} value={a.id}>{a.code} {a.name}</option>))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Select className="w-24" value={line.side} onChange={(e) => updateLine(idx, { side: e.target.value as "debit" | "credit" })}>
                      <option value="debit">Debit</option>
                      <option value="credit">Kredit</option>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Input className="w-32" type="text" inputMode="decimal" placeholder="0.00" value={line.amount} onChange={(e) => updateLine(idx, { amount: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <Input className="w-32" value={line.memo} onChange={(e) => updateLine(idx, { memo: e.target.value })} placeholder="Opsional" />
                  </td>
                  <td className="px-2 py-2">
                    {lines.length > 2 && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(idx)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="h-4 w-4" /> Tambah Baris</Button>
          <p className={`text-sm font-medium ${balanced ? "text-green-600" : "text-red-600"}`}>
            D: {totalDebit.toFixed(2)} | K: {totalCredit.toFixed(2)} {balanced ? "✓" : "✗ Tidak seimbang"}
          </p>
        </div>

        <Button type="submit" loading={submitting} disabled={!balanced || !fiscalYearId}>Buat Draf Saldo Awal</Button>
      </form>
    </div>
  );
}
