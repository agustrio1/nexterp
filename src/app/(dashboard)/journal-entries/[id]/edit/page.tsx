"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type AccountOption = { id: string; code: string; name: string };

type Line = {
  accountId: string;
  side: "debit" | "credit";
  amount: string;
  memo: string;
};

type JournalDetail = {
  id: string; status: string; entryDate: string; description: string;
  reference: string | null;
  lines: { accountId: string; accountCode: string; accountName: string; debit: string; credit: string; memo: string | null }[];
};

export default function EditJournalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [entryDate, setEntryDate] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/chart-accounts?isActive=true&isPostable=true", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((json: { data: AccountOption[] }) => setAccounts(json.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/journals/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: JournalDetail }) => {
        if (json.data.status !== "draft") {
          toast.error("Hanya draf yang dapat diubah.");
          router.push(`/journal-entries/${id}`);
          return;
        }
        setEntryDate(json.data.entryDate);
        setDescription(json.data.description);
        setReference(json.data.reference ?? "");
        setLines(json.data.lines.map((l) => ({
          accountId: l.accountId,
          side: parseFloat(l.debit) > 0 ? "debit" : "credit",
          amount: parseFloat(l.debit) > 0 ? l.debit : l.credit,
          memo: l.memo ?? "",
        })));
      })
      .catch(() => toast.error("Gagal memuat jurnal."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function addLine() {
    setLines((prev) => [...prev, { accountId: "", side: "debit", amount: "", memo: "" }]);
  }

  function removeLine(idx: number) {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || description.trim().length < 3) { toast.error("Deskripsi minimal 3 karakter."); return; }

    const body = {
      entryDate,
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
      const res = await fetch(`/api/journals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      if (res.ok) {
        toast.success("Draf diperbarui.");
        router.push(`/journal-entries/${id}`);
      } else {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(err?.error?.message ?? "Gagal menyimpan.");
      }
    } catch {
      toast.error("Koneksi terganggu.");
    } finally {
      setSubmitting(false);
    }
  }

  const totalDebit = lines.filter((l) => l.side === "debit").reduce((s, l) => s + parseFloat(l.amount || "0"), 0);
  const totalCredit = lines.filter((l) => l.side === "credit").reduce((s, l) => s + parseFloat(l.amount || "0"), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/journal-entries/${id}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Edit Draf</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tanggal</label>
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
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
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                      ))}
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
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-4 w-4" /> Tambah Baris
          </Button>
          <p className={`text-sm font-medium ${balanced ? "text-green-600" : "text-red-600"}`}>
            D: {totalDebit.toFixed(2)} | K: {totalCredit.toFixed(2)} {balanced ? "✓" : "✗ Tidak seimbang"}
          </p>
        </div>

        <Button type="submit" loading={submitting} disabled={!balanced}>Simpan Perubahan</Button>
      </form>
    </div>
  );
}
