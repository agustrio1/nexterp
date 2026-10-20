"use client";

import Link from "next/link";
import { ArrowLeftRight, Calculator, PackageSearch } from "lucide-react";

import { Card } from "@/components/ui/card";

const reports = [
  { title: "Kartu Stok", href: "/inventory-reports/stock-card", icon: PackageSearch, desc: "Pergerakan & saldo berjalan kuantitas/nilai per produk." },
  { title: "Valuasi Persediaan", href: "/inventory-reports/valuation", icon: Calculator, desc: "Nilai persediaan kini per produk & gudang dari lapisan biaya." },
  { title: "Reorder", href: "/inventory-reports/reorder", icon: ArrowLeftRight, desc: "Produk dengan stok di bawah titik pemesanan kembali." },
];

export default function InventoryReportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Laporan Persediaan</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <Link key={r.href} href={r.href}>
            <Card className="flex items-start gap-3 p-5 transition hover:shadow-md">
              <r.icon className="mt-0.5 h-5 w-5 text-zinc-500" />
              <div>
                <h2 className="font-medium text-zinc-900 dark:text-zinc-100">{r.title}</h2>
                <p className="mt-1 text-sm text-zinc-500">{r.desc}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
