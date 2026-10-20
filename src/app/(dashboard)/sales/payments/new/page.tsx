"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Customer = { id: string; code: string; accountName: string; currency: string };
type Option = { id: string; code?: string; name: string };

export default function NewSalesPaymentPage() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState("");
  const [currency, setCurrency] = useState("");
  const [amountForeign, setAmountForeign] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [bankAccounts, setBankAccounts] = useState<Option[]>([]);

  useEffect(() => {
    fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Customer[] }) => setCustomers(j.data)).catch(() => {});
    fetch("/api/branches?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setBranches(j.data)).catch(() => {});
    fetch("/api/bank-accounts?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setBankAccounts(j.data)).catch(() => {});

    const preset = new URLSearchParams(window.location.search).get("customerId");
    if (preset) {
      fetch("/api/crm/customers?isActive=true", { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : { data: [] })
        .then((j: { data: Customer[] }) => {
          const c = j.data.find((x) => x.id === preset);
          if (c) { setCustomerId(c.id); setCurrency(c.currency); }
        })
        .catch(() => {});
    }
  }, []);

  function onCustomerChange(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) setCurrency(c.currency);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { toast.error("Pilih pelanggan."); return; }
    if (!branchId) { toast.error("Pilih cabang."); return; }
    if (!bankAccountId) { toast.error("Pilih rekening bank kas."); return; }
    if (!amountForeign) { toast.error("Isi nominal pembayaran."); return; }

    const body: Record<string, unknown> = { customerId, branchId, paymentDate, bankAccountId, amountForeign };
    if (currency) body.currency = currency;
    if (memo) body.memo = memo;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sales/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Pembayaran dibuat."); router.push(`/sales/payments/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/sales/payments"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Pembayaran Customer Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><label className="text-sm font-medium">Pelanggan *</label>
            <Select className="w-full" value={customerId} onChange={(e) => onCustomerChange(e.target.value)}><option value="">— Pilih —</option>{customers.map((c) => (<option key={c.id} value={c.id}>{c.code} — {c.accountName}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Cabang *</label>
            <Select className="w-full" value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">— Pilih —</option>{branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tanggal Pembayaran *</label><Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Rekening Bank Kas *</label>
            <Select className="w-full" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}><option value="">— Pilih —</option>{bankAccounts.map((b) => (<option key={b.id} value={b.id}>{b.code} — {b.name}</option>))}</Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Mata Uang</label>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="Default pelanggan" maxLength={3} />
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Nominal *</label><Input value={amountForeign} onChange={(e) => setAmountForeign(e.target.value)} placeholder="0.00" /></div>
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Memo</label><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
        <p className="text-xs text-zinc-500">Saat diposting, nominal dialokasikan otomatis (FIFO urut jatuh tempo) ke faktur terbuka pelanggan, lalu jurnal Dr AR / Cr Bank diterbitkan.</p>
        <div><Button type="submit" loading={submitting}>Simpan Draf</Button></div>
      </form>
    </div>
  );
}
