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

type InvoiceLine = { id: string; lineNo: number; quantity: string; unitPrice: string; amountForeign: string; amountBase: string; description: string | null };
type InvoiceDetail = { id: string; docNo: string | null; status: string; supplierId: string; poId: string; invoiceDate: string; dueDate: string; currency: string; totalForeign: string; totalBase: string; notes: string | null; reason: string | null; lines: InvoiceLine[] };

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/purchasing/invoices/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: InvoiceDetail }) => setInvoice(j.data))
      .catch(() => toast.error("Gagal memuat invoice."))
      .finally(() => setLoading(false));
  }, [id]);

  async function doAction(url: string, body?: unknown) {
    setActionLoading(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: InvoiceDetail }; setInvoice(j.data); toast.success("Aksi berhasil."); }
      else { const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setActionLoading(false); setReason(""); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!invoice) return <p className="text-red-600">Invoice tidak ditemukan.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/purchasing/invoices"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{invoice.docNo ?? "Draf"}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{invoice.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div><span className="font-medium text-zinc-500">Tanggal:</span> {invoice.invoiceDate}</div>
        <div><span className="font-medium text-zinc-500">Jatuh Tempo:</span> {invoice.dueDate}</div>
        <div><span className="font-medium text-zinc-500">Mata Uang:</span> {invoice.currency}</div>
        <div><span className="font-medium text-zinc-500">Total:</span> <code className="font-mono">{invoice.totalForeign}</code> (basis {invoice.totalBase})</div>
        <div className="col-span-2"><span className="font-medium text-zinc-500">PO:</span> <Link className="text-blue-600 hover:underline" href={`/purchasing/purchase-orders/${invoice.poId}`}><code className="font-mono text-xs">{invoice.poId.slice(0, 8)}</code></Link></div>
        {invoice.notes && <div className="col-span-2"><span className="font-medium text-zinc-500">Catatan:</span> {invoice.notes}</div>}
        {invoice.reason && <div className="col-span-2"><span className="font-medium text-zinc-500">Alasan:</span> {invoice.reason}</div>}
      </div>

      {invoice.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Deskripsi</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Harga</th><th className="px-3 py-2 text-right">Jumlah</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{invoice.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{l.description ?? "—"}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2 text-right font-mono">{l.unitPrice}</td><td className="px-3 py-2 text-right font-mono">{l.amountForeign}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {invoice.status === "draft" && (
          <>
            <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Posting</Button>} title="Posting invoice?" description="Akan mengakui utang (Dr beban/persediaan / Cr AP) di buku besar." onConfirm={() => doAction(`/api/purchasing/invoices/${invoice.id}/post`)} />
            <div className="space-y-2">
              <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
              <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan draf invoice?" destructive onConfirm={() => doAction(`/api/purchasing/invoices/${invoice.id}/cancel`, { reason })} />
            </div>
          </>
        )}
        {invoice.status === "posted" && (
          <div className="space-y-2">
            <Input placeholder="Alasan reversal" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
            <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Reversal</Button>} title="Reversal invoice?" description="Akan membalik jurnal dan membuka kembali utang." destructive onConfirm={() => doAction(`/api/purchasing/invoices/${invoice.id}/reverse`, { reason })} />
          </div>
        )}
      </div>
    </div>
  );
}
