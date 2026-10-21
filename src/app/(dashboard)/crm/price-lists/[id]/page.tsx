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

type Item = { id: string; productId: string; productName: string; productSku: string; unitPrice: string };
type PriceList = { id: string; code: string; name: string; validFrom: string; validTo: string | null; isActive: boolean; items: Item[] };
type Product = { id: string; sku: string; name: string };

export default function PriceListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pl, setPl] = useState<PriceList | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const [name, setName] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [productId, setProductId] = useState("");
  const [unitPrice, setUnitPrice] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/crm/price-lists/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: PriceList }) => {
        setPl(j.data);
        setName(j.data.name);
        setValidFrom(j.data.validFrom ? j.data.validFrom.slice(0, 10) : "");
        setValidTo(j.data.validTo ? j.data.validTo.slice(0, 10) : "");
        setIsActive(j.data.isActive);
      })
      .catch(() => toast.error("Gagal memuat daftar harga."))
      .finally(() => setLoading(false));
    fetch("/api/products?isActive=true", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: Product[] }) => setProducts(j.data))
      .catch(() => {});
  }, [id]);

  async function reload() {
    const res = await fetch(`/api/crm/price-lists/${id}`, { credentials: "same-origin" });
    if (res.ok) { const j = (await res.json()) as { data: PriceList }; setPl(j.data); }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!pl) return;
    if (name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    if (!validFrom) { toast.error("Tanggal mulai wajib diisi."); return; }
    const body: Record<string, unknown> = { name: name.trim(), validFrom, isActive };
    if (validTo) body.validTo = validTo;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/price-lists/${pl.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: Omit<PriceList, "items"> }; setPl({ ...pl, ...j.data }); toast.success("Daftar harga diperbarui."); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!pl) return;
    if (!productId) { toast.error("Pilih produk."); return; }
    if (!/^\d{1,14}(\.\d{1,4})?$/.test(unitPrice.trim())) { toast.error("Harga maksimal 14 digit + 4 desimal."); return; }
    setAdding(true);
    try {
      const res = await fetch(`/api/crm/price-lists/${pl.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, unitPrice: unitPrice.trim() }), credentials: "same-origin" });
      if (res.ok) { toast.success("Item ditambahkan."); setProductId(""); setUnitPrice(""); await reload(); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setAdding(false); }
  }

  async function onRemoveItem(removeProductId: string) {
    if (!pl) return;
    const res = await fetch(`/api/crm/price-lists/${pl.id}/items/${removeProductId}`, { method: "DELETE", credentials: "same-origin" });
    if (res.ok) { toast.success("Item dihapus."); await reload(); }
    else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!pl) return <p className="text-red-600">Daftar harga tidak ditemukan.</p>;

  const existingIds = new Set(pl.items.map((i) => i.productId));
  const availableProducts = products.filter((p) => !existingIds.has(p.id));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/price-lists"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold"><code className="font-mono text-lg">{pl.code}</code> — {pl.name}</h1>
        {!pl.isActive && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">Nonaktif</span>}
      </div>

      <form onSubmit={onSave} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">Ubah Daftar Harga</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Berlaku Dari *</label><Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Sampai</label><Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label>
        <div><Button type="submit" loading={saving}>Simpan Perubahan</Button></div>
      </form>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Item ({pl.items.length})</h2>
        <form onSubmit={onAddItem} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Produk</label>
            <Select className="w-full" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— Pilih produk —</option>
              {availableProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Harga *</label><Input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0.00" /></div>
          <div className="flex items-end"><Button type="submit" loading={adding}>Tambah Item</Button></div>
        </form>

        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">SKU</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Harga</th><th className="px-3 py-2 text-left">Aksi</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {pl.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-2"><code className="font-mono">{it.productSku}</code></td>
                  <td className="px-3 py-2">{it.productName}</td>
                  <td className="px-3 py-2 text-right">{Number(it.unitPrice).toLocaleString("id-ID")}</td>
                  <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => void onRemoveItem(it.productId)}>Hapus</Button></td>
                </tr>
              ))}
              {pl.items.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-500">Belum ada item.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
