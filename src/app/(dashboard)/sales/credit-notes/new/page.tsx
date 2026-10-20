"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type InvSummary = { id: string; docNo: string | null; status: string; customerId: string; branchId: string; invoiceDate: string; currency: string; totalForeign: string };
type InvLine = { id: string; lineNo: number; productId: string | null; description: string | null; quantity: string; unitPrice: string };
type InvDetail = { id: string; docNo: string | null; status: string; branchId: string; customerId: string; currency: string; totalForeign: string; lines: InvLine[] };
type CnLine = { invoiceLineId: string; quantity: string; unitPrice: string };

export default function NewCreditNotePage() {
  const router = useRouter();
  const [invoiceId, setInvoiceId] = useState("");
  const [invoice, setInvoice] = useState<InvDetail | null>(null);
  const [creditNoteDate, setCreditNoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<CnLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [invoices, setInvoices] = useState<InvSummary[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  function applyInvoice(detail: InvDetail) {
    setInvoice(detail);
    setLines(detail.lines.map((l) => ({ invoiceLineId: l.id, quantity: "", unitPrice: l.unitPrice })));
  }

  useEffect(() => {
    fetch("/api/sales/invoices?status=posted", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: InvSummary[] }) => setInvoices(j.data)).catch(() => {});
    fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: { id: string; code: string; accountName: string }[] }) => setCustomers(Object.fromEntries(j.data.map((c) => [c.id, `${c.code} — ${c.accountName}`])))).catch(() => {});
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: { id: string; name: string }[] }) => setProductNames(Object.fromEntries(j.data.map((p) => [p.id, p.name])))).catch(() => {});

    const preset = new URLSearchParams(window.location.search).get("invoiceId");
    if (preset) {
      fetch(`/api/sales/invoices/${preset}`, { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((j: { data: InvDetail }) => { setInvoiceId(preset); applyInvoice(j.data); })
        .catch(() => toast.error("Gagal memuat faktur."));
    }
  }, []);

  function onInvoiceChange(id: string) {
    setInvoiceId(id);
    setInvoice(null);
    setLines([]);
    if (id) {
      fetch(`/api/sales/invoices/${id}`, { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((j: { data: InvDetail }) => applyInvoice(j.data))
        .catch(() => toast.error("Gagal memuat faktur."));
    }
  }

  function updateLine(invoiceLineId: string, patch: Partial<CnLine>) {
    setLines((prev) => prev.map((l) => (l.invoiceLineId === invoiceLineId ? { ...l, ...patch } : l)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) { toast.error("Pilih faktur posted."); return; }
    if (reason.trim().length < 3) { toast.error("Alasan minimal 3 karakter."); return; }
    const active = lines.filter((l) => l.quantity !== "" && Number(l.quantity) > 0);
    if (active.length === 0) { toast.error("Isi kuantitas koreksi minimal satu baris."); return; }
    if (active.some((l) => l.unitPrice === "" || Number.isNaN(Number(l.unitPrice)))) { toast.error("Harga semua baris koreksi harus diisi."); return; }

    const body = {
      invoiceId: invoice.id,
      branchId: invoice.branchId,
      creditNoteDate,
      reason: reason.trim(),
      lines: active.map((l) => {
        const src = invoice.lines.find((x) => x.id === l.invoiceLineId);
        const line: Record<string, unknown> = { invoiceLineId: l.invoiceLineId, quantity: l.quantity, unitPrice: l.unitPrice };
        if (src?.productId) line.productId = src.productId;
        if (src?.description) line.description = src.description;
        return line;
      }),
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/sales/credit-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Nota kredit dibuat."); router.push(`/sales/credit-notes/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  const totalForeign = lines.reduce((acc, l) => acc + (l.quantity !== "" ? Number(l.quantity) * Number(l.unitPrice || 0) : 0), 0);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/credit-notes"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Nota Kredit Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-sm font-medium">Faktur (posted) *</label>
            <Select className="w-full" value={invoiceId} onChange={(e) => onInvoiceChange(e.target.value)}><option value="">— Pilih —</option>{invoices.map((i) => (<option key={i.id} value={i.id}>{i.docNo ?? i.id.slice(0, 8)} — {customers[i.customerId] ?? i.customerId.slice(0, 8)} ({i.totalForeign} {i.currency})</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tanggal Nota Kredit *</label><Input type="date" value={creditNoteDate} onChange={(e) => setCreditNoteDate(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Mata Uang</label><Input value={invoice?.currency ?? ""} disabled placeholder="Ikut faktur" /></div>
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Alasan Kredit *</label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis. barang rusak dikembalikan pelanggan" /></div>

        {invoice && (
          <>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Qty Faktur</th><th className="px-3 py-2 text-left">Qty Koreksi</th><th className="px-3 py-2 text-left">Harga</th></tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{invoice.lines.map((l, idx) => (<tr key={l.id}>
                  <td className="px-3 py-2">{l.lineNo}</td>
                  <td className="px-3 py-2">{l.productId ? productNames[l.productId] ?? l.productId.slice(0, 8) : l.description ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{l.quantity}</td>
                  <td className="px-3 py-2"><Input className="w-24" value={lines[idx]?.quantity ?? ""} onChange={(e) => updateLine(l.id, { quantity: e.target.value })} placeholder="0" /></td>
                  <td className="px-3 py-2"><Input className="w-32" value={lines[idx]?.unitPrice ?? ""} onChange={(e) => updateLine(l.id, { unitPrice: e.target.value })} /></td>
                </tr>))}</tbody>
              </table>
            </div>
            <p className="text-sm text-zinc-500">Total nota kredit: <span className="font-mono font-medium">{totalForeign.toFixed(2)}</span> {invoice.currency} (maks nilai faktur: <span className="font-mono">{invoice.totalForeign}</span>)</p>
          </>
        )}
        <div><Button type="submit" loading={submitting} disabled={!invoice}>Simpan Draf Nota Kredit</Button></div>
      </form>
    </div>
  );
}
