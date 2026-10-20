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

type QuotationLine = { id: string; lineNo: number; productId: string; quantity: string; unitPrice: string; amountForeign: string; description: string | null };
type QuotationDetail = { id: string; docNo: string | null; status: string; customerId: string; branchId: string; quotationDate: string; validUntil: string | null; currency: string; totalBase: string; description: string | null; notes: string | null; reason: string | null; lines: QuotationLine[] };
type Option = { id: string; name: string };

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [products, setProducts] = useState<Option[]>([]);

  useEffect(() => {
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setProducts(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sales/quotations/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: QuotationDetail }) => setQuotation(j.data))
      .catch(() => toast.error("Gagal memuat quotation."))
      .finally(() => setLoading(false));
  }, [id]);

  async function doAction(url: string, body?: unknown) {
    setActionLoading(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: QuotationDetail }; setQuotation(j.data); toast.success("Aksi berhasil."); }
      else { const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setActionLoading(false); setReason(""); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!quotation) return <p className="text-red-600">Quotation tidak ditemukan.</p>;

  const productName = (pid: string) => { const p = products.find((x) => x.id === pid); return p ? p.name : pid.slice(0, 8); };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/quotations"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{quotation.docNo ?? "Draf"}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{quotation.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div><span className="font-medium text-zinc-500">Tanggal:</span> {quotation.quotationDate}</div>
        <div><span className="font-medium text-zinc-500">Berlaku Hingga:</span> {quotation.validUntil ?? "—"}</div>
        <div><span className="font-medium text-zinc-500">Mata Uang:</span> {quotation.currency}</div>
        <div><span className="font-medium text-zinc-500">Total (Basis):</span> <code className="font-mono">{quotation.totalBase}</code></div>
        <div className="col-span-2"><span className="font-medium text-zinc-500">Deskripsi:</span> {quotation.description ?? "—"}</div>
        {quotation.notes && <div className="col-span-2"><span className="font-medium text-zinc-500">Catatan:</span> {quotation.notes}</div>}
        {quotation.reason && <div className="col-span-2"><span className="font-medium text-zinc-500">Alasan:</span> {quotation.reason}</div>}
      </div>

      {quotation.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Harga</th><th className="px-3 py-2 text-right">Jumlah</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{quotation.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{productName(l.productId)}{l.description ? <span className="ml-1 text-xs text-zinc-400">({l.description})</span> : null}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2 text-right font-mono">{l.unitPrice}</td><td className="px-3 py-2 text-right font-mono">{l.amountForeign}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {quotation.status === "draft" && (
          <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Kirim Quotation</Button>} title="Kirim quotation ke pelanggan?" description="Status berubah menjadi sent." onConfirm={() => doAction(`/api/sales/quotations/${quotation.id}/send`)} />
        )}
        {quotation.status === "sent" && (
          <>
            <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Tandai Diterima</Button>} title="Quotation diterima pelanggan?" onConfirm={() => doAction(`/api/sales/quotations/${quotation.id}/accept`)} />
            <DialogConfirm trigger={<Button variant="outline" size="sm">Tandai Ditolak</Button>} title="Quotation ditolak pelanggan?" destructive onConfirm={() => doAction(`/api/sales/quotations/${quotation.id}/reject`)} />
          </>
        )}
        {["draft", "sent", "rejected", "expired"].includes(quotation.status) && (
          <div className="space-y-2">
            <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
            <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan quotation?" destructive onConfirm={() => doAction(`/api/sales/quotations/${quotation.id}/cancel`, { reason })} />
          </div>
        )}
        {quotation.status === "accepted" && (
          <Link href={`/sales/sales-orders/new?quotationId=${quotation.id}`}><Button size="sm">Buat Sales Order</Button></Link>
        )}
      </div>
    </div>
  );
}
