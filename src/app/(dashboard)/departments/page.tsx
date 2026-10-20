"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";

type Dept = { id: string; code: string; name: string; parentName?: string | null; branchName?: string | null; isActive: boolean };

export default function DepartmentsPage() {
  const columns: Column<Dept>[] = [
    { header: "Kode", cell: (r) => <code className="text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Induk", cell: (r) => r.parentName ?? "-" },
    { header: "Cabang", cell: (r) => r.branchName ?? "Semua" },
    { header: "Status", cell: (r) => <span className={r.isActive ? "text-green-600 text-xs" : "text-zinc-400 text-xs"}>{r.isActive ? "Aktif" : "Nonaktif"}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/departments/${r.id}`}><Button variant="ghost" size="sm">Edit</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Departemen</h1>
        <Link href="/departments/new"><Button size="sm"><Plus className="h-4 w-4" /> Tambah</Button></Link>
      </div>
      <DataTable<Dept> url="/api/departments" columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada departemen." />
    </div>
  );
}
