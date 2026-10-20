"use client";

import Link from "next/link";
import { BarChart3, Clock, Scale } from "lucide-react";

import { Card } from "@/components/ui/card";

const reports = [
  { title: "Laporan Penjualan", href: "/sales/reports/sales", icon: BarChart3, desc: "Ringkasan SO, pengiriman, faktur & pembayaran per pelanggan." },
  { title: "Aging Piutang (AR)", href: "/sales/reports/ar-aging", icon: Clock, desc: "Faktur posted bersisa dikelompokkan per umur jatuh tempo." },
  { title: "Rekonsiliasi AR", href: "/sales/reports/ar-reconciliation", icon: Scale, desc: "Cek kecocokan subledger piutang/persediaan terhadap GL." },
];

export default function SalesReportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Laporan Penjualan</h1>
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
