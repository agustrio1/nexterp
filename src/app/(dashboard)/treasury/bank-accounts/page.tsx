"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  CODE_RE, fetchBankAccounts, fetchPostableAccounts, readError,
  type BankAccount, type ChartAccountRef,
} from "@/app/(dashboard)/treasury/_shared";

const KINDS = ["cash", "bank"] as const;

const empty = {
  code: "", name: "", accountId: "", kind: "bank",
  bankName: "", accountNumber: "", branchId: "", description: "",
};

export default function BankAccountsPage() {
  const refs = useHrRefs();
  const [rows, setRows] = useState<BankAccount[]>([]);
  const [accounts, setAccounts] = useState<ChartAccountRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [form, setForm] = useState(empty);

  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function reload() {
    setLoading(true);
    try {
      setRows(await fetchBankAccounts());
    } catch { toast.error("Gagal memuat rekening."); } finally { setLoading(false); }
  }

  useEffect(() => {
    let ignore = false;
    Promise.all([fetchBankAccounts(), fetchPostableAccounts()])
      .then(([a, c]) => { if (!ignore) { setRows(a); setAccounts(c.filter((x) => x.type === "asset")); } })
      .catch(() => { if (!ignore) toast.error("Gagal memuat data."); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, []);

  function startEdit(r: BankAccount) {
    setEditingId(r.id);
    setIsActive(r.isActive);
    setForm({
      code: r.code, name: r.name, accountId: r.accountId, kind: r.kind,
      bankName: r.bankName ?? "", accountNumber: r.accountNumber ?? "",
      branchId: r.branchId ?? "", description: r.description ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null); setIsActive(true); setForm(empty);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const code = form.code.trim().toUpperCase();
    if (!CODE_RE.test(code)) { toast.error("Kode rekening tidak valid."); return; }
    if (form.name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    if (!form.accountId) { toast.error("Pilih akun GL penampung."); return; }

    const assetFields: Record<string, unknown> = {
      name: form.name.trim(), accountId: form.accountId, kind: form.kind,
      bankName: form.kind === "bank" ? (form.bankName.trim() || null) : null,
      accountNumber: form.kind === "bank" ? (form.accountNumber.trim() || null) : null,
      branchId: form.branchId || null,
      description: form.description.trim() || null,
    };

    setSaving(true);
    try {
      if (editingId) {
        const body = { ...assetFields, isActive };
        const res = await fetch(`/api/bank-accounts/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
        if (res.ok) { toast.success("Rekening diperbarui."); reset(); await reload(); }
        else toast.error(await readError(res));
      } else {
        const body = { ...assetFields, code };
        const res = await fetch("/api/bank-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
        if (res.ok) { toast.success("Rekening dibuat."); reset(); setForm(empty); await reload(); }
        else toast.error(await readError(res));
      }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Rekening Kas &amp; Bank</h1>

      <form onSubmit={onSave} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label>
          <Input value={form.code} onChange={(e) => set("code", e.target.value)} disabled={!!editingId} placeholder="KAS-01" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Jenis *</label>
          <Select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{k === "cash" ? "Kas" : "Bank"}</option>)}
          </Select></div>
        <div className="space-y-1"><label className="text-sm font-medium">Akun GL (aset) *</label>
          <Select value={form.accountId} onChange={(e) => set("accountId", e.target.value)}>
            <option value="">—</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </Select></div>
        {form.kind === "bank" && (<>
          <div className="space-y-1"><label className="text-sm font-medium">Nama Bank</label>
            <Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">No. Rekening</label>
            <Input value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} /></div>
        </>)}
        <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
          <Select value={form.branchId} onChange={(e) => set("branchId", e.target.value)}>
            <option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select></div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Deskripsi</label>
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
        {editingId && (
          <div className="flex items-center"><label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label></div>
        )}
        <div className="flex items-end gap-2">
          <Button type="submit" loading={saving}>{editingId ? "Simpan" : "Tambah Rekening"}</Button>
          {editingId && <Button type="button" variant="outline" onClick={reset}>Batal</Button>}
        </div>
      </form>
      <p className="text-xs text-zinc-500">Akun GL penampung harus postable &amp; bertipe aset. Menonaktifkan rekening gagal bila masih dipakai transaksi kas aktif.</p>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada rekening.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Kode</th><th className="px-3 py-2">Nama</th><th className="px-3 py-2">Jenis</th>
                <th className="px-3 py-2">Akun GL</th><th className="px-3 py-2">Bank / No.</th><th className="px-3 py-2">Cabang</th>
                <th className="px-3 py-2">Status</th><th className="px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">{r.kind === "cash" ? "Kas" : "Bank"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.accountCode} — {r.accountName}</td>
                  <td className="px-3 py-2">{r.kind === "bank" ? `${r.bankName ?? "—"}${r.accountNumber ? ` · ${r.accountNumber}` : ""}` : "—"}</td>
                  <td className="px-3 py-2">{r.branchId ? refs.branchMap.get(r.branchId)?.name ?? "—" : "—"}</td>
                  <td className="px-3 py-2">{r.isActive ? <span className="text-green-600">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>}</td>
                  <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => startEdit(r)}>Ubah</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
