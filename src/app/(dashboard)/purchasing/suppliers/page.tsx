"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Supplier = { id: string; code: string; name: string; taxId: string | null; currency: string; paymentTermsName: string | null; email: string | null; isActive: boolean };

export default function SuppliersPage() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (applied) params.set("search", applied);
  const qs = params.toString();
  const url = qs ? `/api/purchasing/suppliers?${qs}` : "/api/purchasing/suppliers";
  const fetchUrl = `${url}${url.includes("?") ? "&" : "?"}_r=${refreshKey}`;

  const columns: Column<Supplier>[] = [
    { header: "Kode", cell: (s) => <code className="text-xs font-mono">{s.code}</code> },
    { header: "Nama", cell: (s) => s.name },
    { header: "NPWP", cell: (s) => s.taxId ?? "—" },
    { header: "Mata Uang", cell: (s) => s.currency },
    { header: "Termin", cell: (s) => s.paymentTermsName ?? "—" },
    { header: "Email", cell: (s) => s.email ?? "—" },
    {
      header: "Status", cell: (s) => (
        <span className={s.isActive ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300" : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}>{s.isActive ? "Aktif" : "Nonaktif"}</span>
      ),
    },
    { header: "Aksi", className: "w-[80px]", cell: (s) => <Link href={`/purchasing/suppliers/${s.id}`}><Button variant="ghost" size="sm">Edit</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pemasok</h1>
        <Link href="/purchasing/suppliers/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); setRefreshKey((k) => k + 1); }}>
        <Input className="w-64" placeholder="Cari kode / nama…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit" variant="outline" size="sm">Cari</Button>
      </form>
      <DataTable<Supplier> key={refreshKey} url={fetchUrl} columns={columns} rowKey={(s) => s.id} emptyMessage="Belum ada pemasok." />
    </div>
  );
}
