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

type Allocation = { invoiceId: string; amountBase: string; amountForeign: string };
type PaymentDetail = { id: string; docNo: string | null; status: string; customerId: string; paymentDate: string; currency: string; exchangeRate: string | null; amountForeign: string; amountBase: string; memo: string | null; reason: string | null; allocations: Allocation[] };
type InvoiceRef = { id: string; docNo: string | null };

export default function SalesPaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRef[]>([]);

  useEffect(() => {
    fetch("/api/sales/invoices", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: InvoiceRef[] }) => setInvoices(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sales/payments/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: PaymentDetail }) => setPayment(j.data))
      .catch(() => toast.error("Gagal memuat pembayaran."))
      .finally(() => setLoading(false));
  }, [id]);

  async function doAction(url: string, body?: unknown) {
    setActionLoading(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: PaymentDetail }; setPayment(j.data); toast.success("Aksi berhasil."); }
      else { const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setActionLoading(false); setReason(""); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!payment) return <p className="text-red-600">Pembayaran tidak ditemukan.</p>;

  const invoiceDocNo = (invId: string) => { const i = invoices.find((x) => x.id === invId); return i?.docNo ?? invId.slice(0, 8); };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/payments"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{payment.docNo ?? "Draf"}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{payment.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div><span className="font-medium text-zinc-500">Tanggal:</span> {payment.paymentDate}</div>
        <div><span className="font-medium text-zinc-500">Mata Uang:</span> {payment.currency}</div>
        <div><span className="font-medium text-zinc-500">Nominal (Asing):</span> <code className="font-mono">{payment.amountForeign}</code></div>
        <div><span className="font-medium text-zinc-500">Nominal (Basis):</span> <code className="font-mono">{payment.amountBase}</code></div>
        <div><span className="font-medium text-zinc-500">Kurs:</span> <code className="font-mono">{payment.exchangeRate ?? "—"}</code></div>
        {payment.memo && <div className="col-span-2"><span className="font-medium text-zinc-500">Memo:</span> {payment.memo}</div>}
        {payment.reason && <div className="col-span-2"><span className="font-medium text-zinc-500">Alasan:</span> {payment.reason}</div>}
      </div>

      {payment.allocations.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">Faktur</th><th className="px-3 py-2 text-right">Alokasi (Basis)</th><th className="px-3 py-2 text-right">Alokasi (Asing)</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{payment.allocations.map((a, idx) => (<tr key={`${a.invoiceId}-${idx}`}><td className="px-3 py-2"><Link className="text-blue-600 hover:underline" href={`/sales/invoices/${a.invoiceId}`}>{invoiceDocNo(a.invoiceId)}</Link></td><td className="px-3 py-2 text-right font-mono">{a.amountBase}</td><td className="px-3 py-2 text-right font-mono">{a.amountForeign}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {payment.status === "draft" && (
          <>
            <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Posting Pembayaran</Button>} title="Posting pembayaran?" description="Kurs dikunci, alokasi FIFO ke faktur terbuka, jurnal Dr AR / Cr Bank dibuat." onConfirm={() => doAction(`/api/sales/payments/${payment.id}/post`)} />
            <div className="space-y-2">
              <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
              <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan pembayaran?" destructive onConfirm={() => doAction(`/api/sales/payments/${payment.id}/cancel`, { reason })} />
            </div>
          </>
        )}
        {payment.status === "posted" && (
          <div className="space-y-2">
            <Input placeholder="Alasan reversal" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
            <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-orange-600">Reversal</Button>} title="Balik pembayaran?" description="Alokasi dilepas, jurnal dibalik." destructive onConfirm={() => doAction(`/api/sales/payments/${payment.id}/reverse`, { reason })} />
          </div>
        )}
      </div>
    </div>
  );
}
