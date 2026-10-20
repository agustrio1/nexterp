"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const schema = z.object({
  name: z.string().trim().min(2, "Minimal 2 karakter.").max(150),
  taxId: z.string().trim().max(30).optional(),
  currency: z.string().optional(),
  paymentTermsId: z.string().optional(),
  email: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
  isActive: z.boolean(),
});
type FormValues = z.input<typeof schema>;

type Currency = { code: string; name: string };
type Term = { id: string; code: string; name: string };

export default function EditSupplierPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    fetch("/api/currencies?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Currency[] }) => setCurrencies(j.data)).catch(() => {});
    fetch("/api/purchasing/payment-terms?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Term[] }) => setTerms(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/purchasing/suppliers/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: { code: string; name: string; taxId: string | null; currency: string; paymentTermsId: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null; isActive: boolean } }) => {
        setCode(json.data.code);
        reset({ name: json.data.name, taxId: json.data.taxId ?? "", currency: json.data.currency, paymentTermsId: json.data.paymentTermsId ?? "", email: json.data.email ?? "", phone: json.data.phone ?? "", address: json.data.address ?? "", notes: json.data.notes ?? "", isActive: json.data.isActive });
      })
      .catch(() => toast.error("Gagal memuat pemasok."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: FormValues) {
    const body: Record<string, unknown> = { name: values.name, currency: values.currency, isActive: values.isActive };
    body.taxId = values.taxId || null;
    body.paymentTermsId = values.paymentTermsId || null;
    body.email = values.email || null;
    body.phone = values.phone || null;
    body.address = values.address || null;
    body.notes = values.notes || null;
    const res = await fetch(`/api/purchasing/suppliers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    if (res.ok) toast.success("Pemasok diperbarui.");
    else { const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e?.error?.message ?? "Gagal."); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/purchasing/suppliers"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Edit: <code className="text-base">{code}</code></h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <FormField name="taxId" label="NPWP" register={register("taxId")} error={errors.taxId?.message} />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Mata Uang</label>
          <Select className="w-full" {...register("currency")}>{currencies.map((c) => (<option key={c.code} value={c.code}>{c.code} — {c.name}</option>))}</Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Termin Pembayaran</label>
          <Select className="w-full" {...register("paymentTermsId")}><option value="">— Belum ditentukan —</option>{terms.map((t) => (<option key={t.id} value={t.id}>{t.code} — {t.name}</option>))}</Select>
        </div>
        <FormField name="email" label="Email" register={register("email")} error={errors.email?.message} />
        <FormField name="phone" label="Telepon" register={register("phone")} error={errors.phone?.message} />
        <FormField name="address" label="Alamat" register={register("address")} error={errors.address?.message} />
        <FormField name="notes" label="Catatan" register={register("notes")} error={errors.notes?.message} />
        <div className="flex items-center gap-2">
          <input type="checkbox" id="isActive" {...register("isActive")} className="h-4 w-4" />
          <label htmlFor="isActive" className="text-sm">Aktif</label>
        </div>
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
