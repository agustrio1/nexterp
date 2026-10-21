"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type SO = { id: string; docNo: string | null; status: string; customerId: string; orderDate: string; expectedDate: string | null; currency: string; totalBase: string };
type Customer = { id: string; code: string; accountName: string };

const STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  pending_approval: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  approved: "rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  posted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export default function SalesOrdersPage() {
  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Customer[] }) => setCustomers(j.data)).catch(() => {});
  }, []);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (customerId) params.set("customerId", customerId);
  const qs = params.toString();
  const url = qs ? `/api/sales/sales-orders?${qs}` : "/api/sales/sales-orders";

  const customerName = (id: string) => { const c = customers.find((x) => x.id === id); return c ? `${c.code} — ${c.accountName}` : id.slice(0, 8); };

  const columns: Column<SO>[] = [
    { header: "No. SO", cell: (s) => s.docNo ? <code className="text-xs font-mono">{s.docNo}</code> : <span className="text-zinc-400">draft</span> },
    { header: "Tanggal", cell: (s) => s.orderDate },
    { header: "Pelanggan", cell: (s) => customerName(s.customerId) },
    { header: "Estimasi Kirim", cell: (s) => s.expectedDate ?? "—" },
    { header: "Mata Uang", cell: (s) => s.currency },
    { header: "Total (Basis)", cell: (s) => <span className="text-right font-mono text-xs">{s.totalBase}</span> },
    { header: "Status", cell: (s) => <span className={STATUS_STYLE[s.status] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{s.status}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (s) => <Link href={`/sales/sales-orders/${s.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Sales Order</h1>
        <Link href="/sales/sales-orders/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex gap-2">
        <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua status</option><option value="draft">Draft</option><option value="pending_approval">Menunggu Persetujuan</option><option value="approved">Approved</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option>
        </Select>
        <Select className="w-56" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua pelanggan</option>{customers.map((c) => (<option key={c.id} value={c.id}>{c.code} — {c.accountName}</option>))}
        </Select>
      </div>
      <DataTable<SO> key={refreshKey} url={url} columns={columns} rowKey={(s) => s.id} emptyMessage="Belum ada sales order." />
    </div>
  );
}
