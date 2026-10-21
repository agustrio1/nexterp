"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Account = { id: string; code: string; name: string; type: string; city: string | null; phone: string | null; email: string | null; isActive: boolean };

const TYPE_STYLE: Record<string, string> = {
  prospect: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  customer: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  partner: "rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

export default function CrmAccountsPage() {
  const [search, setSearch] = useState("");
  const [isActive, setIsActive] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (isActive) params.set("isActive", isActive);
  const qs = params.toString();
  const url = qs ? `/api/crm/accounts?${qs}` : "/api/crm/accounts";

  const columns: Column<Account>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Tipe", cell: (r) => <span className={TYPE_STYLE[r.type] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{r.type}</span> },
    { header: "Kota", cell: (r) => r.city ?? "—" },
    { header: "Telepon", cell: (r) => r.phone ?? "—" },
    { header: "Email", cell: (r) => r.email ?? "—" },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/crm/accounts/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Akun CRM</h1>
        <Link href="/crm/accounts/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex gap-2">
        <Input className="w-64" placeholder="Cari kode / nama…" value={search} onChange={(e) => { setSearch(e.target.value); setRefreshKey((k) => k + 1); }} />
        <Select className="w-40" value={isActive} onChange={(e) => { setIsActive(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
      </div>
      <DataTable<Account> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada akun CRM." />
    </div>
  );
}
