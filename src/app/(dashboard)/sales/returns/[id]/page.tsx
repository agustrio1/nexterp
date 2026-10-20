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

type ReturnLine = { id: string; lineNo: number; deliveryLineId: string; productId: string; quantity: string; unitCost: string | null; cogsAmount: string | null; description: string | null };
type ReturnDetail = { id: string; docNo: string | null; status: string; deliveryId: string; customerId: string; warehouseId: string; returnDate: string; notes: string | null; reason: string | null; lines: ReturnLine[] };
type Option = { id: string; name: string };

export default function SalesReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ret, setRet] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [products, setProducts] = useState<Option[]>([]);

  useEffect(() => {
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setProducts(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sales/returns/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: ReturnDetail }) => setRet(j.data))
      .catch(() => toast.error("Gagal memuat retur."))
      .finally(() => setLoading(false));
  }, [id]);

  async function doAction(url: string, body?: unknown) {
    setActionLoading(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: ReturnDetail }; setRet(j.data); toast.success("Aksi berhasil."); }
      else { const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setActionLoading(false); setReason(""); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!ret) return <p className="text-red-600">Retur tidak ditemukan.</p>;

  const productName = (pid: string) => { const p = products.find((x) => x.id === pid); return p ? p.name : pid.slice(0, 8); };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/returns"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{ret.docNo ?? "Draf"}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{ret.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div><span className="font-medium text-zinc-500">Tanggal Retur:</span> {ret.returnDate}</div>
        <div><span className="font-medium text-zinc-500">Pengiriman Asal:</span> <code className="font-mono text-xs">{ret.deliveryId.slice(0, 8)}</code></div>
        {ret.notes && <div className="col-span-2"><span className="font-medium text-zinc-500">Catatan:</span> {ret.notes}</div>}
        {ret.reason && <div className="col-span-2"><span className="font-medium text-zinc-500">Alasan:</span> {ret.reason}</div>}
      </div>

      {ret.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit Cost</th><th className="px-3 py-2 text-right">COGS</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{ret.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{productName(l.productId)}{l.description ? <span className="ml-1 text-xs text-zinc-400">({l.description})</span> : null}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2 text-right font-mono">{l.unitCost ?? "—"}</td><td className="px-3 py-2 text-right font-mono">{l.cogsAmount ?? "—"}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {ret.status === "draft" && (
          <>
            <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Posting Retur</Button>} title="Posting retur?" description="Stok masuk kembali, jurnal Dr Inventory / Cr COGS dibuat." onConfirm={() => doAction(`/api/sales/returns/${ret.id}/post`)} />
            <div className="space-y-2">
              <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
              <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan retur?" destructive onConfirm={() => doAction(`/api/sales/returns/${ret.id}/cancel`, { reason })} />
            </div>
          </>
        )}
        {ret.status === "posted" && (
          <div className="space-y-2">
            <Input placeholder="Alasan reversal" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
            <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-orange-600">Reversal</Button>} title="Balik retur?" description="Stok dan jurnal dibalik." destructive onConfirm={() => doAction(`/api/sales/returns/${ret.id}/reverse`, { reason })} />
          </div>
        )}
      </div>
    </div>
  );
}
