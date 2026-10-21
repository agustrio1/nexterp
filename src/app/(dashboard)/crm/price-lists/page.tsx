"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type PriceList = { id: string; code: string; name: string; validFrom: string; validTo: string | null; isActive: boolean };

export default function CrmPriceListsPage() {
  const [isActive, setIsActive] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const url = isActive ? `/api/crm/price-lists?isActive=${isActive}` : "/api/crm/price-lists";

  const columns: Column<PriceList>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Berlaku Dari", cell: (r) => r.validFrom ? r.validFrom.slice(0, 10) : "—" },
    { header: "Sampai", cell: (r) => r.validTo ? r.validTo.slice(0, 10) : "—" },
    { header: "Status", cell: (r) => r.isActive ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">Aktif</span> : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">Nonaktif</span> },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/crm/price-lists/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Daftar Harga</h1>
        <Link href="/crm/price-lists/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex gap-2">
        <Select className="w-40" value={isActive} onChange={(e) => { setIsActive(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua</option>
          <option value="true">Aktif</option>
          <option value="false">Nonaktif</option>
        </Select>
      </div>
      <DataTable<PriceList> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada daftar harga." />
    </div>
  );
}
