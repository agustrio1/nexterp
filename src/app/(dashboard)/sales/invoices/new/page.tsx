"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type DlvSummary = { id: string; docNo: string | null; customerId: string };
type DlvLine = { id: string; lineNo: number; soLineId: string; productId: string; quantity: string; description: string | null };
type DlvDetail = { id: string; docNo: string | null; status: string; soId: string; customerId: string; branchId: string; lines: DlvLine[] };
type InvSummary = { id: string; deliveryId: string; status: string; lines?: never };
type InvLine = { deliveryLineId: string; quantity: string };
type SoLine = { id: string; unitPrice: string };
type Named = { id: string; code?: string; name?: string; accountName?: string };

function today(): string { return new Date().toISOString().slice(0, 10); }
function plusDays(base: string, days: number): string { const d = new Date(`${base}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

export default function NewSalesInvoicePage() {
  const router = useRouter();
  const [deliveryId, setDeliveryId] = useState("");
  const [delivery, setDelivery] = useState<DlvDetail | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [deliveries, setDeliveries] = useState<DlvSummary[]>([]);
  const [customers, setCustomers] = useState<Named[]>([]);
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  function applyDelivery(detail: DlvDetail) {
    setDelivery(detail);
    // Harga default: petakan soLineId → unitPrice dari SO; sisa tagih: kurangi faktur draft/posted aktif.
    void fetch(`/api/sales/sales-orders/${detail.soId}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: { lines: SoLine[] } }) => {
        const priceBySoLine = new Map(j.data.lines.map((l) => [l.id, l.unitPrice]));
        setPrices(Object.fromEntries(detail.lines.map((l) => [l.id, priceBySoLine.get(l.soLineId) ?? ""])));
      })
      .catch(() => { setPrices({}); });

    void fetch("/api/sales/invoices", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: InvSummary[] }) => j.data.filter((i) => i.deliveryId === detail.id && (i.status === "draft" || i.status === "posted")))
      .then(async (active) => {
        const billed: Record<string, number> = {};
        for (const inv of active) {
          const r = await fetch(`/api/sales/invoices/${inv.id}`, { credentials: "same-origin" });
          if (!r.ok) continue;
          const j = (await r.json()) as { data: { lines: InvLine[] } };
          for (const l of j.data.lines) billed[l.deliveryLineId] = (billed[l.deliveryLineId] ?? 0) + Number(l.quantity);
        }
        const remaining: Record<string, string> = {};
        for (const l of detail.lines) {
          const rem = Number(l.quantity) - (billed[l.id] ?? 0);
          remaining[l.id] = rem > 0 ? String(rem) : "";
        }
        setQtys(remaining);
      })
      .catch(() => { setQtys({}); });
  }

  useEffect(() => {
    fetch("/api/sales/deliveries?status=posted", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: DlvSummary[] }) => setDeliveries(j.data)).catch(() => {});
    fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Named[] }) => setCustomers(j.data)).catch(() => {});
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: { id: string; name: string }[] }) => setProductNames(Object.fromEntries(j.data.map((p) => [p.id, p.name])))).catch(() => {});

    const preset = new URLSearchParams(window.location.search).get("deliveryId");
    if (preset) {
      fetch(`/api/sales/deliveries/${preset}`, { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((j: { data: DlvDetail }) => {
          setDeliveryId(preset);
          setDueDate((prev) => prev || plusDays(today(), 30));
          applyDelivery(j.data);
        })
        .catch(() => toast.error("Gagal memuat pengiriman."));
    }
  }, []);

  function onDeliveryChange(id: string) {
    setDeliveryId(id);
    setDelivery(null);
    setQtys({});
    setPrices({});
    if (id) {
      fetch(`/api/sales/deliveries/${id}`, { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((j: { data: DlvDetail }) => applyDelivery(j.data))
        .catch(() => toast.error("Gagal memuat pengiriman."));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!delivery) { toast.error("Pilih pengiriman posted."); return; }
    if (!dueDate) { toast.error("Isi tanggal jatuh tempo."); return; }
    const lines = delivery.lines
      .map((l) => ({ deliveryLineId: l.id, productId: l.productId, quantity: qtys[l.id] ?? "", unitPrice: prices[l.id] ?? "", description: l.description }))
      .filter((l) => l.quantity !== "" && Number(l.quantity) > 0);
    if (lines.length === 0) { toast.error("Isi kuantitas tagih minimal satu baris."); return; }
    for (const l of lines) { if (!l.unitPrice || Number(l.unitPrice) < 0) { toast.error("Lengkapi harga satuan setiap baris yang ditagih."); return; } }

    const body: Record<string, unknown> = {
      deliveryId: delivery.id, branchId: delivery.branchId, invoiceDate, dueDate,
      lines: lines.map((l) => { const line: Record<string, unknown> = { deliveryLineId: l.deliveryLineId, productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice }; if (l.description) line.description = l.description; return line; }),
    };
    if (notes) body.notes = notes;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sales/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Faktur dibuat."); router.push(`/sales/invoices/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  const customerLabel = (id: string) => { const c = customers.find((x) => x.id === id); return c ? `${c.code} — ${c.accountName}` : id.slice(0, 8); };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/invoices"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Faktur Penjualan Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-sm font-medium">Pengiriman (posted) *</label>
            <Select className="w-full" value={deliveryId} onChange={(e) => onDeliveryChange(e.target.value)}><option value="">— Pilih —</option>{deliveries.map((d) => (<option key={d.id} value={d.id}>{d.docNo ?? d.id.slice(0, 8)} — {customerLabel(d.customerId)}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tanggal Faktur *</label><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Jatuh Tempo *</label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        {delivery && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Kirim</th><th className="px-3 py-2 text-left">Tagih (Qty)</th><th className="px-3 py-2 text-left">Harga Satuan</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{delivery.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{productNames[l.productId] ?? l.productId.slice(0, 8)}{l.description ? <span className="ml-1 text-xs text-zinc-400">({l.description})</span> : null}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2"><Input className="w-24" value={qtys[l.id] ?? ""} onChange={(e) => setQtys((prev) => ({ ...prev, [l.id]: e.target.value }))} placeholder="0" /></td><td className="px-3 py-2"><Input className="w-32" value={prices[l.id] ?? ""} onChange={(e) => setPrices((prev) => ({ ...prev, [l.id]: e.target.value }))} placeholder="0.00" /></td></tr>))}</tbody>
            </table>
          </div>
        )}
        {delivery && <p className="text-xs text-zinc-500">Harga default diambil dari sales order; sisa tagih dihitung otomatis. PPN (opsional) dipilih saat posting.</p>}
        <div><Button type="submit" loading={submitting} disabled={!delivery}>Simpan Draf Faktur</Button></div>
      </form>
    </div>
  );
}
