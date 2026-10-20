"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DialogConfirm } from "@/components/ui/dialog-confirm";

type SoLine = { id: string; lineNo: number; productId: string; quantity: string; unitPrice: string; amountForeign: string; quantityDelivered: string; description: string | null };
type SoDetail = { id: string; docNo: string | null; status: string; customerId: string; orderDate: string; expectedDate: string | null; currency: string; totalBase: string; description: string | null; notes: string | null; reason: string | null; lines: SoLine[] };
type Option = { id: string; name: string };

export default function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [so, setSo] = useState<SoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [products, setProducts] = useState<Option[]>([]);

  useEffect(() => {
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setProducts(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sales/sales-orders/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: SoDetail }) => setSo(j.data))
      .catch(() => toast.error("Gagal memuat sales order."))
      .finally(() => setLoading(false));
  }, [id]);

  async function doAction(url: string, body?: unknown) {
    setActionLoading(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: SoDetail }; setSo(j.data); toast.success("Aksi berhasil."); }
      else { const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setActionLoading(false); setReason(""); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!so) return <p className="text-red-600">Sales order tidak ditemukan.</p>;

  const productName = (pid: string) => { const p = products.find((x) => x.id === pid); return p ? p.name : pid.slice(0, 8); };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/sales-orders"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{so.docNo ?? "Draf"}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{so.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div><span className="font-medium text-zinc-500">Tanggal SO:</span> {so.orderDate}</div>
        <div><span className="font-medium text-zinc-500">Rencana Kirim:</span> {so.expectedDate ?? "—"}</div>
        <div><span className="font-medium text-zinc-500">Mata Uang:</span> {so.currency}</div>
        <div><span className="font-medium text-zinc-500">Total (Basis):</span> <code className="font-mono">{so.totalBase}</code></div>
        <div className="col-span-2"><span className="font-medium text-zinc-500">Deskripsi:</span> {so.description ?? "—"}</div>
        {so.reason && <div className="col-span-2"><span className="font-medium text-zinc-500">Alasan:</span> {so.reason}</div>}
      </div>

      {so.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Harga</th><th className="px-3 py-2 text-right">Jumlah</th><th className="px-3 py-2 text-right">Terkirim</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{so.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{productName(l.productId)}{l.description ? <span className="ml-1 text-xs text-zinc-400">({l.description})</span> : null}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2 text-right font-mono">{l.unitPrice}</td><td className="px-3 py-2 text-right font-mono">{l.amountForeign}</td><td className="px-3 py-2 text-right font-mono">{l.quantityDelivered}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {so.status === "draft" && (
          <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Ajukan Persetujuan</Button>} title="Ajukan SO ke mesin persetujuan?" description="Status berubah menjadi pending_approval." onConfirm={() => doAction(`/api/sales/sales-orders/${so.id}/submit`)} />
        )}
        {so.status === "pending_approval" && (
          <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Setujui</Button>} title="Setujui SO?" description="Menuntut permintaan persetujuan berstatus approved pada mesin persetujuan." onConfirm={() => doAction(`/api/sales/sales-orders/${so.id}/approve`)} />
        )}
        {so.status === "approved" && (
          <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Posting</Button>} title="Posting SO?" description="Kurs dikunci, limit kredit dicek, SO siap dikirim." onConfirm={() => doAction(`/api/sales/sales-orders/${so.id}/post`)} />
        )}
        {so.status === "posted" && (
          <Link href={`/sales/deliveries/new?soId=${so.id}`}><Button size="sm">Buat Pengiriman</Button></Link>
        )}
        {["draft", "pending_approval", "approved"].includes(so.status) && (
          <div className="space-y-2">
            <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
            <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan SO?" destructive onConfirm={() => doAction(`/api/sales/sales-orders/${so.id}/cancel`, { reason })} />
          </div>
        )}
      </div>
    </div>
  );
}
