"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";

type Currency = { code: string; name: string; symbol: string | null; decimals: number; isActive: boolean; isBase: boolean };

export default function CurrenciesPage() {
  const columns: Column<Currency>[] = [
    { header: "Kode", cell: (r) => <code className="text-xs font-medium">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Simbol", cell: (r) => r.symbol ?? "-" },
    { header: "Desimal", cell: (r) => r.decimals },
    { header: "Basis", cell: (r) => r.isBase ? <span className="text-xs font-medium text-blue-600">Basis</span> : null },
    { header: "Status", cell: (r) => <span className={r.isActive ? "text-green-600 text-xs" : "text-zinc-400 text-xs"}>{r.isActive ? "Aktif" : "Nonaktif"}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/currencies/${r.code}`}><Button variant="ghost" size="sm">Edit</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Mata Uang</h1>
        <Link href="/currencies/new"><Button size="sm"><Plus className="h-4 w-4" /> Tambah</Button></Link>
      </div>
      <DataTable<Currency> url="/api/currencies" columns={columns} rowKey={(r) => r.code} emptyMessage="Belum ada mata uang." />
      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Kurs Valas</h2>
          <Link href="/exchange-rates/new"><Button size="sm" variant="outline"><Plus className="h-4 w-4" /> Tambah Kurs</Button></Link>
        </div>
        <div className="mt-3">
          <ExchangeRatesMini />
        </div>
      </div>
    </div>
  );
}

function ExchangeRatesMini() {
  type Rate = { id: string; fromCurrency: string; rateDate: string; rate: string; source: string | null };
  const cols: Column<Rate>[] = [
    { header: "Dari", cell: (r) => <code className="text-xs">{r.fromCurrency}</code> },
    { header: "Tanggal", cell: (r) => r.rateDate },
    { header: "Kurs", cell: (r) => <span className="font-mono text-xs">{r.rate}</span> },
    { header: "Sumber", cell: (r) => r.source ?? "-" },
  ];
  return <DataTable<Rate> url="/api/exchange-rates?limit=10" columns={cols} rowKey={(r) => r.id} emptyMessage="Belum ada kurs." />;
}
