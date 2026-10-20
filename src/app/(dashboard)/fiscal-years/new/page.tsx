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
  code: z.string().trim().min(2).max(20).regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Kode tidak valid."),
  startDate: z.string().min(1, "Wajib diisi."),
  endDate: z.string().min(1, "Wajib diisi."),
  includeAdjustmentPeriod: z.boolean().optional(),
});
type FormValues = z.input<typeof schema>;

export default function NewFiscalYearPage() {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });
  const submit = useFormSubmit<FormValues>({ url: "/api/fiscal-years", redirectTo: "/fiscal-years", successMessage: "Tahun fiskal dibuat.", setError });

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/fiscal-years"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Tahun Fiskal Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
        <FormField name="code" label="Kode" required register={register("code")} error={errors.code?.message} placeholder="FY-2027" />
        <FormField name="startDate" label="Tanggal Mulai" required type="date" register={register("startDate")} error={errors.startDate?.message} />
        <FormField name="endDate" label="Tanggal Akhir" required type="date" register={register("endDate")} error={errors.endDate?.message} />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
