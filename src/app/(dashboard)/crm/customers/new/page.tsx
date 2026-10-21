"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Account = { id: string; name: string };
type PaymentTerm = { id: string; name: string };
type PriceList = { id: string; name: string };

export default function NewCustomerPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [terms, setTerms] = useState<PaymentTerm[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);

  const [crmAccountId, setCrmAccountId] = useState("");
  const [code, setCode] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [paymentTermsId, setPaymentTermsId] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/crm/accounts?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/purchasing/payment-terms?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/crm/price-lists?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
    ])
      .then(([a, t, p]: [{ data: Account[] }, { data: PaymentTerm[] }, { data: PriceList[] }]) => {
        setAccounts(a.data); setTerms(t.data); setPriceLists(p.data);
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!crmAccountId) { toast.error("Pilih akun CRM."); return; }
    if (code.trim().length < 2) { toast.error("Kode pelanggan minimal 2 karakter."); return; }
    if (creditLimit && !/^\d{1,14}(\.\d{1,2})?$/.test(creditLimit.trim())) { toast.error("Batas kredit maksimal 14 digit + 2 desimal."); return; }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) { toast.error("Kode mata uang harus 3 huruf."); return; }

    const body: Record<string, unknown> = { crmAccountId, code: code.trim().toUpperCase(), currency: currency.trim().toUpperCase() };
    if (creditLimit) body.creditLimit = creditLimit.trim();
    if (paymentTermsId) body.paymentTermsId = paymentTermsId;
    if (priceListId) body.priceListId = priceListId;

    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Pelanggan dibuat."); router.push(`/crm/customers/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/customers"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Pelanggan Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2"><label className="text-sm font-medium">Akun CRM *</label>
            <Select className="w-full" value={crmAccountId} onChange={(e) => setCrmAccountId(e.target.value)}>
              <option value="">— Pilih akun —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PLG001" /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Batas Kredit</label><Input value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="0.00" /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Mata Uang *</label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Termin Bayar</label>
            <Select className="w-full" value={paymentTermsId} onChange={(e) => setPaymentTermsId(e.target.value)}>
              <option value="">—</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-3"><label className="text-sm font-medium">Daftar Harga</label>
            <Select className="w-full" value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
              <option value="">—</option>
              {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        </div>
        <p className="text-sm text-zinc-500">Catatan: satu akun CRM hanya dapat memiliki satu catatan pelanggan.</p>
        <div><Button type="submit" loading={submitting}>Simpan Pelanggan</Button></div>
      </form>
    </div>
  );
}
