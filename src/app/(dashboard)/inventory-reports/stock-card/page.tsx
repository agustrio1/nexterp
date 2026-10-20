"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Option = { id: string; code?: string; name: string };
type ScRow = { movementDate: string; warehouseCode: string; warehouseName: string; direction: string; quantity: string; unitCost: string | null; totalCost: string | null; sourceType: string; sourceDocNo: string | null; memo: string | null; balanceQuantity: string; balanceValue: string };
type ScResult = { product: { id: string; sku: string; name: string }; from: string | null; to: string | null; openingQuantity: string; openingValue: string; closingQuantity: string; closingValue: string; rows: ScRow[] };

export default function StockCardReportPage() {
  const [products, setProducts] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [result, setResult] = useState<ScResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setProducts(j.data)).catch(() => {});
    fetch("/api/warehouses?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setWarehouses(j.data)).catch(() => {});
  }, []);

  async function query() {
    if (!productId) { toast.error("Pilih produk terlebih dahulu."); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ productId });
      if (warehouseId) params.set("warehouseId", warehouseId);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const res = await fetch(`/api/reports/stock-card?${params}`, { credentials: "same-origin" });
      if (res.ok) { const json = (await res.json()) as { data: ScResult }; setResult(json.data); }
      else { const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(err?.error?.message ?? "Gagal memuat kartu stok."); setResult(null); }
    } catch { toast.error("Koneksi terganggu."); } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Kartu Stok</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="min-w-[240px] flex-1 space-y-1">
          <label className="text-sm font-medium">Produk *</label>
          <Select className="w-full" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">— Pilih Produk —</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ""}{p.name}</option>))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Gudang</label>
          <Select className="w-44" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Semua gudang</option>
            {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.code} {w.name}</option>))}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Dari</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Sampai</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <Button onClick={query} loading={loading}>Tampilkan</Button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <p><span className="font-medium text-zinc-500">Produk:</span> {result.product.sku} — {result.product.name}</p>
            <p><span className="font-medium text-zinc-500">Saldo Awal:</span> {result.openingQuantity} / {result.openingValue}</p>
            <p><span className="font-medium text-zinc-500">Saldo Akhir:</span> {result.closingQuantity} / {result.closingValue}</p>
            <p><span className="font-medium text-zinc-500">Pergerakan:</span> {result.rows.length}</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-left">Gudang</th><th className="px-3 py-2 text-left">Sumber</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit Cost</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Saldo Qty</th><th className="px-3 py-2 text-right">Saldo Nilai</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {result.rows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2">{row.movementDate}</td>
                    <td className="px-3 py-2">{row.warehouseCode}</td>
                    <td className="px-3 py-2 text-zinc-500"><code className="text-xs">{row.sourceDocNo ?? row.sourceType}</code></td>
                    <td className="px-3 py-2 text-right font-mono">{row.direction === "in" ? "+" : "-"}{row.quantity}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.unitCost ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.totalCost ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.balanceQuantity}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.balanceValue}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-zinc-500">Tidak ada pergerakan pada rentang ini.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !result && <div className="flex justify-center py-12"><Spinner size={28} /></div>}
    </div>
  );
}
