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
  sku: z.string().trim().min(1, "SKU wajib diisi.").max(50),
  name: z.string().trim().min(2, "Minimal 2 karakter.").max(150),
  baseUnitId: z.string().min(1, "Satuan wajib dipilih."),
  categoryId: z.string().optional(),
  canPurchase: z.boolean(),
  canSell: z.boolean(),
  reorderPoint: z.string().optional(),
  description: z.string().trim().max(500).optional(),
});
type FormValues = z.input<typeof schema>;

type Option = { id: string; code?: string; name: string };

export default function NewProductPage() {
  const { register, handleSubmit, formState: { errors }, setError } =
    useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { canPurchase: true, canSell: true } });

  const submit = useFormSubmit<FormValues>({
    url: "/api/products", redirectTo: "/products",
    successMessage: "Produk dibuat.", setError,
  });

  const [units, setUnits] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);

  useEffect(() => {
    fetch("/api/units?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setUnits(j.data)).catch(() => {});
    fetch("/api/product-categories?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setCategories(j.data)).catch(() => {});
  }, []);

  function onSubmit(values: FormValues) {
    const body: Record<string, unknown> = { sku: values.sku, name: values.name, baseUnitId: values.baseUnitId, canPurchase: values.canPurchase, canSell: values.canSell };
    if (values.categoryId) body.categoryId = values.categoryId;
    if (values.reorderPoint) body.reorderPoint = values.reorderPoint;
    if (values.description) body.description = values.description;
    return submit(body);
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/products"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Produk Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="sku" label="SKU" register={register("sku")} error={errors.sku?.message} />
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Satuan Dasar *</label>
          <Select className="w-full" {...register("baseUnitId")}>
            <option value="">— Pilih —</option>
            {units.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
          </Select>
          {errors.baseUnitId && <p className="text-xs text-red-600">{errors.baseUnitId.message}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Kategori</label>
          <Select className="w-full" {...register("categoryId")}>
            <option value="">— Tanpa Kategori —</option>
            {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </Select>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2"><input type="checkbox" id="canPurchase" {...register("canPurchase")} className="h-4 w-4" /><label htmlFor="canPurchase" className="text-sm">Dapat dibeli</label></div>
          <div className="flex items-center gap-2"><input type="checkbox" id="canSell" {...register("canSell")} className="h-4 w-4" /><label htmlFor="canSell" className="text-sm">Dapat dijual</label></div>
        </div>
        <FormField name="reorderPoint" label="Reorder Point" register={register("reorderPoint")} error={errors.reorderPoint?.message} placeholder="Opsional" />
        <FormField name="description" label="Deskripsi" register={register("description")} error={errors.description?.message} />
        <Button type="submit">Simpan</Button>
      </form>
    </div>
  );
}
