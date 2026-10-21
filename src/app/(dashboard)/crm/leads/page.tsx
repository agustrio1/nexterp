"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Lead = { id: string; name: string; source: string | null; status: string; company: string | null; contactName: string | null; email: string | null; assignedToName: string | null };

const STATUS_STYLE: Record<string, string> = {
  new: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  contacted: "rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  qualified: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  discarded: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
  converted: "rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

export default function CrmLeadsPage() {
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const url = search ? `/api/crm/leads?search=${encodeURIComponent(search)}` : "/api/crm/leads";

  const columns: Column<Lead>[] = [
    { header: "Nama Lead", cell: (r) => r.name },
    { header: "Perusahaan", cell: (r) => r.company ?? "—" },
    { header: "Kontak", cell: (r) => r.contactName ?? "—" },
    { header: "Email", cell: (r) => r.email ?? "—" },
    { header: "Sumber", cell: (r) => r.source ?? "—" },
    { header: "Ditagihkan", cell: (r) => r.assignedToName ?? "—" },
    { header: "Status", cell: (r) => <span className={STATUS_STYLE[r.status] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{r.status}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/crm/leads/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Leads (Prospek)</h1>
        <Link href="/crm/leads/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex gap-2">
        <Input className="w-64" placeholder="Cari nama / perusahaan…" value={search} onChange={(e) => { setSearch(e.target.value); setRefreshKey((k) => k + 1); }} />
      </div>
      <DataTable<Lead> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada lead." />
    </div>
  );
}
