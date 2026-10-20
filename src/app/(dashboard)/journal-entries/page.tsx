"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Journal = {
  id: string;
  docNo: string | null;
  entryDate: string;
  status: string;
  description: string;
  reference: string | null;
  totalDebit: string;
  totalCredit: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  posted: "Terkirim",
  reversed: "Dibalik",
  cancelled: "Dibatalkan",
};

export default function JournalEntriesPage() {
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  params.set("limit", "50");
  const qs = params.toString();
  const url = `/api/journals?${qs}`;
  const fetchUrl = `${url}&_r=${refreshKey}`;

  const columns: Column<Journal>[] = [
    {
      header: "No. Dokumen",
      cell: (j) => j.docNo ? <code className="text-xs font-mono">{j.docNo}</code> : <span className="text-zinc-400">—</span>,
    },
    { header: "Tanggal", cell: (j) => j.entryDate },
    { header: "Deskripsi", cell: (j) => <span className="font-medium">{j.description}</span> },
    {
      header: "Status",
      cell: (j) => (
        <span
          className={
            j.status === "posted"
              ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300"
              : j.status === "draft"
                ? "rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }
        >
          {STATUS_LABELS[j.status] ?? j.status}
        </span>
      ),
    },
    { header: "Debit", cell: (j) => j.totalDebit ?? "—" },
    { header: "Kredit", cell: (j) => j.totalCredit ?? "—" },
    {
      header: "Aksi",
      className: "w-[100px]",
      cell: (j) => (
        <Link href={`/journal-entries/${j.id}`}>
          <Button variant="ghost" size="sm">Detail</Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Jurnal</h1>
        <Link href="/journal-entries/new">
          <Button size="sm"><Plus className="h-4 w-4" /> Jurnal Baru</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          className="w-36"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setRefreshKey((k) => k + 1); }}
        >
          <option value="">Semua status</option>
          <option value="draft">Draf</option>
          <option value="posted">Terkirim</option>
          <option value="reversed">Dibalik</option>
          <option value="cancelled">Dibatalkan</option>
        </Select>
        <div className="flex items-center gap-1">
          <Input type="date" className="w-[150px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span className="text-xs text-zinc-500">s/d</span>
          <Input type="date" className="w-[150px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <DataTable<Journal>
        key={refreshKey}
        url={fetchUrl}
        columns={columns}
        rowKey={(j) => j.id}
        emptyMessage="Belum ada jurnal."
      />
    </div>
  );
}
