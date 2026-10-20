"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";

type Role = { id: string; code: string; name: string; description: string | null; permissionCount?: number };

export default function RolesPage() {
  const columns: Column<Role>[] = [
    { header: "Kode", cell: (r) => <code className="text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Deskripsi", cell: (r) => r.description ?? "-" },
    {
      header: "Aksi", className: "w-[80px]",
      cell: (r) => <Link href={`/roles/${r.id}`}><Button variant="ghost" size="sm">Edit</Button></Link>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Role & Izin</h1>
        <Link href="/roles/new"><Button size="sm"><Plus className="h-4 w-4" /> Tambah</Button></Link>
      </div>
      <DataTable<Role> url="/api/roles" columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada role." />
    </div>
  );
}
