"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Note = { id: string; content: string; accountName: string | null; authorName: string | null; createdAt: string };
type Account = { id: string; name: string };

export default function CrmNotesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filterAccount, setFilterAccount] = useState("");

  const [accountId, setAccountId] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/crm/accounts?isActive=true", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: Account[] }) => setAccounts(j.data))
      .catch(() => {});
  }, []);

  const url = filterAccount ? `/api/crm/notes?accountId=${filterAccount}` : "/api/crm/notes";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (content.trim().length < 1) { toast.error("Isi catatan wajib diisi."); return; }
    const body: Record<string, unknown> = { content: content.trim() };
    if (accountId) body.accountId = accountId;
    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Catatan disimpan."); setContent(""); setRefreshKey((k) => k + 1); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  const columns: Column<Note>[] = [
    { header: "Tanggal", cell: (r) => r.createdAt ? r.createdAt.slice(0, 16).replace("T", " ") : "—" },
    { header: "Akun", cell: (r) => r.accountName ?? "—" },
    { header: "Catatan", cell: (r) => <span className="line-clamp-2">{r.content}</span> },
    { header: "Penulis", cell: (r) => r.authorName ?? "—" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Catatan</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Akun</label>
          <Select className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— Tanpa akun —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Catatan *</label><Input value={content} onChange={(e) => setContent(e.target.value)} /></div>
        <div className="flex items-end"><Button type="submit" loading={submitting}>Simpan Catatan</Button></div>
      </form>

      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-500">Filter akun:</span>
        <Select className="w-64" value={filterAccount} onChange={(e) => { setFilterAccount(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua akun</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </div>
      <DataTable<Note> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada catatan." />
    </div>
  );
}
