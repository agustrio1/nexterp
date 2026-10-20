"use client";

import Link from "next/link";
import { BarChart3, FileText, Landmark } from "lucide-react";

import { Card } from "@/components/ui/card";

const reports = [
  { title: "Neraca Saldo", href: "/reports/trial-balance", icon: FileText, desc: "Total debit & kredit per akun dalam rentang." },
  { title: "Laba Rugi", href: "/reports/income-statement", icon: BarChart3, desc: "Pendapatan vs beban serta laba bersih." },
  { title: "Neraca", href: "/reports/balance-sheet", icon: Landmark, desc: "Posisi aset, kewajiban, dan ekuitas per tanggal." },
];

export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Laporan Keuangan</h1>
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
