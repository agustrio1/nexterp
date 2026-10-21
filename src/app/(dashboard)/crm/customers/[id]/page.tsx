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

type Customer = { id: string; crmAccountId: string; accountName: string; code: string; creditLimit: string | null; paymentTermsId: string | null; paymentTermsName: string | null; priceListId: string | null; priceListName: string | null; currency: string; isActive: boolean };
type PaymentTerm = { id: string; name: string };
type PriceList = { id: string; name: string };

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [terms, setTerms] = useState<PaymentTerm[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [creditLimit, setCreditLimit] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [paymentTermsId, setPaymentTermsId] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/crm/customers/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: Customer }) => {
        setCustomer(j.data);
        setCreditLimit(j.data.creditLimit ?? "");
        setCurrency(j.data.currency);
        setPaymentTermsId(j.data.paymentTermsId ?? "");
        setPriceListId(j.data.priceListId ?? "");
        setIsActive(j.data.isActive);
      })
      .catch(() => toast.error("Gagal memuat pelanggan."))
      .finally(() => setLoading(false));
    Promise.all([
      fetch("/api/purchasing/payment-terms?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/crm/price-lists?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
    ])
      .then(([t, p]: [{ data: PaymentTerm[] }, { data: PriceList[] }]) => { setTerms(t.data); setPriceLists(p.data); })
      .catch(() => {});
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return;
    if (creditLimit && !/^\d{1,14}(\.\d{1,2})?$/.test(creditLimit.trim())) { toast.error("Batas kredit maksimal 14 digit + 2 desimal."); return; }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) { toast.error("Kode mata uang harus 3 huruf."); return; }
    const body: Record<string, unknown> = { currency: currency.trim().toUpperCase(), isActive };
    if (creditLimit) body.creditLimit = creditLimit.trim();
    if (paymentTermsId) body.paymentTermsId = paymentTermsId;
    if (priceListId) body.priceListId = priceListId;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/customers/${customer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: Customer }; setCustomer(j.data); toast.success("Pelanggan diperbarui."); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!customer) return <p className="text-red-600">Pelanggan tidak ditemukan.</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/customers"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold"><code className="font-mono text-lg">{customer.code}</code> — {customer.accountName}</h1>
        {!customer.isActive && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">Nonaktif</span>}
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <Link className="text-blue-600 hover:underline" href={`/crm/accounts/${customer.crmAccountId}`}>Lihat akun CRM →</Link>
      </div>

      <form onSubmit={onSave} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">Ubah Pelanggan</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <div className="space-y-1"><label className="text-sm font-medium">Batas Kredit</label><Input value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="0.00" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Mata Uang *</label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Termin Bayar</label>
            <Select className="w-full" value={paymentTermsId} onChange={(e) => setPaymentTermsId(e.target.value)}>
              <option value="">—</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Daftar Harga</label>
            <Select className="w-full" value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
              <option value="">—</option>
              {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label>
        <div><Button type="submit" loading={saving}>Simpan Perubahan</Button></div>
      </form>
    </div>
  );
}
