"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useFormSubmit } from "@/hooks/use-form-submit";

const schema = z.object({
  fromCurrency: z.string().trim().regex(/^[A-Z]{3}$/, "3 huruf."),
  rateDate: z.string().min(1, "Wajib diisi."),
  rate: z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, "Angka, maks 6 desimal."),
  source: z.string().trim().max(100).optional(),
});
type FormValues = z.input<typeof schema>;

export default function NewExchangeRatePage() {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });
  const submit = useFormSubmit<FormValues>({ url: "/api/exchange-rates", redirectTo: "/currencies", successMessage: "Kurs ditambahkan.", setError });

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/currencies"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Kurs Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
        <FormField name="fromCurrency" label="Dari (Kode ISO)" required register={register("fromCurrency")} error={errors.fromCurrency?.message} placeholder="USD" />
        <FormField name="rateDate" label="Tanggal Kurs" required type="date" register={register("rateDate")} error={errors.rateDate?.message} />
        <FormField name="rate" label="Kurs" required register={register("rate")} error={errors.rate?.message} placeholder="16500.00" />
        <FormField name="source" label="Sumber" register={register("source")} error={errors.source?.message} placeholder="BI Rate" />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
