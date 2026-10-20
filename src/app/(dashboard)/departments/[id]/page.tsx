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
  parentId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
});
type FormValues = z.input<typeof schema>;

export default function EditDepartmentPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!id) return;
    fetch(`/api/departments/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: { code: string; name: string; parentId: string | null; branchId: string | null } }) => {
        setCode(json.data.code);
        reset({ name: json.data.name, parentId: json.data.parentId ?? "", branchId: json.data.branchId ?? "" });
      })
      .catch(() => toast.error("Gagal memuat departemen."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: FormValues) {
    const res = await fetch(`/api/departments/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values), credentials: "same-origin",
    });
    if (res.ok) toast.success("Departemen diperbarui.");
    else toast.error("Gagal memperbarui.");
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/departments"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Edit: <code className="text-base">{code}</code></h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <FormField name="parentId" label="ID Induk" register={register("parentId")} error={errors.parentId?.message} />
        <FormField name="branchId" label="ID Cabang" register={register("branchId")} error={errors.branchId?.message} />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
    </div>
  );
}
