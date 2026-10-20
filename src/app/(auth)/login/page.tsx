"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Lock, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const loginSchema = z.object({
  email: z.string().email("Masukkan email yang valid."),
  password: z.string().min(1, "Kata sandi wajib diisi."),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginForm) {
    setServerError(null);
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        credentials: "same-origin",
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        const msg = body?.message ?? `Login gagal (${res.status}).`;
        setServerError(msg);
        toast.error(msg);
        return;
      }

      toast.success("Berhasil masuk.");
      router.replace("/");
    } catch {
      const msg = "Koneksi terganggu. Coba lagi.";
      setServerError(msg);
      toast.error(msg);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">ERP — Masuk</CardTitle>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Sistem Enterprise Resource Planning
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-zinc-400" aria-hidden />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="admin@erp.com"
                className="pl-9"
                aria-invalid={!!errors.email}
                {...register("email")}
              />
            </div>
            {errors.email && (
              <p className="text-xs text-red-600 dark:text-red-400">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Kata Sandi</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-zinc-400" aria-hidden />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••••"
                className="pl-9"
                aria-invalid={!!errors.password}
                {...register("password")}
              />
            </div>
            {errors.password && (
              <p className="text-xs text-red-600 dark:text-red-400">{errors.password.message}</p>
            )}
          </div>

          {serverError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {serverError}
            </p>
          )}

          <Button type="submit" className="w-full" loading={isSubmitting}>
            Masuk
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
