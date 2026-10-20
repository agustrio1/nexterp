"use client";

import { DataTable, type Column } from "@/components/ui/data-table";

type Warehouse = { id: string; code: string; name: string; branchId: string; isActive: boolean };

const columns: Column<Warehouse>[] = [
  { header: "Kode", cell: (w) => <code className="text-xs font-mono">{w.code}</code> },
  { header: "Nama", cell: (w) => <span className="font-medium">{w.name}</span> },
  {
    header: "Status",
    cell: (w) => (
      <span className={w.isActive ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300" : "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300"}>
        {w.isActive ? "Aktif" : "Nonaktif"}
      </span>
    ),
  },
];

export default function WarehousesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Gudang</h1>
      <DataTable<Warehouse> url="/api/warehouses" columns={columns} rowKey={(w) => w.id} emptyMessage="Belum ada gudang." />
    </div>
  );
}
