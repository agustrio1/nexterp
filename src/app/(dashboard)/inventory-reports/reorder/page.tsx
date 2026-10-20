"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Option = { id: string; code?: string; name: string };
type ReorderRow = { productId: string; productSku: string; productName: string; reorderPoint: string; onHand: string; suggestedQuantity: string };
type ReorderResult = { count: number; rows: ReorderRow[] };

export default function ReorderReportPage() {
  const [products, setProducts] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [result, setResult] = useState<ReorderResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setProducts(j.data)).catch(() => {});
    fetch("/api/warehouses?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setWarehouses(j.data)).catch(() => {});
    fetch("/api/branches?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setBranches(j.data)).catch(() => {});
  }, []);

  async function query() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (productId) params.set("productId", productId);
      if (warehouseId) params.set("warehouseId", warehouseId);
      if (branchId) params.set("branchId", branchId);
      const qs = params.toString();
      const res = await fetch(`/api/reports/reorder${qs ? `?${qs}` : ""}`, { credentials: "same-origin" });
      if (res.ok) { const json = (await res.json()) as { data: ReorderResult }; setResult(json.data); }
      else { const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(err?.error?.message ?? "Gagal memuat reorder."); setResult(null); }
    } catch { toast.error("Koneksi terganggu."); } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Reorder Persediaan</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="space-y-1">
          <label className="text-sm font-medium">Produk</label>
          <Select className="w-52" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Semua produk</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Gudang</label>
          <Select className="w-44" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Semua gudang</option>
            {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.code} {w.name}</option>))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Cabang</label>
          <Select className="w-44" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Semua cabang</option>
            {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
          </Select>
        </div>
        <Button onClick={query} loading={loading}>Tampilkan</Button>
      </div>

      {result && (
        <div className="space-y-3">
          <p className="text-sm"><span className="font-medium text-zinc-500">Produk di bawah reorder point:</span> {result.count}</p>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">SKU</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Reorder Point</th><th className="px-3 py-2 text-right">Stok Tersedia</th><th className="px-3 py-2 text-right">Usulan Pesan</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {result.rows.map((row) => (
                  <tr key={row.productId}>
                    <td className="px-3 py-2"><code className="text-xs">{row.productSku}</code></td>
                    <td className="px-3 py-2">{row.productName}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.reorderPoint}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-600">{row.onHand}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{row.suggestedQuantity}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Tidak ada produk di bawah titik pemesanan.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !result && <div className="flex justify-center py-12"><Spinner size={28} /></div>}
    </div>
  );
}
