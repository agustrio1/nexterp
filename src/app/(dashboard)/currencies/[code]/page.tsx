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

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  symbol: z.string().trim().max(10).optional(),
  decimals: z.coerce.number().int().min(0).max(6).optional(),
  isActive: z.boolean().optional(),
});
type FormValues = z.input<typeof schema>;

export default function EditCurrencyPage() {
  const { code } = useParams<{ code: string }>();
  const [loading, setLoading] = useState(true);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!code) return;
    fetch(`/api/currencies/${code}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: { name: string; symbol: string | null; decimals: number } }) => {
        reset({ name: json.data.name, symbol: json.data.symbol ?? "", decimals: json.data.decimals });
      })
      .catch(() => toast.error("Gagal memuat mata uang."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function onSubmit(values: FormValues) {
    const res = await fetch(`/api/currencies/${code}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values), credentials: "same-origin",
    });
    if (res.ok) toast.success("Mata uang diperbarui.");
    else toast.error("Gagal memperbarui.");
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/currencies"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Edit: <code className="text-base">{code}</code></h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <FormField name="symbol" label="Simbol" register={register("symbol")} error={errors.symbol?.message} />
        <FormField name="decimals" label="Desimal" type="number" register={register("decimals")} error={errors.decimals?.message} />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
