"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";

type FY = { id: string; code: string; startDate: string; endDate: string; status: string; periodCount?: number };

export default function FiscalYearsPage() {
  const columns: Column<FY>[] = [
    { header: "Kode", cell: (r) => <code className="text-xs font-medium">{r.code}</code> },
    { header: "Mulai", cell: (r) => r.startDate },
    { header: "Selesai", cell: (r) => r.endDate },
    { header: "Status", cell: (r) => <span className={`text-xs font-medium ${r.status === "open" ? "text-green-600" : "text-zinc-400"}`}>{r.status}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/fiscal-years/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tahun Fiskal</h1>
        <Link href="/fiscal-years/new"><Button size="sm"><Plus className="h-4 w-4" /> Tambah</Button></Link>
      </div>
      <DataTable<FY> url="/api/fiscal-years" columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada tahun fiskal." />
    </div>
  );
}
