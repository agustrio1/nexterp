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
  baseUnitId: z.string().min(1),
  categoryId: z.string().optional(),
  canPurchase: z.boolean(),
  canSell: z.boolean(),
  isActive: z.boolean(),
  reorderPoint: z.string().optional(),
  description: z.string().trim().max(500).optional(),
});
type FormValues = z.input<typeof schema>;
type Option = { id: string; name: string };

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [sku, setSku] = useState("");
  const [units, setUnits] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    fetch("/api/units?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setUnits(j.data)).catch(() => {});
    fetch("/api/product-categories?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setCategories(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/products/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: { sku: string; name: string; baseUnitId: string; categoryId: string | null; canPurchase: boolean; canSell: boolean; isActive: boolean; reorderPoint: string | null; description: string | null } }) => {
        setSku(json.data.sku);
        reset({ name: json.data.name, baseUnitId: json.data.baseUnitId, categoryId: json.data.categoryId ?? "", canPurchase: json.data.canPurchase, canSell: json.data.canSell, isActive: json.data.isActive, reorderPoint: json.data.reorderPoint ?? "", description: json.data.description ?? "" });
      })
      .catch(() => toast.error("Gagal memuat produk."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: FormValues) {
    const body: Record<string, unknown> = { name: values.name, baseUnitId: values.baseUnitId, canPurchase: values.canPurchase, canSell: values.canSell, isActive: values.isActive };
    if (values.categoryId) body.categoryId = values.categoryId; else body.categoryId = null;
    if (values.reorderPoint) body.reorderPoint = values.reorderPoint;
    if (values.description) body.description = values.description;
    const res = await fetch(`/api/products/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    if (res.ok) toast.success("Produk diperbarui.");
    else { const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e?.error?.message ?? "Gagal."); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/products"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Edit: <code className="text-base">{sku}</code></h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Satuan Dasar</label>
          <Select className="w-full" {...register("baseUnitId")}>{units.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Kategori</label>
          <Select className="w-full" {...register("categoryId")}><option value="">— Tanpa —</option>{categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</Select>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2"><input type="checkbox" id="canPurchase" {...register("canPurchase")} className="h-4 w-4" /><label htmlFor="canPurchase" className="text-sm">Beli</label></div>
          <div className="flex items-center gap-2"><input type="checkbox" id="canSell" {...register("canSell")} className="h-4 w-4" /><label htmlFor="canSell" className="text-sm">Jual</label></div>
          <div className="flex items-center gap-2"><input type="checkbox" id="isActive" {...register("isActive")} className="h-4 w-4" /><label htmlFor="isActive" className="text-sm">Aktif</label></div>
        </div>
        <FormField name="reorderPoint" label="Reorder Point" register={register("reorderPoint")} error={errors.reorderPoint?.message} />
        <FormField name="description" label="Deskripsi" register={register("description")} error={errors.description?.message} />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
