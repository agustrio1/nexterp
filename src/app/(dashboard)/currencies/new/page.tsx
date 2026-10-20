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
  code: z.string().trim().regex(/^[A-Z]{3}$/, "3 huruf (ISO 4217)."),
  name: z.string().trim().min(2).max(100),
  symbol: z.string().trim().max(10).optional(),
  decimals: z.coerce.number().int().min(0).max(6),
});
type FormValues = z.input<typeof schema>;

export default function NewCurrencyPage() {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { decimals: 2 } });
  const submit = useFormSubmit<FormValues>({ url: "/api/currencies", redirectTo: "/currencies", successMessage: "Mata uang dibuat.", setError });

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/currencies"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Mata Uang Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
        <FormField name="code" label="Kode (ISO)" required register={register("code")} error={errors.code?.message} placeholder="USD" />
        <FormField name="name" label="Nama" required register={register("name")} error={errors.name?.message} placeholder="US Dollar" />
        <FormField name="symbol" label="Simbol" register={register("symbol")} error={errors.symbol?.message} placeholder="$" />
        <FormField name="decimals" label="Desimal" required type="number" register={register("decimals")} error={errors.decimals?.message} />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
