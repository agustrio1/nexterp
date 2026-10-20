"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type PoLine = { id: string; lineNo: number; productId: string; quantity: string; unitPrice: string; quantityReceived: string; description: string | null };
type PoSummary = { id: string; docNo: string | null; supplierId: string; currency: string; lines: PoLine[] };
type Option = { id: string; code?: string; name: string };

export default function NewInvoicePage() {
  const router = useRouter();
  const [pos, setPos] = useState<Option[]>([]);
  const [poId, setPoId] = useState("");
  const [po, setPo] = useState<PoSummary | null>(null);
  const [loadingPo, setLoadingPo] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function fetchPoDetail(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/purchasing/purchase-orders/${id}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error("gagal");
      const j = (await res.json()) as { data: PoSummary };
      setPo(j.data);
      setDueDate((prev) => prev || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })());
    } catch { toast.error("Gagal memuat PO."); }
  }

  useEffect(() => {
    // Pra-isi dari ?poId (link dari detail PO) tanpa useSearchParams agar aman di shell statik.
    const preset = new URLSearchParams(window.location.search).get("poId");
    if (preset) {
      fetch(`/api/purchasing/purchase-orders/${preset}`, { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((j: { data: PoSummary }) => {
          setPoId(preset);
          setPo(j.data);
          setDueDate((prev) => prev || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })());
        })
        .catch(() => { toast.error("Gagal memuat PO."); });
    }
    fetch("/api/purchasing/purchase-orders?status=posted", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: { id: string; docNo: string | null; supplierId: string }[] }) => setPos(j.data.map((p) => ({ id: p.id, code: p.docNo ?? undefined, name: p.supplierId }))))
      .catch(() => {});
  }, []);

  function onPoChange(id: string) {
    setPoId(id);
    setPo(null);
    setQtys({});
    if (id) { setLoadingPo(true); void fetchPoDetail(id).finally(() => setLoadingPo(false)); }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!po) { toast.error("Pilih PO terlebih dahulu."); return; }
    if (!dueDate) { toast.error("Tanggal jatuh tempo wajib diisi."); return; }
    const lines = po.lines
      .map((l) => ({ poLineId: l.id, quantity: qtys[l.id] ?? "", unitPrice: l.unitPrice }))
      .filter((l) => l.quantity !== "" && Number(l.quantity) > 0);
    if (lines.length === 0) { toast.error("Isi kuantitas minimal satu baris."); return; }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { poId: po.id, invoiceDate, dueDate, lines };
      if (notes) body.notes = notes;
      const res = await fetch("/api/purchasing/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Invoice dibuat."); router.push(`/purchasing/invoices/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/purchasing/invoices"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Invoice Pemasok Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-sm font-medium">PO (posted) *</label>
            <Select className="w-full" value={poId} onChange={(e) => onPoChange(e.target.value)}>
              <option value="">— Pilih PO —</option>
              {pos.map((p) => (<option key={p.id} value={p.id}>{p.code ?? p.id.slice(0, 8)}</option>))}
            </Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tanggal Invoice *</label><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Jatuh Tempo *</label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        {loadingPo && <div className="flex justify-center py-6"><Spinner size={22} /></div>}
        {po && (
          <>
            <p className="text-sm text-zinc-500">Mata uang PO: <span className="font-medium">{po.currency}</span> — harga satuan terkunci dari PO (three-way match).</p>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-right">Qty PO</th><th className="px-3 py-2 text-right">Harga</th><th className="px-3 py-2 text-left">Tagih Sekarang</th></tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{po.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.lineNo}</td><td className="px-3 py-2">{l.description ?? l.productId.slice(0, 8)}</td><td className="px-3 py-2 text-right font-mono">{l.quantity}</td><td className="px-3 py-2 text-right font-mono">{l.unitPrice}</td><td className="px-3 py-2"><Input className="w-28" value={qtys[l.id] ?? ""} onChange={(e) => setQtys((prev) => ({ ...prev, [l.id]: e.target.value }))} placeholder="0" /></td></tr>))}</tbody>
              </table>
            </div>
          </>
        )}
        <div><Button type="submit" loading={submitting} disabled={!po}>Simpan Draf</Button></div>
      </form>
    </div>
  );
}
