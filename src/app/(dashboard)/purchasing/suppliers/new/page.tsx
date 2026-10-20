"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { useFormSubmit } from "@/hooks/use-form-submit";

const schema = z.object({
  code: z.string().trim().min(2, "Kode minimal 2 karakter.").max(30),
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(150),
  taxId: z.string().trim().max(30).optional(),
  currency: z.string().optional(),
  paymentTermsId: z.string().optional(),
  email: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
});
type FormValues = z.input<typeof schema>;

type Currency = { code: string; name: string };
type Term = { id: string; code: string; name: string };

export default function NewSupplierPage() {
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } =
    useForm<FormValues>({ resolver: zodResolver(schema) });

  const submit = useFormSubmit<FormValues>({
    url: "/api/purchasing/suppliers", redirectTo: "/purchasing/suppliers",
    successMessage: "Pemasok dibuat.", setError,
  });

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);

  useEffect(() => {
    fetch("/api/currencies?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Currency[] }) => setCurrencies(j.data)).catch(() => {});
    fetch("/api/purchasing/payment-terms?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Term[] }) => setTerms(j.data)).catch(() => {});
  }, []);

  function onSubmit(values: FormValues) {
    const body: Record<string, unknown> = { code: values.code, name: values.name };
    if (values.taxId) body.taxId = values.taxId;
    if (values.currency) body.currency = values.currency;
    if (values.paymentTermsId) body.paymentTermsId = values.paymentTermsId;
    if (values.email) body.email = values.email;
    if (values.phone) body.phone = values.phone;
    if (values.address) body.address = values.address;
    if (values.notes) body.notes = values.notes;
    return submit(body);
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/purchasing/suppliers"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Pemasok Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="code" label="Kode" register={register("code")} error={errors.code?.message} />
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <FormField name="taxId" label="NPWP" register={register("taxId")} error={errors.taxId?.message} placeholder="Opsional" />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Mata Uang</label>
          <Select className="w-full" {...register("currency")}>
            <option value="">— Default IDR —</option>
            {currencies.map((c) => (<option key={c.code} value={c.code}>{c.code} — {c.name}</option>))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Termin Pembayaran</label>
          <Select className="w-full" {...register("paymentTermsId")}>
            <option value="">— Belum ditentukan —</option>
            {terms.map((t) => (<option key={t.id} value={t.id}>{t.code} — {t.name}</option>))}
          </Select>
        </div>
        <FormField name="email" label="Email" register={register("email")} error={errors.email?.message} />
        <FormField name="phone" label="Telepon" register={register("phone")} error={errors.phone?.message} />
        <FormField name="address" label="Alamat" register={register("address")} error={errors.address?.message} />
        <FormField name="notes" label="Catatan" register={register("notes")} error={errors.notes?.message} />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
