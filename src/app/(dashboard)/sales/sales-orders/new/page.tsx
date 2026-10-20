"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Option = { id: string; code?: string; name?: string; accountName?: string };
type Line = { productId: string; quantity: string; unitPrice: string; description: string };
type QuotationDetail = { customerId: string; branchId: string; currency: string; description: string | null; notes: string | null; lines: { productId: string; quantity: string; unitPrice: string; description: string | null }[] };

export default function NewSalesOrderPage() {
  const router = useRouter();
  const [quotationId, setQuotationId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [currency, setCurrency] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "", unitPrice: "", description: "" }]);
  const [submitting, setSubmitting] = useState(false);

  const [customers, setCustomers] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [products, setProducts] = useState<Option[]>([]);
  const [acceptedQuotations, setAcceptedQuotations] = useState<{ id: string; docNo: string | null; customerId: string }[]>([]);

  useEffect(() => {
    fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setCustomers(j.data)).catch(() => {});
    fetch("/api/branches?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setBranches(j.data)).catch(() => {});
    fetch("/api/products?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setProducts(j.data)).catch(() => {});
    fetch("/api/sales/quotations?status=accepted", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: { id: string; docNo: string | null; customerId: string }[] }) => setAcceptedQuotations(j.data)).catch(() => {});

    const preset = new URLSearchParams(window.location.search).get("quotationId");
    if (preset) {
      fetch(`/api/sales/quotations/${preset}`, { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((j: { data: QuotationDetail }) => {
          setQuotationId(preset);
          setCustomerId(j.data.customerId);
          setBranchId(j.data.branchId);
          setCurrency(j.data.currency);
          setDescription(j.data.description ?? "");
          setNotes(j.data.notes ?? "");
          setLines(j.data.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, description: l.description ?? "" })));
        })
        .catch(() => toast.error("Gagal memuat quotation."));
    }
  }, []);

  function onQuotationChange(id: string) {
    setQuotationId(id);
    if (!id) return;
    fetch(`/api/sales/quotations/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: QuotationDetail }) => {
        setCustomerId(j.data.customerId);
        setBranchId(j.data.branchId);
        setCurrency(j.data.currency);
        setDescription(j.data.description ?? "");
        setNotes(j.data.notes ?? "");
        setLines(j.data.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, description: l.description ?? "" })));
        toast.success("Baris quotation dimuat.");
      })
      .catch(() => toast.error("Gagal memuat quotation."));
  }

  function addLine() { setLines((prev) => [...prev, { productId: "", quantity: "", unitPrice: "", description: "" }]); }
  function removeLine(idx: number) { if (lines.length > 1) setLines((prev) => prev.filter((_, i) => i !== idx)); }
  function updateLine(idx: number, patch: Partial<Line>) { setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))); }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { toast.error("Pilih pelanggan."); return; }
    if (!branchId) { toast.error("Pilih cabang."); return; }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].productId || !lines[i].quantity || !lines[i].unitPrice) { toast.error(`Baris ${i + 1}: lengkapi produk, kuantitas, dan harga.`); return; }
    }

    const body: Record<string, unknown> = {
      customerId, branchId, orderDate,
      lines: lines.map((l) => { const line: Record<string, unknown> = { productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice }; if (l.description) line.description = l.description; return line; }),
    };
    if (quotationId) body.quotationId = quotationId;
    if (expectedDate) body.expectedDate = expectedDate;
    if (currency) body.currency = currency;
    if (description) body.description = description;
    if (notes) body.notes = notes;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sales/sales-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Sales order dibuat."); router.push(`/sales/sales-orders/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/sales-orders"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Sales Order Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-sm font-medium">Dari Quotation</label>
            <Select className="w-full" value={quotationId} onChange={(e) => onQuotationChange(e.target.value)}><option value="">— Tanpa quotation —</option>{acceptedQuotations.map((q) => (<option key={q.id} value={q.id}>{q.docNo ?? q.id.slice(0, 8)}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Pelanggan *</label>
            <Select className="w-full" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">— Pilih —</option>{customers.map((c) => (<option key={c.id} value={c.id}>{c.code} {c.accountName}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Cabang *</label>
            <Select className="w-full" value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">— Pilih —</option>{branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Mata Uang</label>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="Default pelanggan" maxLength={3} />
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tanggal SO *</label><Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Rencana Kirim</label><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Deskripsi</label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm"><thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Produk</th><th className="px-3 py-2 text-left">Qty</th><th className="px-3 py-2 text-left">Harga Satuan</th><th className="px-3 py-2 text-left">Deskripsi</th><th className="w-10 px-2 py-2" /></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{lines.map((l, idx) => (<tr key={idx}><td className="px-3 py-2 text-zinc-500">{idx + 1}</td><td className="px-3 py-2"><Select className="w-full min-w-[140px]" value={l.productId} onChange={(e) => updateLine(idx, { productId: e.target.value })}><option value="">— Pilih —</option>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select></td><td className="px-3 py-2"><Input className="w-24" value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} placeholder="0" /></td><td className="px-3 py-2"><Input className="w-32" value={l.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} placeholder="0.00" /></td><td className="px-3 py-2"><Input className="w-32" value={l.description} onChange={(e) => updateLine(idx, { description: e.target.value })} /></td><td className="px-2 py-2">{lines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(idx)}><Trash2 className="h-4 w-4 text-red-500" /></Button>}</td></tr>))}</tbody>
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="h-4 w-4" /> Tambah Baris</Button>
        <div><Button type="submit" loading={submitting}>Simpan Draf</Button></div>
      </form>
    </div>
  );
}
