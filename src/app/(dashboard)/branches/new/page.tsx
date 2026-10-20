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
  code: z.string().trim().min(2).max(20).regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Huruf besar, angka, strip, underscore."),
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(30).optional(),
});
type FormValues = z.input<typeof schema>;

export default function NewBranchPage() {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });
  const submit = useFormSubmit<FormValues>({ url: "/api/branches", redirectTo: "/branches", successMessage: "Cabang dibuat.", setError });

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/branches"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Cabang Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
        <FormField name="code" label="Kode" required register={register("code")} error={errors.code?.message} placeholder="JKT-01" />
        <FormField name="name" label="Nama" required register={register("name")} error={errors.name?.message} placeholder="Kantor Pusat Jakarta" />
        <FormField name="address" label="Alamat" register={register("address")} error={errors.address?.message} />
        <FormField name="phone" label="Telepon" register={register("phone")} error={errors.phone?.message} placeholder="+62 21 555 0000" />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
