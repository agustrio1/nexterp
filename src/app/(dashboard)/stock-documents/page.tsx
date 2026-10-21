"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type Doc = { id: string; docNo: string | null; type: string; status: string; documentDate: string; description: string | null };

const TYPE_LABELS: Record<string, string> = { receipt: "Penerimaan", issue: "Pengeluaran", transfer: "Transfer", adjustment: "Penyesuaian", opname: "Opname" };

export default function StockDocumentsPage() {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  const qs = params.toString();
  const url = qs ? `/api/stock-documents?${qs}` : "/api/stock-documents";

  const columns: Column<Doc>[] = [
    { header: "No. Dok", cell: (d) => d.docNo ? <code className="text-xs font-mono">{d.docNo}</code> : <span className="text-zinc-400">draft</span> },
    { header: "Tanggal", cell: (d) => d.documentDate },
    { header: "Jenis", cell: (d) => <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{TYPE_LABELS[d.type] ?? d.type}</span> },
    { header: "Deskripsi", cell: (d) => d.description ?? "—" },
    {
      header: "Status", cell: (d) => (
        <span className={d.status === "posted" ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300" : d.status === "draft" ? "rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}>{d.status}</span>
      ),
    },
    { header: "Aksi", className: "w-[80px]", cell: (d) => <Link href={`/stock-documents/${d.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Dokumen Stok</h1>
        <Link href="/stock-documents/new"><Button size="sm"><Plus className="h-4 w-4" /> Buat</Button></Link>
      </div>
      <div className="flex gap-2">
        <Select className="w-40" value={type} onChange={(e) => { setType(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua jenis</option><option value="receipt">Penerimaan</option><option value="issue">Pengeluaran</option><option value="transfer">Transfer</option><option value="adjustment">Penyesuaian</option><option value="opname">Opname</option>
        </Select>
        <Select className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua status</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="reversed">Reversed</option><option value="cancelled">Cancelled</option>
        </Select>
      </div>
      <DataTable<Doc> key={refreshKey} url={url} columns={columns} rowKey={(d) => d.id} emptyMessage="Belum ada dokumen stok." />
    </div>
  );
}
