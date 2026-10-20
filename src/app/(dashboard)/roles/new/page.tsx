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
  code: z.string().trim().min(3).max(50).regex(/^[a-z][a-z0-9_]*$/, "Huruf kecil, angka, underscore; diawali huruf."),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
});
type FormValues = z.input<typeof schema>;

export default function NewRolePage() {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });
  const submit = useFormSubmit<FormValues>({
    url: "/api/roles", redirectTo: "/roles", successMessage: "Role berhasil dibuat.", setError,
  });

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/roles"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Role Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
        <FormField name="code" label="Kode" required register={register("code")} error={errors.code?.message} placeholder="admin_keuangan" />
        <FormField name="name" label="Nama" required register={register("name")} error={errors.name?.message} placeholder="Admin Keuangan" />
        <FormField name="description" label="Deskripsi" register={register("description")} error={errors.description?.message} placeholder="Opsional" />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
