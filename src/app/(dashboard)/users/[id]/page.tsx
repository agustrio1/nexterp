"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";

const editSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("Email tidak valid.")),
});
type EditForm = z.input<typeof editSchema>;

const pwdSchema = z.object({ password: z.string().min(12).max(128) });
type PwdForm = z.input<typeof pwdSchema>;

export default function EditUserPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ name: string; email: string; status: string } | null>(null);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<EditForm>({ resolver: zodResolver(editSchema) });
  const { register: regPwd, handleSubmit: subPwd, formState: { errors: pwdErrors, isSubmitting: pwdLoading } } =
    useForm<PwdForm>({ resolver: zodResolver(pwdSchema) });

  useEffect(() => {
    if (!id) return;
    fetch(`/api/users/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: { name: string; email: string; status: string } }) => {
        setUser(json.data);
        reset({ name: json.data.name, email: json.data.email });
      })
      .catch(() => toast.error("Gagal memuat data pengguna."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: EditForm) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
      credentials: "same-origin",
    });
    if (res.ok) {
      toast.success("Pengguna diperbarui.");
    } else {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      toast.error(body?.error?.message ?? "Gagal memperbarui.");
    }
  }

  async function onResetPassword(values: PwdForm) {
    const res = await fetch(`/api/users/${id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
      credentials: "same-origin",
    });
    if (res.ok) {
      toast.success("Kata sandi direset.");
    } else {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      toast.error(body?.error?.message ?? "Gagal reset sandi.");
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!user) return <p className="text-sm text-zinc-500">Pengguna tidak ditemukan.</p>;

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/users"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Edit: {user.name}</h1>
        <span className="text-xs text-zinc-400">({user.status})</span>
      </div>

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <FormField name="email" label="Email" type="email" register={register("email")} error={errors.email?.message} />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      <h2 className="text-lg font-medium">Reset Kata Sandi</h2>
      <form onSubmit={(e) => void subPwd(onResetPassword)(e)} className="space-y-4">
        <FormField name="password" label="Kata sandi baru" type="password" register={regPwd("password")} error={pwdErrors.password?.message} placeholder="Minimal 12 karakter" />
        <Button type="submit" variant="secondary" loading={pwdLoading}>Reset Sandi</Button>
      </form>
    </div>
  );
}
