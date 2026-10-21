"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Customer = { id: string; code: string; accountName: string; creditLimit: string | null; paymentTermsName: string | null; priceListName: string | null; currency: string; isActive: boolean };

export default function CrmCustomersPage() {
  const [search, setSearch] = useState("");
  const [isActive, setIsActive] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (isActive) params.set("isActive", isActive);
  const qs = params.toString();
  const url = qs ? `/api/crm/customers?${qs}` : "/api/crm/customers";

  const columns: Column<Customer>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono">{r.code}</code> },
    { header: "Akun", cell: (r) => r.accountName },
    { header: "Batas Kredit", cell: (r) => r.creditLimit ? `${r.currency} ${Number(r.creditLimit).toLocaleString("id-ID")}` : "—" },
    { header: "Termin Bayar", cell: (r) => r.paymentTermsName ?? "—" },
    { header: "Daftar Harga", cell: (r) => r.priceListName ?? "—" },
    { header: "Status", cell: (r) => r.isActive ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">Aktif</span> : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">Nonaktif</span> },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/crm/customers/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pelanggan</h1>
        <Link href="/crm/customers/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex gap-2">
        <Input className="w-64" placeholder="Cari kode / nama akun…" value={search} onChange={(e) => { setSearch(e.target.value); setRefreshKey((k) => k + 1); }} />
        <Select className="w-40" value={isActive} onChange={(e) => { setIsActive(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua</option>
          <option value="true">Aktif</option>
          <option value="false">Nonaktif</option>
        </Select>
      </div>
      <DataTable<Customer> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada pelanggan." />
    </div>
  );
}
