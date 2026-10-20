"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type PO = { id: string; docNo: string | null; status: string; supplierId: string; orderDate: string; expectedDate: string | null; currency: string; totalBase: string };
type Supplier = { id: string; code: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  pending_approval: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  approved: "rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  posted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export default function PurchaseOrdersPage() {
  const [status, setStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    fetch("/api/purchasing/suppliers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Supplier[] }) => setSuppliers(j.data)).catch(() => {});
  }, []);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (supplierId) params.set("supplierId", supplierId);
  const qs = params.toString();
  const url = qs ? `/api/purchasing/purchase-orders?${qs}` : "/api/purchasing/purchase-orders";
  const fetchUrl = `${url}${url.includes("?") ? "&" : "?"}_r=${refreshKey}`;

  const supplierName = (id: string) => {
    const s = suppliers.find((x) => x.id === id);
    return s ? `${s.code} — ${s.name}` : id.slice(0, 8);
  };

  const columns: Column<PO>[] = [
    { header: "No. PO", cell: (p) => p.docNo ? <code className="text-xs font-mono">{p.docNo}</code> : <span className="text-zinc-400">draft</span> },
    { header: "Tanggal", cell: (p) => p.orderDate },
    { header: "Pemasok", cell: (p) => supplierName(p.supplierId) },
    { header: "Estimasi Tiba", cell: (p) => p.expectedDate ?? "—" },
    { header: "Mata Uang", cell: (p) => p.currency },
    { header: "Total (Basis)", cell: (p) => <span className="text-right font-mono text-xs">{p.totalBase}</span> },
    { header: "Status", cell: (p) => <span className={STATUS_STYLE[p.status] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{p.status}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (p) => <Link href={`/purchasing/purchase-orders/${p.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Purchase Order</h1>
        <Link href="/purchasing/purchase-orders/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex gap-2">
        <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua status</option><option value="draft">Draft</option><option value="pending_approval">Menunggu Persetujuan</option><option value="approved">Approved</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option>
        </Select>
        <Select className="w-56" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua pemasok</option>{suppliers.map((s) => (<option key={s.id} value={s.id}>{s.code} — {s.name}</option>))}
        </Select>
      </div>
      <DataTable<PO> key={refreshKey} url={fetchUrl} columns={columns} rowKey={(p) => p.id} emptyMessage="Belum ada purchase order." />
    </div>
  );
}
