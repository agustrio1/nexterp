"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { useFormSubmit } from "@/hooks/use-form-submit";

const schema = z.object({
  code: z.string().trim().min(2, "Minimal 2 karakter.").max(30),
  name: z.string().trim().min(2, "Minimal 2 karakter.").max(150),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  parentId: z.string().uuid().or(z.literal("")).optional(),
  isPostable: z.boolean(),
  description: z.string().trim().max(500).optional(),
});
type FormValues = z.input<typeof schema>;

type AccountOption = { id: string; code: string; name: string };

export default function NewAccountPage() {
  const { register, handleSubmit, formState: { errors }, setError } =
    useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { isPostable: true, type: "asset" } });

  const submit = useFormSubmit<FormValues>({
    url: "/api/chart-accounts",
    redirectTo: "/chart-of-accounts",
    successMessage: "Akun berhasil dibuat.",
    setError,
  });

  const [parentOptions, setParentOptions] = useState<AccountOption[]>([]);

  useEffect(() => {
    fetch("/api/chart-accounts?isPostable=false", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((json: { data: AccountOption[] }) => setParentOptions(json.data))
      .catch(() => {});
  }, []);

  function onSubmit(values: FormValues) {
    const body: Record<string, unknown> = {
      code: values.code,
      name: values.name,
      type: values.type,
      isPostable: values.isPostable,
    };
    if (values.parentId) body.parentId = values.parentId;
    if (values.description) body.description = values.description;
    return submit(body);
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/chart-of-accounts"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Akun Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="code" label="Kode" register={register("code")} error={errors.code?.message} placeholder="1000.01" />
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Tipe</label>
          <select className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" {...register("type")}>
            <option value="asset">Aset</option>
            <option value="liability">Kewajiban</option>
            <option value="equity">Ekuitas</option>
            <option value="revenue">Pendapatan</option>
            <option value="expense">Beban</option>
          </select>
          {errors.type && <p className="text-xs text-red-600">{errors.type.message}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Akun Induk (non-postable)</label>
          <Select className="w-full" {...register("parentId")}>
            <option value="">— Akun Akar —</option>
            {parentOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="isPostable" {...register("isPostable")} className="h-4 w-4 rounded border-zinc-300" />
          <label htmlFor="isPostable" className="text-sm font-medium">Dapat diposting (postable)</label>
        </div>
        <FormField name="description" label="Deskripsi" register={register("description")} error={errors.description?.message} />
        <Button type="submit">Simpan</Button>
      </form>
    </div>
  );
}
