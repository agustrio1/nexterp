"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type SoSummary = { id: string; docNo: string | null; customerId: string; branchId: string };
type SoDetail = SoSummary & { currency: string; lines: { id: string; lineNo: number; productId: string; quantity: string; quantityDelivered: string; description: string | null }[] };
type Warehouse = { id: string; code: string; name: string };

export default function NewDeliveryPage() {
  const router = useRouter();
  const [soId, setSoId] = useState("");
  const [so, setSo] = useState<SoDetail | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [sos, setSos] = useState<SoSummary[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  function loadSo(id: string): Promise<void> {
    return fetch(`/api/sales/sales-orders/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: SoDetail }) => {
        setSo(j.data);
        setQtys({});
        return fetch(`/api/warehouses?isActive=true&branchId=${j.data.branchId}`, { credentials: "same-origin" })
          .then((r) => r.ok ? r.json() : { data: [] })
          .then((w: { data: Warehouse[] }) => setWarehouses(w.data));
      })
      .catch(() => { setSo(null); toast.error("Gagal memuat sales order."); });
  }

  useEffect(() => {
    fetch("/api/sales/sales-orders?status=posted", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: SoSummary[] }) => setSos(j.data)).catch(() => {});
    fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: { id: string; code: string; accountName: string }[] }) => setCustomers(Object.fromEntries(j.data.map((c) => [c.id, `${c.code} — ${c.accountName}`])))).catch(() => {});
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: { id: string; name: string }[] }) => setProductNames(Object.fromEntries(j.data.map((p) => [p.id, p.name])))).catch(() => {});

    const preset = new URLSearchParams(window.location.search).get("soId");
    if (preset) {
      fetch(`/api/sales/sales-orders/${preset}`, { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((j: { data: SoDetail }) => {
          setSoId(preset);
          setSo(j.data);
          return fetch(`/api/warehouses?isActive=true&branchId=${j.data.branchId}`, { credentials: "same-origin" })
            .then((r) => r.ok ? r.json() : { data: [] })
            .then((w: { data: Warehouse[] }) => setWarehouses(w.data));
        })
        .catch(() => toast.error("Gagal memuat sales order."));
    }
  }, []);

  function onSoChange(id: string) {
    setSoId(id);
    setSo(null);
    setWarehouses([]);
    setWarehouseId("");
    if (id) void loadSo(id);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!so) { toast.error("Pilih sales order posted."); return; }
    if (!warehouseId) { toast.error("Pilih gudang."); return; }
    const lines = so.lines
      .map((l) => ({ soLineId: l.id, productId: l.productId, quantity: qtys[l.id] ?? "" }))
      .filter((l) => l.quantity !== "" && Number(l.quantity) > 0);
    if (lines.length === 0) { toast.error("Isi kuantitas kirim minimal satu baris."); return; }

    const body: Record<string, unknown> = { soId: so.id, branchId: so.branchId, warehouseId, deliveryDate, lines };
    if (notes) body.notes = notes;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sales/deliveries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Pengiriman dibuat."); router.push(`/sales/deliveries/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/deliveries"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Pengiriman Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-sm font-medium">Sales Order (posted) *</label>
            <Select className="w-full" value={soId} onChange={(e) => onSoChange(e.target.value)}><option value="">— Pilih —</option>{sos.map((s) => (<option key={s.id} value={s.id}>{s.docNo ?? s.id.slice(0, 8)} — {customers[s.customerId] ?? s.customerId.slice(0, 8)}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Gudang *</label>
            <Select className="w-full" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={!so}><option value="">{so ? "— Pilih —" : "Pilih SO dulu"}</option>{warehouses.map((w) => (<option key={w.id} value={w.id}>{w.code} — {w.name}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tanggal Kirim *</label><Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        {so && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Qty SO</th><th className="px-3 py-2 text-right">Sisa</th><th className="px-3 py-2 text-left">Kirim Sekarang</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{so.lines.map((l) => { const remaining = String(Number(l.quantity) - Number(l.quantityDelivered)); const full = Number(remaining) > 0 ? remaining : ""; return (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{productNames[l.productId] ?? l.productId.slice(0, 8)}{l.description ? <span className="ml-1 text-xs text-zinc-400">({l.description})</span> : null}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2 text-right font-mono">{remaining}</td><td className="px-3 py-2"><Input className="w-28" value={qtys[l.id] ?? ""} onChange={(e) => setQtys((prev) => ({ ...prev, [l.id]: e.target.value }))} placeholder={full} /></td></tr>); })}</tbody>
            </table>
          </div>
        )}
        <div><Button type="submit" loading={submitting} disabled={!so}>Simpan Draf Pengiriman</Button></div>
      </form>
    </div>
  );
}
