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

type PoLine = { id: string; lineNo: number; productId: string; quantity: string; unitPrice: string; amountForeign: string; quantityReceived: string; description: string | null };
type PoDetail = { id: string; docNo: string | null; status: string; supplierId: string; orderDate: string; expectedDate: string | null; currency: string; totalBase: string; description: string | null; notes: string | null; reason: string | null; lines: PoLine[] };
type Option = { id: string; code?: string; name: string };

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [po, setPo] = useState<PoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [products, setProducts] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptWarehouseId, setReceiptWarehouseId] = useState("");
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptQtys, setReceiptQtys] = useState<Record<string, string>>({});
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setProducts(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/purchasing/purchase-orders/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: PoDetail }) => {
        setPo(j.data);
        if (j.data.status === "posted") {
          fetch("/api/warehouses?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((w: { data: Option[] }) => setWarehouses(w.data)).catch(() => {});
        }
      })
      .catch(() => toast.error("Gagal memuat PO."))
      .finally(() => setLoading(false));
  }, [id]);

  async function doAction(url: string, body?: unknown) {
    setActionLoading(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: PoDetail }; setPo(j.data); toast.success("Aksi berhasil."); }
      else { const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setActionLoading(false); setReason(""); }
  }

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!po) return;
    if (!receiptWarehouseId) { toast.error("Pilih gudang penerimaan."); return; }
    const lines = po.lines
      .map((l) => ({ poLineId: l.id, quantity: receiptQtys[l.id] ?? "" }))
      .filter((l) => l.quantity !== "" && Number(l.quantity) > 0);
    if (lines.length === 0) { toast.error("Isi kuantitas minimal satu baris."); return; }

    setReceiptSubmitting(true);
    try {
      const res = await fetch(`/api/purchasing/purchase-orders/${po.id}/receipts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouseId: receiptWarehouseId, documentDate: receiptDate, lines }), credentials: "same-origin" });
      if (res.ok) {
        toast.success("Barang diterima.");
        setReceiptOpen(false);
        const j = (await res.json()) as { data: PoDetail };
        setPo(j.data);
        setReceiptQtys({});
      } else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setReceiptSubmitting(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!po) return <p className="text-red-600">Purchase order tidak ditemukan.</p>;

  const productName = (pid: string) => { const p = products.find((x) => x.id === pid); return p ? p.name : pid.slice(0, 8); };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/purchasing/purchase-orders"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{po.docNo ?? "Draf"}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{po.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div><span className="font-medium text-zinc-500">Tanggal PO:</span> {po.orderDate}</div>
        <div><span className="font-medium text-zinc-500">Perkiraan Tiba:</span> {po.expectedDate ?? "—"}</div>
        <div><span className="font-medium text-zinc-500">Mata Uang:</span> {po.currency}</div>
        <div><span className="font-medium text-zinc-500">Total (Basis):</span> <code className="font-mono">{po.totalBase}</code></div>
        <div className="col-span-2"><span className="font-medium text-zinc-500">Deskripsi:</span> {po.description ?? "—"}</div>
        {po.reason && <div className="col-span-2"><span className="font-medium text-zinc-500">Alasan:</span> {po.reason}</div>}
      </div>

      {po.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Harga</th><th className="px-3 py-2 text-right">Jumlah</th><th className="px-3 py-2 text-right">Diterima</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{po.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{productName(l.productId)}{l.description ? <span className="ml-1 text-xs text-zinc-400">({l.description})</span> : null}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2 text-right font-mono">{l.unitPrice}</td><td className="px-3 py-2 text-right font-mono">{l.amountForeign}</td><td className="px-3 py-2 text-right font-mono">{l.quantityReceived}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {po.status === "draft" && (
          <>
            <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Ajukan Persetujuan</Button>} title="Ajukan PO ke mesin persetujuan?" description="Status berubah menjadi pending_approval." onConfirm={() => doAction(`/api/purchasing/purchase-orders/${po.id}/submit`)} />
            <div className="space-y-2">
              <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
              <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan PO?" destructive onConfirm={() => doAction(`/api/purchasing/purchase-orders/${po.id}/cancel`, { reason })} />
            </div>
          </>
        )}
        {po.status === "pending_approval" && (
          <>
            <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Setujui</Button>} title="Setujui PO?" description="Menuntut permintaan persetujuan berstatus approved pada mesin persetujuan." onConfirm={() => doAction(`/api/purchasing/purchase-orders/${po.id}/approve`)} />
            <div className="space-y-2">
              <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
              <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan PO?" destructive onConfirm={() => doAction(`/api/purchasing/purchase-orders/${po.id}/cancel`, { reason })} />
            </div>
          </>
        )}
        {po.status === "approved" && (
          <>
            <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Posting</Button>} title="Posting PO?" description="PO siap menerima barang dan ditagihkan." onConfirm={() => doAction(`/api/purchasing/purchase-orders/${po.id}/post`)} />
            <div className="space-y-2">
              <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
              <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan PO?" destructive onConfirm={() => doAction(`/api/purchasing/purchase-orders/${po.id}/cancel`, { reason })} />
            </div>
          </>
        )}
        {po.status === "posted" && (
          <div className="flex items-start gap-4">
            <Button variant="outline" size="sm" onClick={() => setReceiptOpen((v) => !v)}>Terima Barang</Button>
            <Link href={`/purchasing/invoices/new?poId=${po.id}`}><Button variant="outline" size="sm">Buat Invoice</Button></Link>
          </div>
        )}
      </div>

      {po.status === "posted" && receiptOpen && (
        <form onSubmit={submitReceipt} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Penerimaan Barang</h2>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5"><label className="text-sm font-medium">Gudang *</label>
              <Select className="w-56" value={receiptWarehouseId} onChange={(e) => setReceiptWarehouseId(e.target.value)}><option value="">— Pilih —</option>{warehouses.map((w) => (<option key={w.id} value={w.id}>{w.code} {w.name}</option>))}</Select>
            </div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Tanggal</label><Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Sisa</th><th className="px-3 py-2 text-left">Terima Sekarang</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{po.lines.map((l) => { const remaining = String(Number(l.quantity) - Number(l.quantityReceived)); const full = Number(remaining) > 0 ? remaining : ""; return (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{productName(l.productId)}</td><td className="px-3 py-2 text-right font-mono">{remaining}</td><td className="px-3 py-2"><Input className="w-28" value={receiptQtys[l.id] ?? ""} onChange={(e) => setReceiptQtys((prev) => ({ ...prev, [l.id]: e.target.value }))} placeholder={full} /></td></tr>); })}</tbody>
            </table>
          </div>
          <div className="flex gap-2"><Button type="submit" size="sm" loading={receiptSubmitting}>Simpan &amp; Posting Penerimaan</Button><Button type="button" variant="ghost" size="sm" onClick={() => setReceiptOpen(false)}>Tutup</Button></div>
        </form>
      )}
    </div>
  );
}
