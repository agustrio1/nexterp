"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type Opportunity = { id: string; title: string; accountName: string; stageName: string; status: string; amount: string | null; currency: string | null; expectedCloseDate: string | null; assignedToName: string | null };

const STATUS_STYLE: Record<string, string> = {
  open: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  won: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  lost: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

function money(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${currency ?? "IDR"} ${n.toLocaleString("id-ID")}`;
}

export default function CrmOpportunitiesPage() {
  const [status, setStatus] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const url = status ? `/api/crm/opportunities?status=${status}` : "/api/crm/opportunities";

  const columns: Column<Opportunity>[] = [
    { header: "Judul", cell: (r) => r.title },
    { header: "Akun", cell: (r) => r.accountName },
    { header: "Tahap", cell: (r) => r.stageName },
    { header: "Nominal", cell: (r) => money(r.amount, r.currency) },
    { header: "Est. Close", cell: (r) => r.expectedCloseDate ? r.expectedCloseDate.slice(0, 10) : "—" },
    { header: "Ditagihkan", cell: (r) => r.assignedToName ?? "—" },
    { header: "Status", cell: (r) => <span className={STATUS_STYLE[r.status] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{r.status}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/crm/opportunities/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Peluang</h1>
        <Link href="/crm/opportunities/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex gap-2">
        <Select className="w-48" value={status} onChange={(e) => { setStatus(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua status</option>
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </Select>
      </div>
      <DataTable<Opportunity> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada peluang." />
    </div>
  );
}
