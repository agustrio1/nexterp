"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type Payment = { id: string; docNo: string | null; status: string; supplierId: string; paymentDate: string; currency: string; amountForeign: string; amountBase: string; memo: string | null };
type Supplier = { id: string; code: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  posted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  reversed: "rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export default function PaymentsPage() {
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
  const url = qs ? `/api/purchasing/payments?${qs}` : "/api/purchasing/payments";

  const supplierName = (id: string) => { const s = suppliers.find((x) => x.id === id); return s ? `${s.code} — ${s.name}` : id.slice(0, 8); };

  const columns: Column<Payment>[] = [
    { header: "No. Bayar", cell: (p) => p.docNo ? <code className="text-xs font-mono">{p.docNo}</code> : <span className="text-zinc-400">draft</span> },
    { header: "Tanggal", cell: (p) => p.paymentDate },
    { header: "Pemasok", cell: (p) => supplierName(p.supplierId) },
    { header: "Mata Uang", cell: (p) => p.currency },
    { header: "Jumlah", cell: (p) => <span className="font-mono text-xs">{p.amountForeign}</span> },
    { header: "Basis", cell: (p) => <span className="font-mono text-xs">{p.amountBase}</span> },
    { header: "Status", cell: (p) => <span className={STATUS_STYLE[p.status] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{p.status}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (p) => <Link href={`/purchasing/payments/${p.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pembayaran AP</h1>
        <Link href="/purchasing/payments/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex gap-2">
        <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua status</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="reversed">Reversed</option><option value="cancelled">Cancelled</option>
        </Select>
        <Select className="w-56" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua pemasok</option>{suppliers.map((s) => (<option key={s.id} value={s.id}>{s.code} — {s.name}</option>))}
        </Select>
      </div>
      <DataTable<Payment> key={refreshKey} url={url} columns={columns} rowKey={(p) => p.id} emptyMessage="Belum ada pembayaran AP." />
    </div>
  );
}
