"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DialogConfirm } from "@/components/ui/dialog-confirm";
import {
  AMOUNT_RE, RATE_RE, rp,
  STATUTORY_KIND_LABEL, PARTY_LABEL,
} from "@/app/(dashboard)/payroll/_shared";

type Bracket = { id: string; ruleId: string; orderNo: number; minAmount: string; maxAmount: string | null; rate: string; source: string };
type RuleDetail = {
  id: string; code: string; kind: string; party: string; name: string;
  rate: string | null; flatAmount: string | null; wageCap: string | null;
  source: string; effectiveFrom: string; isActive: boolean; brackets: Bracket[];
};

export default function PayrollStatutoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [rule, setRule] = useState<RuleDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [orderNo, setOrderNo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [rate, setRate] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [eMin, setEMin] = useState("");
  const [eMax, setEMax] = useState("");
  const [eRate, setERate] = useState("");
  const [eSource, setESource] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch(`/api/payroll/statutory/${id}`, { credentials: "same-origin" })
      .then((res) => res.ok ? res.json() as Promise<{ data: RuleDetail }> : Promise.reject(new Error(String(res.status))))
      .then((j) => { setRule(j.data); setLoading(false); })
      .catch(() => { toast.error("Gagal memuat aturan."); setLoading(false); });
  }, [id]);

  async function reload() {
    const res = await fetch(`/api/payroll/statutory/${id}`, { credentials: "same-origin" });
    if (res.ok) { const j = (await res.json()) as { data: RuleDetail }; setRule(j.data); }
  }

  async function addBracket(e: React.FormEvent) {
    e.preventDefault();
    if (!rule) return;
    if (!orderNo || !/^\d+$/.test(orderNo)) { toast.error("Urutan wajib (bilangan bulat)."); return; }
    if (!AMOUNT_RE.test(minAmount)) { toast.error(" batas bawah tidak valid."); return; }
    if (!RATE_RE.test(rate)) { toast.error("Tarif tidak valid (maks 5 digit, 4 desimal)."); return; }
    if (!source.trim() || source.trim().length < 3) { toast.error("Sumber regulasi wajib (min 3 karakter)."); return; }
    if (maxAmount && !AMOUNT_RE.test(maxAmount)) { toast.error("Batas atas tidak valid."); return; }
    const body: Record<string, unknown> = { orderNo: Number(orderNo), minAmount, rate, source: source.trim() };
    if (maxAmount) body.maxAmount = maxAmount;
    setSaving(true);
    try {
      const res = await fetch(`/api/payroll/statutory/${rule.id}/brackets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Bracket ditambahkan."); setOrderNo(""); setMinAmount(""); setMaxAmount(""); setRate(""); setSource(""); await reload(); }
      else toast.error(j?.error?.message ?? "Gagal menambah bracket.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  function startEdit(b: Bracket) {
    setEditId(b.id);
    setEMin(b.minAmount); setEMax(b.maxAmount ?? ""); setERate(b.rate); setESource(b.source);
  }

  async function saveEdit() {
    if (!editId) return;
    if (!AMOUNT_RE.test(eMin)) { toast.error("Batas bawah tidak valid."); return; }
    if (!RATE_RE.test(eRate)) { toast.error("Tarif tidak valid."); return; }
    if (eMax && !AMOUNT_RE.test(eMax)) { toast.error("Batas atas tidak valid."); return; }
    const body: Record<string, unknown> = { minAmount: eMin, rate: eRate, source: eSource.trim() };
    body.maxAmount = eMax || null;
    setEditing(true);
    try {
      const res = await fetch(`/api/payroll/statutory/brackets/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Bracket diperbarui."); setEditId(null); await reload(); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  async function deleteBracket(bid: string) {
    try {
      const res = await fetch(`/api/payroll/statutory/brackets/${bid}`, { method: "DELETE", credentials: "same-origin" });
      if (res.ok) { toast.success("Bracket dihapus."); await reload(); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal menghapus."); }
    } catch { toast.error("Koneksi terganggu."); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!rule) return <p className="text-zinc-500">Aturan tidak ditemukan.</p>;

  return (
    <div className="space-y-4">
      <Link href="/payroll/statutory" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Aturan Statutory
      </Link>
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{rule.name}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          <code className="font-mono">{rule.code}</code> · {STATUTORY_KIND_LABEL[rule.kind] ?? rule.kind} · {PARTY_LABEL[rule.party] ?? rule.party}
          {rule.rate ? ` · Tarif ${rule.rate}%` : ""}{rule.wageCap ? ` · Batas ${rp(rule.wageCap)}` : ""} · Sumber: {rule.source}
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 font-medium text-zinc-900 dark:text-zinc-50">Bracket Progresif</h2>
        <form onSubmit={addBracket} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="space-y-1"><label className="text-sm font-medium">Urutan *</label><Input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="1" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Batas Bawah *</label><Input value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Batas Atas</label><Input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="∞ bila kosong" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Tarif (%) *</label><Input value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Sumber *</label><Input value={source} onChange={(e) => setSource(e.target.value)} /></div>
          <div className="flex items-end sm:col-span-5"><Button type="submit" loading={saving}>Tambah Bracket</Button></div>
        </form>
      </div>

      {editId && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-5">
          <div className="space-y-1"><label className="text-sm font-medium">Batas Bawah</label><Input value={eMin} onChange={(e) => setEMin(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Batas Atas</label><Input value={eMax} onChange={(e) => setEMax(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Tarif (%)</label><Input value={eRate} onChange={(e) => setERate(e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Sumber</label><Input value={eSource} onChange={(e) => setESource(e.target.value)} /></div>
          <div className="flex gap-2 sm:col-span-5"><Button size="sm" loading={editing} onClick={() => void saveEdit()}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Urutan</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Batas Bawah</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Batas Atas</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Tarif</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Sumber</th>
              <th className="w-[150px] px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rule.brackets.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Belum ada bracket.</td></tr>}
            {rule.brackets.map((b) => (
              <tr key={b.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-4 py-3">{b.orderNo}</td>
                <td className="px-4 py-3 font-mono">{rp(b.minAmount)}</td>
                <td className="px-4 py-3 font-mono">{b.maxAmount ? rp(b.maxAmount) : "∞"}</td>
                <td className="px-4 py-3">{b.rate}%</td>
                <td className="px-4 py-3">{b.source}</td>
                <td className="flex gap-1 px-4 py-3">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(b)}>Ubah</Button>
                  <DialogConfirm trigger={<Button variant="ghost" size="sm" className="text-red-600">Hapus</Button>} title="Hapus bracket?" description="Tindakan ini tidak dapat dibatalkan." confirmLabel="Hapus" destructive onConfirm={() => deleteBracket(b.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
