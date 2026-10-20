"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const schema = z.object({
  name: z.string().trim().min(2).max(150),
  parentId: z.string().uuid().or(z.literal("")).optional(),
  isPostable: z.boolean(),
  isActive: z.boolean(),
  description: z.string().trim().max(500).optional(),
});
type FormValues = z.input<typeof schema>;

type AccountDetail = {
  id: string; code: string; name: string; type: string;
  isPostable: boolean; isActive: boolean; parentId: string | null;
  description: string | null;
};

type AccountOption = { id: string; code: string; name: string };

export default function EditAccountPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [parentOptions, setParentOptions] = useState<AccountOption[]>([]);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!id) return;
    fetch(`/api/chart-accounts/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: AccountDetail }) => {
        setAccount(json.data);
        reset({
          name: json.data.name,
          parentId: json.data.parentId ?? "",
          isPostable: json.data.isPostable,
          isActive: json.data.isActive,
          description: json.data.description ?? "",
        });
      })
      .catch(() => toast.error("Gagal memuat akun."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    fetch("/api/chart-accounts?isPostable=false", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((json: { data: AccountOption[] }) => setParentOptions(json.data.filter((a) => a.id !== id)))
      .catch(() => {});
  }, [id]);

  async function onSubmit(values: FormValues) {
    const body: Record<string, unknown> = {
      name: values.name,
      isPostable: values.isPostable,
      isActive: values.isActive,
    };
    if (values.parentId) body.parentId = values.parentId;
    else body.parentId = null;
    if (values.description) body.description = values.description;

    const res = await fetch(`/api/chart-accounts/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), credentials: "same-origin",
    });
    if (res.ok) toast.success("Akun diperbarui.");
    else {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      toast.error(err?.error?.message ?? "Gagal memperbarui.");
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!account) return <p className="text-red-600">Akun tidak ditemukan.</p>;

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/chart-of-accounts"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Edit: <code className="text-base">{account.code}</code></h1>
        <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{account.type}</span>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Akun Induk</label>
          <Select className="w-full" {...register("parentId")}>
            <option value="">— Akun Akar —</option>
            {parentOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isPostable" {...register("isPostable")} className="h-4 w-4 rounded border-zinc-300" />
            <label htmlFor="isPostable" className="text-sm">Postable</label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isActive" {...register("isActive")} className="h-4 w-4 rounded border-zinc-300" />
            <label htmlFor="isActive" className="text-sm">Aktif</label>
          </div>
        </div>
        <FormField name="description" label="Deskripsi" register={register("description")} error={errors.description?.message} />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
