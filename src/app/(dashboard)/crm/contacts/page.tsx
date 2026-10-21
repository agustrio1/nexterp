"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type Contact = { id: string; accountId: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean; isActive: boolean };
type Account = { id: string; code: string; name: string };

export default function CrmContactsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch("/api/crm/accounts?isActive=true", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: Account[] }) => { setAccounts(j.data); if (j.data.length > 0) setAccountId((cur) => cur || j.data[0]!.id); })
      .catch(() => {});
  }, []);

  const fetchUrl = `/api/crm/contacts?accountId=${accountId}`;

  const columns: Column<Contact>[] = [
    { header: "Nama", cell: (r) => r.name },
    { header: "Jabatan", cell: (r) => r.title ?? "—" },
    { header: "Email", cell: (r) => r.email ?? "—" },
    { header: "Telepon", cell: (r) => r.phone ?? "—" },
    { header: "Utama", cell: (r) => (r.isPrimary ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">Utama</span> : "—") },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/crm/contacts/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Kontak CRM</h1>
        {accountId && <Link href={`/crm/contacts/new?accountId=${accountId}`}><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>}
      </div>
      <div className="flex gap-2">
        <Select className="w-72" value={accountId} onChange={(e) => { setAccountId(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">— Pilih akun —</option>
          {accounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
        </Select>
      </div>
      {accountId
        ? <DataTable<Contact> key={refreshKey} url={fetchUrl} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada kontak untuk akun ini." />
        : <p className="py-12 text-center text-sm text-zinc-500">Pilih akun untuk melihat daftarnya.</p>}
    </div>
  );
}
