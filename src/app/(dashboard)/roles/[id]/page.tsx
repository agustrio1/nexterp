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
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
});
type EditForm = z.input<typeof editSchema>;

export default function EditRolePage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<{ code: string; name: string; description: string | null; permissions: string[] } | null>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<EditForm>({ resolver: zodResolver(editSchema) });

  useEffect(() => {
    if (!id) return;
    fetch(`/api/roles/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: { code: string; name: string; description: string | null; permissions: string[] } }) => {
        setRole(json.data);
        reset({ name: json.data.name, description: json.data.description ?? "" });
      })
      .catch(() => toast.error("Gagal memuat role."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: EditForm) {
    const res = await fetch(`/api/roles/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values), credentials: "same-origin",
    });
    if (res.ok) toast.success("Role diperbarui.");
    else toast.error("Gagal memperbarui.");
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!role) return <p className="text-sm text-zinc-500">Role tidak ditemukan.</p>;

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/roles"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Edit: <code className="text-base">{role.code}</code></h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormField name="name" label="Nama" register={register("name")} error={errors.name?.message} />
        <FormField name="description" label="Deskripsi" register={register("description")} error={errors.description?.message} />
        <Button type="submit" loading={isSubmitting}>Simpan</Button>
      </form>
      <div>
        <h2 className="text-lg font-medium mb-2">Permissions ({role.permissions.length})</h2>
        <div className="max-h-60 overflow-y-auto rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          {role.permissions.length === 0 ? (
            <p className="text-sm text-zinc-400">Belum ada permission.</p>
          ) : (
            <ul className="space-y-1 text-xs font-mono">
              {role.permissions.map((p) => <li key={p} className="text-zinc-600 dark:text-zinc-400">{p}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
