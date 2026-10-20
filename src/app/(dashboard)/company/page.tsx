"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { useFormSubmit } from "@/hooks/use-form-submit";

const schema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).optional(),
  taxId: z.string().trim().max(20).optional(),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(100).optional(),
  province: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(5).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(254).optional(),
  website: z.string().trim().max(200).optional(),
});
type FormValues = z.input<typeof schema>;

export default function CompanyPage() {
  const [loading, setLoading] = useState(true);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });

  const submit = useFormSubmit<FormValues>({
    url: "/api/company", method: "PUT", successMessage: "Profil perusahaan disimpan.", setError,
  });

  useEffect(() => {
    fetch("/api/company", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: Record<string, string | null> }) => {
        const d = json.data;
        reset({
          legalName: d.legalName ?? "", tradeName: d.tradeName ?? "",
          taxId: d.taxId ?? "", address: d.address ?? "",
          city: d.city ?? "", province: d.province ?? "",
          postalCode: d.postalCode ?? "", phone: d.phone ?? "",
          email: d.email ?? "", website: d.website ?? "",
        });
      })
      .catch(() => toast.error("Belum ada profil perusahaan."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Profil Perusahaan</h1>
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
        <FormField name="legalName" label="Nama Resmi" required register={register("legalName")} error={errors.legalName?.message} />
        <FormField name="tradeName" label="Nama Dagang" register={register("tradeName")} error={errors.tradeName?.message} />
        <FormField name="taxId" label="NPWP" register={register("taxId")} error={errors.taxId?.message} placeholder="02.345.678.9-012.300" />
        <FormField name="address" label="Alamat" register={register("address")} error={errors.address?.message} />
        <div className="grid grid-cols-2 gap-4">
          <FormField name="city" label="Kota" register={register("city")} error={errors.city?.message} />
          <FormField name="province" label="Provinsi" register={register("province")} error={errors.province?.message} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField name="postalCode" label="Kode Pos" register={register("postalCode")} error={errors.postalCode?.message} />
          <FormField name="phone" label="Telepon" register={register("phone")} error={errors.phone?.message} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField name="email" label="Email" register={register("email")} error={errors.email?.message} />
          <FormField name="website" label="Website" register={register("website")} error={errors.website?.message} />
        </div>
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
