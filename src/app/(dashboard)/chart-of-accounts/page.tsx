"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Account = {
  id: string;
  code: string;
  name: string;
  type: string;
  isPostable: boolean;
  isActive: boolean;
  parentId: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  asset: "Aset",
  liability: "Kewajiban",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  expense: "Beban",
};

export default function ChartOfAccountsPage() {
  const [type, setType] = useState("");
  const [isActive, setIsActive] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (isActive) params.set("isActive", isActive);
  const qs = params.toString();
  const url = qs ? `/api/chart-accounts?${qs}` : "/api/chart-accounts";
  const fetchUrl = `${url}${url.includes("?") ? "&" : "?"}_r=${refreshKey}`;

  const columns: Column<Account>[] = [
    { header: "Kode", cell: (a) => <code className="text-xs font-mono">{a.code}</code> },
    { header: "Nama", cell: (a) => <span className="font-medium">{a.name}</span> },
    {
      header: "Tipe",
      cell: (a) => (
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
          {TYPE_LABELS[a.type] ?? a.type}
        </span>
      ),
    },
    {
      header: "Postable",
      cell: (a) => (a.isPostable ? "✓" : "—"),
    },
    {
      header: "Status",
      cell: (a) => (
        <span
          className={
            a.isActive
              ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300"
              : "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300"
          }
        >
          {a.isActive ? "Aktif" : "Nonaktif"}
        </span>
      ),
    },
    {
      header: "Aksi",
      className: "w-[100px]",
      cell: (a) => (
        <Link href={`/chart-of-accounts/${a.id}`}>
          <Button variant="ghost" size="sm">Edit</Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Bagan Akun</h1>
        <Link href="/chart-of-accounts/new">
          <Button size="sm"><Plus className="h-4 w-4" /> Tambah Akun</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" aria-hidden />
          <Input
            placeholder="Filter via pencarian…"
            className="pl-9"
            disabled
            title="Pencarian teks-bebas belum didukung API; gunakan filter"
          />
        </div>
        <Select
          className="w-40"
          value={type}
          onChange={(e) => { setType(e.target.value); setRefreshKey((k) => k + 1); }}
        >
          <option value="">Semua tipe</option>
          <option value="asset">Aset</option>
          <option value="liability">Kewajiban</option>
          <option value="equity">Ekuitas</option>
          <option value="revenue">Pendapatan</option>
          <option value="expense">Beban</option>
        </Select>
        <Select
          className="w-36"
          value={isActive}
          onChange={(e) => { setIsActive(e.target.value); setRefreshKey((k) => k + 1); }}
        >
          <option value="">Semua status</option>
          <option value="true">Aktif</option>
          <option value="false">Nonaktif</option>
        </Select>
      </div>

      <DataTable<Account>
        key={refreshKey}
        url={fetchUrl}
        columns={columns}
        rowKey={(a) => a.id}
        emptyMessage="Belum ada akun."
      />
    </div>
  );
}
