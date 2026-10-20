"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DataTable, type Column } from "@/components/ui/data-table";

type Period = { id: string; number: number; name: string; startDate: string; endDate: string; status: string };

export default function FiscalYearDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [fy, setFy] = useState<{ code: string; startDate: string; endDate: string; status: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/fiscal-years/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: { code: string; startDate: string; endDate: string; status: string } }) => setFy(json.data))
      .catch(() => toast.error("Gagal memuat tahun fiskal."))
      .finally(() => setLoading(false));
  }, [id]);

  async function changeStatus(periodId: string, status: string) {
    const res = await fetch(`/api/periods/${periodId}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }), credentials: "same-origin",
    });
    if (res.ok) toast.success(`Status periode diubah ke ${status}.`);
    else toast.error("Gagal mengubah status.");
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!fy) return <p className="text-sm text-zinc-500">Tahun fiskal tidak ditemukan.</p>;

  const columns: Column<Period>[] = [
    { header: "#", cell: (p) => p.number },
    { header: "Nama", cell: (p) => p.name },
    { header: "Mulai", cell: (p) => p.startDate },
    { header: "Akhir", cell: (p) => p.endDate },
    {
      header: "Status", cell: (p) => (
        <span className={`text-xs font-medium ${p.status === "open" ? "text-green-600" : p.status === "soft_closed" ? "text-yellow-600" : "text-zinc-400"}`}>
          {p.status}
        </span>
      ),
    },
    {
      header: "Aksi", cell: (p) => (
        <div className="flex gap-1">
          {p.status === "open" && <Button size="sm" variant="ghost" onClick={() => void changeStatus(p.id, "soft_closed")}>Soft Close</Button>}
          {p.status === "soft_closed" && <Button size="sm" variant="ghost" onClick={() => void changeStatus(p.id, "closed")}>Close</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/fiscal-years"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{fy.code}</h1>
        <span className="text-sm text-zinc-500">{fy.startDate} → {fy.endDate}</span>
      </div>
      <p className="text-sm text-zinc-500">Status: <strong>{fy.status}</strong></p>
      <DataTable<Period> url={`/api/fiscal-years/${id}/periods`} columns={columns} rowKey={(p) => p.id} emptyMessage="Belum ada periode." />
    </div>
  );
}
