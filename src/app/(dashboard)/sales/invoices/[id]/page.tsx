"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { DialogConfirm } from "@/components/ui/dialog-confirm";

type InvoiceLine = { id: string; lineNo: number; deliveryLineId: string; productId: string | null; quantity: string; unitPrice: string; amountForeign: string; taxAmount: string | null; description: string | null };
type InvoiceDetail = { id: string; docNo: string | null; status: string; deliveryId: string; customerId: string; invoiceDate: string; dueDate: string; currency: string; subtotalForeign: string; taxForeign: string; totalForeign: string; totalBase: string; amountPaid: string; notes: string | null; reason: string | null; lines: InvoiceLine[] };
type Tax = { id: string; code: string; name: string };
type Option = { id: string; name: string };

export default function SalesInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [taxId, setTaxId] = useState("");
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [products, setProducts] = useState<Option[]>([]);

  useEffect(() => {
    fetch("/api/taxes?isActive=true&kind=output", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Tax[] }) => setTaxes(j.data)).catch(() => {});
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setProducts(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sales/invoices/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: InvoiceDetail }) => setInvoice(j.data))
      .catch(() => toast.error("Gagal memuat faktur."))
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
  if (!invoice) return <p className="text-red-600">Faktur tidak ditemukan.</p>;

  const productName = (pid: string | null) => { if (!pid) return "—"; const p = products.find((x) => x.id === pid); return p ? p.name : pid.slice(0, 8); };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/invoices"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{invoice.docNo ?? "Draf"}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{invoice.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div><span className="font-medium text-zinc-500">Tanggal Faktur:</span> {invoice.invoiceDate}</div>
        <div><span className="font-medium text-zinc-500">Jatuh Tempo:</span> {invoice.dueDate}</div>
        <div><span className="font-medium text-zinc-500">Mata Uang:</span> {invoice.currency}</div>
        <div><span className="font-medium text-zinc-500">Subtotal (Asing):</span> <code className="font-mono">{invoice.subtotalForeign}</code></div>
        <div><span className="font-medium text-zinc-500">PPN (Asing):</span> <code className="font-mono">{invoice.taxForeign}</code></div>
        <div><span className="font-medium text-zinc-500">Total (Asing):</span> <code className="font-mono">{invoice.totalForeign}</code></div>
        <div><span className="font-medium text-zinc-500">Total (Basis):</span> <code className="font-mono">{invoice.totalBase}</code></div>
        <div><span className="font-medium text-zinc-500">Dibayar:</span> <code className="font-mono">{invoice.amountPaid}</code></div>
        {invoice.notes && <div className="col-span-2"><span className="font-medium text-zinc-500">Catatan:</span> {invoice.notes}</div>}
        {invoice.reason && <div className="col-span-2"><span className="font-medium text-zinc-500">Alasan:</span> {invoice.reason}</div>}
      </div>

      {invoice.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Harga</th><th className="px-3 py-2 text-right">Jumlah</th><th className="px-3 py-2 text-right">PPN</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{invoice.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{productName(l.productId)}{l.description ? <span className="ml-1 text-xs text-zinc-400">({l.description})</span> : null}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2 text-right font-mono">{l.unitPrice}</td><td className="px-3 py-2 text-right font-mono">{l.amountForeign}</td><td className="px-3 py-2 text-right font-mono">{l.taxAmount ?? "—"}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {invoice.status === "draft" && (
          <>
            <div className="space-y-2">
              <Select className="w-64" value={taxId} onChange={(e) => setTaxId(e.target.value)}>
                <option value="">Tanpa PPN</option>{taxes.map((t) => (<option key={t.id} value={t.id}>{t.code} — {t.name}</option>))}
              </Select>
              <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Posting Faktur</Button>} title="Posting faktur?" description="Kurs dikunci; jurnal Dr AR / Cr Revenue" onConfirm={() => doAction(`/api/sales/invoices/${invoice.id}/post`, taxId ? { taxId } : undefined)} />
            </div>
            <div className="space-y-2">
              <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
              <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan faktur?" destructive onConfirm={() => doAction(`/api/sales/invoices/${invoice.id}/cancel`, { reason })} />
            </div>
          </>
        )}
        {invoice.status === "posted" && (
          <div className="flex flex-wrap items-start gap-4">
            <Link href={`/sales/payments/new?customerId=${invoice.customerId}`}><Button size="sm">Rekam Pembayaran</Button></Link>
            <Link href={`/sales/credit-notes/new?invoiceId=${invoice.id}`}><Button variant="outline" size="sm">Buat Nota Kredit</Button></Link>
            <div className="space-y-2">
              <Input placeholder="Alasan reversal" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
              <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-orange-600">Reversal</Button>} title="Balik faktur?" description="Jurnal dibalik. Faktur yang sudah ada pembayarannya tidak dapat dibalik." destructive onConfirm={() => doAction(`/api/sales/invoices/${invoice.id}/reverse`, { reason })} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
