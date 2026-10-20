"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type Invoice = { id: string; docNo: string | null; status: string; customerId: string; invoiceDate: string; dueDate: string; currency: string; totalForeign: string; totalBase: string; amountPaid: string };
type Customer = { id: string; code: string; accountName: string };

const STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  posted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
  reversed: "rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700 dark:bg-orange-900 dark:text-orange-300",
};

export default function SalesInvoicesPage() {
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
  const url = qs ? `/api/sales/invoices?${qs}` : "/api/sales/invoices";
  const fetchUrl = `${url}${url.includes("?") ? "&" : "?"}_r=${refreshKey}`;

  const customerName = (id: string) => { const c = customers.find((x) => x.id === id); return c ? `${c.code} — ${c.accountName}` : id.slice(0, 8); };

  const columns: Column<Invoice>[] = [
    { header: "No. Faktur", cell: (i) => i.docNo ? <code className="font-mono text-xs">{i.docNo}</code> : <span className="text-zinc-400">draft</span> },
    { header: "Tanggal", cell: (i) => i.invoiceDate },
    { header: "Jatuh Tempo", cell: (i) => i.dueDate },
    { header: "Pelanggan", cell: (i) => customerName(i.customerId) },
    { header: "Mata Uang", cell: (i) => i.currency },
    { header: "Total (Asing)", cell: (i) => <span className="text-right font-mono text-xs">{i.totalForeign}</span> },
    { header: "Total (Basis)", cell: (i) => <span className="text-right font-mono text-xs">{i.totalBase}</span> },
    { header: "Dibayar", cell: (i) => <span className="text-right font-mono text-xs">{i.amountPaid}</span> },
    { header: "Status", cell: (i) => <span className={STATUS_STYLE[i.status] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{i.status}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (i) => <Link href={`/sales/invoices/${i.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Faktur Penjualan (AR)</h1>
        <Link href="/sales/invoices/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex gap-2">
        <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua status</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option><option value="reversed">Reversed</option>
        </Select>
        <Select className="w-56" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua pelanggan</option>{customers.map((c) => (<option key={c.id} value={c.id}>{c.code} — {c.accountName}</option>))}
        </Select>
      </div>
      <DataTable<Invoice> key={refreshKey} url={fetchUrl} columns={columns} rowKey={(i) => i.id} emptyMessage="Belum ada faktur penjualan." />
    </div>
  );
}
