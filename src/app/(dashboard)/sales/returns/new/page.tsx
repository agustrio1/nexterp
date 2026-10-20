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
type DlvLine = { id: string; lineNo: number; productId: string; quantity: string; description: string | null };
type DlvDetail = { id: string; docNo: string | null; status: string; branchId: string; customerId: string; lines: DlvLine[] };
type ReturnSummary = { id: string; deliveryId: string; status: string };
type ReturnLine = { deliveryLineId: string; quantity: string };
type Warehouse = { id: string; code: string; name: string };

export default function NewSalesReturnPage() {
  const router = useRouter();
  const [deliveryId, setDeliveryId] = useState("");
  const [delivery, setDelivery] = useState<DlvDetail | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [deliveries, setDeliveries] = useState<DlvSummary[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  function applyDelivery(detail: DlvDetail) {
    setDelivery(detail);
    setQtys({});
    setRemaining({});
    void fetch(`/api/warehouses?isActive=true&branchId=${detail.branchId}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((w: { data: Warehouse[] }) => setWarehouses(w.data));

    void fetch("/api/sales/returns", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: ReturnSummary[] }) => j.data.filter((x) => x.deliveryId === detail.id && (x.status === "draft" || x.status === "posted")))
      .then(async (active) => {
        const returned: Record<string, number> = {};
        for (const ret of active) {
          const r = await fetch(`/api/sales/returns/${ret.id}`, { credentials: "same-origin" });
          if (!r.ok) continue;
          const j = (await r.json()) as { data: { lines: ReturnLine[] } };
          for (const l of j.data.lines) returned[l.deliveryLineId] = (returned[l.deliveryLineId] ?? 0) + Number(l.quantity);
        }
        const remaining: Record<string, string> = {};
        for (const l of detail.lines) {
          const rem = Number(l.quantity) - (returned[l.id] ?? 0);
          remaining[l.id] = rem > 0 ? String(rem) : "";
        }
        setRemaining(remaining);
        setQtys(remaining);
      })
      .catch(() => { setQtys({}); setRemaining({}); });
  }

  useEffect(() => {
    fetch("/api/sales/deliveries?status=posted", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: DlvSummary[] }) => setDeliveries(j.data)).catch(() => {});
    fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: { id: string; code: string; accountName: string }[] }) => setCustomers(Object.fromEntries(j.data.map((c) => [c.id, `${c.code} — ${c.accountName}`])))).catch(() => {});
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: { id: string; name: string }[] }) => setProductNames(Object.fromEntries(j.data.map((p) => [p.id, p.name])))).catch(() => {});

    const preset = new URLSearchParams(window.location.search).get("deliveryId");
    if (preset) {
      fetch(`/api/sales/deliveries/${preset}`, { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((j: { data: DlvDetail }) => { setDeliveryId(preset); applyDelivery(j.data); })
        .catch(() => toast.error("Gagal memuat pengiriman."));
    }
  }, []);

  function onDeliveryChange(id: string) {
    setDeliveryId(id);
    setDelivery(null);
    setWarehouses([]);
    setWarehouseId("");
    setQtys({});
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
    if (!warehouseId) { toast.error("Pilih gudang tujuan retur."); return; }
    const lines = delivery.lines
      .map((l) => ({ deliveryLineId: l.id, productId: l.productId, quantity: qtys[l.id] ?? "" }))
      .filter((l) => l.quantity !== "" && Number(l.quantity) > 0);
    if (lines.length === 0) { toast.error("Isi kuantitas retur minimal satu baris."); return; }

    const body: Record<string, unknown> = { deliveryId: delivery.id, branchId: delivery.branchId, warehouseId, returnDate, lines };
    if (notes) body.notes = notes;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sales/returns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Retur dibuat."); router.push(`/sales/returns/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/returns"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Retur Penjualan Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-sm font-medium">Pengiriman (posted) *</label>
            <Select className="w-full" value={deliveryId} onChange={(e) => onDeliveryChange(e.target.value)}><option value="">— Pilih —</option>{deliveries.map((d) => (<option key={d.id} value={d.id}>{d.docNo ?? d.id.slice(0, 8)} — {customers[d.customerId] ?? d.customerId.slice(0, 8)}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Gudang Tujuan *</label>
            <Select className="w-full" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={!delivery}><option value="">{delivery ? "— Pilih —" : "Pilih pengiriman dulu"}</option>{warehouses.map((w) => (<option key={w.id} value={w.id}>{w.code} — {w.name}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tanggal Retur *</label><Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        {delivery && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Kirim</th><th className="px-3 py-2 text-right">Sisa Retur</th><th className="px-3 py-2 text-left">Retur Sekarang</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{delivery.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{productNames[l.productId] ?? l.productId.slice(0, 8)}{l.description ? <span className="ml-1 text-xs text-zinc-400">({l.description})</span> : null}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2 text-right font-mono">{remaining[l.id] || "0"}</td><td className="px-3 py-2"><Input className="w-24" value={qtys[l.id] ?? ""} onChange={(e) => setQtys((prev) => ({ ...prev, [l.id]: e.target.value }))} placeholder="0" /></td></tr>))}</tbody>
            </table>
          </div>
        )}
        <div><Button type="submit" loading={submitting} disabled={!delivery}>Simpan Draf Retur</Button></div>
      </form>
    </div>
  );
}
