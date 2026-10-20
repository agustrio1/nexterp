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
  name: z.string().trim().min(2).max(100),
  parentId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
});
type FormValues = z.input<typeof schema>;

export default function NewDepartmentPage() {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });
  const submit = useFormSubmit<FormValues>({ url: "/api/departments", redirectTo: "/departments", successMessage: "Departemen dibuat.", setError });

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/departments"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Departemen Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
        <FormField name="code" label="Kode" required register={register("code")} error={errors.code?.message} placeholder="FIN" />
        <FormField name="name" label="Nama" required register={register("name")} error={errors.name?.message} placeholder="Keuangan" />
        <FormField name="parentId" label="ID Induk (opsional)" register={register("parentId")} error={errors.parentId?.message} placeholder="UUID parent" />
        <FormField name="branchId" label="ID Cabang (opsional)" register={register("branchId")} error={errors.branchId?.message} placeholder="UUID cabang" />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
