"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Product = { id: string; sku: string; name: string; isActive: boolean; canPurchase: boolean; canSell: boolean; baseUnitId: string; categoryId: string | null };

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const qs = params.toString();
  const url = qs ? `/api/products?${qs}` : "/api/products";

  const columns: Column<Product>[] = [
    { header: "SKU", cell: (p) => <code className="text-xs font-mono">{p.sku}</code> },
    { header: "Nama", cell: (p) => <span className="font-medium">{p.name}</span> },
    { header: "Beli", cell: (p) => p.canPurchase ? "✓" : "—" },
    { header: "Jual", cell: (p) => p.canSell ? "✓" : "—" },
    {
      header: "Status",
      cell: (p) => (
        <span className={p.isActive ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300" : "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300"}>
          {p.isActive ? "Aktif" : "Nonaktif"}
        </span>
      ),
    },
    {
      header: "Aksi", className: "w-[80px]",
      cell: (p) => <Link href={`/products/${p.id}`}><Button variant="ghost" size="sm">Edit</Button></Link>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Produk</h1>
        <Link href="/products/new"><Button size="sm"><Plus className="h-4 w-4" /> Tambah</Button></Link>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" aria-hidden />
          <Input placeholder="Cari SKU / nama…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setRefreshKey((k) => k + 1); }} onBlur={() => setRefreshKey((k) => k + 1)} />
        </div>
      </div>
      <DataTable<Product> key={refreshKey} url={url} columns={columns} rowKey={(p) => p.id} emptyMessage="Belum ada produk." />
    </div>
  );
}
