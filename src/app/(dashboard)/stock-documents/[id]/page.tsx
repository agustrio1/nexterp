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

type DocLine = { id: string; lineNo: number; productId: string; productName: string; quantity: string; unitCost: string | null; memo: string | null };
type DocDetail = { id: string; docNo: string | null; type: string; status: string; documentDate: string; description: string | null; branchId: string; fromWarehouseId: string | null; toWarehouseId: string | null; lines?: DocLine[] };

export default function StockDocDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/stock-documents/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: DocDetail }) => setDoc(j.data))
      .catch(() => toast.error("Gagal memuat dokumen."))
      .finally(() => setLoading(false));
  }, [id]);

  async function doAction(url: string, body?: unknown) {
    setActionLoading(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: DocDetail }; setDoc(j.data); toast.success("Aksi berhasil."); }
      else { const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setActionLoading(false); setReason(""); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!doc) return <p className="text-red-600">Dokumen tidak ditemukan.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/stock-documents"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{doc.docNo ?? "Draf"}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{doc.type} · {doc.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div><span className="font-medium text-zinc-500">Tanggal:</span> {doc.documentDate}</div>
        <div><span className="font-medium text-zinc-500">Deskripsi:</span> {doc.description ?? "—"}</div>
      </div>

      {doc.lines && doc.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit Cost</th><th className="px-3 py-2 text-left">Memo</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{doc.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{l.productName}</td><td className="px-3 py-2 text-right">{l.quantity}</td><td className="px-3 py-2 text-right">{l.unitCost ?? "—"}</td><td className="px-3 py-2 text-zinc-500">{l.memo ?? ""}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {doc.status === "draft" && (
          <>
            <DialogConfirm trigger={<Button size="sm" loading={actionLoading}>Posting</Button>} title="Posting dokumen?" description="Pergerakan stok akan dicatat di ledger." onConfirm={() => doAction(`/api/stock-documents/${doc.id}/post`)} />
            <div className="space-y-2">
              <Input placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
              <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>} title="Batalkan draf?" destructive onConfirm={() => doAction(`/api/stock-documents/${doc.id}/cancel`, { reason })} />
            </div>
          </>
        )}
        {doc.status === "posted" && (
          <div className="space-y-2">
            <Input placeholder="Alasan reversal" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
            <DialogConfirm trigger={<Button variant="outline" size="sm" className="text-red-600">Reversal</Button>} title="Reversal dokumen?" description="Akan membuat pergerakan penyeimbang." destructive onConfirm={() => doAction(`/api/stock-documents/${doc.id}/reverse`, { reason })} />
          </div>
        )}
      </div>
    </div>
  );
}
