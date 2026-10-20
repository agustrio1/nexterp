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
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("Email tidak valid.")),
  password: z.string().min(12, "Kata sandi minimal 12 karakter.").max(128),
});
type FormValues = z.input<typeof schema>;

export default function NewUserPage() {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });

  const submit = useFormSubmit<FormValues>({
    url: "/api/users",
    redirectTo: "/users",
    successMessage: "Pengguna berhasil dibuat.",
    setError,
  });

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/users"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Pengguna Baru</h1>
      </div>

      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
        <FormField
          name="name" label="Nama" required
          register={register("name")}
          error={errors.name?.message}
          placeholder="Nama lengkap"
        />
        <FormField
          name="email" label="Email" required type="email"
          register={register("email")}
          error={errors.email?.message}
          placeholder="user@example.com"
        />
        <FormField
          name="password" label="Kata Sandi" required type="password"
          register={register("password")}
          error={errors.password?.message}
          placeholder="Minimal 12 karakter"
        />
        <div className="pt-2">
          <Button type="submit" loading={isSubmitting}>Simpan</Button>
        </div>
      </form>
    </div>
  );
}
