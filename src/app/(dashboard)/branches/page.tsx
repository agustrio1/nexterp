"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";

type Branch = { id: string; code: string; name: string; address: string | null; phone: string | null; isActive: boolean; createdAt: string };

export default function BranchesPage() {
  const columns: Column<Branch>[] = [
    { header: "Kode", cell: (r) => <code className="text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Alamat", cell: (r) => r.address ?? "-" },
    { header: "Telepon", cell: (r) => r.phone ?? "-" },
    {
      header: "Status", cell: (r) => (
        <span className={r.isActive ? "text-green-600 text-xs font-medium" : "text-zinc-400 text-xs"}>
          {r.isActive ? "Aktif" : "Nonaktif"}
        </span>
      ),
    },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/branches/${r.id}`}><Button variant="ghost" size="sm">Edit</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cabang</h1>
        <Link href="/branches/new"><Button size="sm"><Plus className="h-4 w-4" /> Tambah</Button></Link>
      </div>
      <DataTable<Branch> url="/api/branches" columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada cabang." />
    </div>
  );
}
