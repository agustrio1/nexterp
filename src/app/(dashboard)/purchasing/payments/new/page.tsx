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
  supplierId: z.string().min(1, "Pemasok wajib dipilih."),
  branchId: z.string().min(1, "Cabang wajib dipilih."),
  paymentDate: z.string().min(1, "Tanggal wajib diisi."),
  currency: z.string().trim().max(3).optional(),
  amountForeign: z.string().trim().min(1, "Jumlah wajib diisi."),
  bankAccountId: z.string().min(1, "Rekening bank wajib dipilih."),
  memo: z.string().trim().max(500).optional(),
});
type FormValues = z.input<typeof schema>;

type Option = { id: string; code?: string; name: string };

export default function NewPaymentPage() {
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } =
    useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { paymentDate: new Date().toISOString().slice(0, 10) } });

  const submit = useFormSubmit<FormValues>({
    url: "/api/purchasing/payments", redirectTo: "/purchasing/payments",
    successMessage: "Pembayaran AP dibuat.", setError,
  });

  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [banks, setBanks] = useState<Option[]>([]);

  useEffect(() => {
    fetch("/api/purchasing/suppliers?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setSuppliers(j.data)).catch(() => {});
    fetch("/api/branches?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setBranches(j.data)).catch(() => {});
    fetch("/api/bank-accounts?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }).then((j: { data: Option[] }) => setBanks(j.data)).catch(() => {});
  }, []);

  function onSubmit(values: FormValues) {
    const body: Record<string, unknown> = { supplierId: values.supplierId, branchId: values.branchId, paymentDate: values.paymentDate, amountForeign: values.amountForeign, bankAccountId: values.bankAccountId };
    if (values.currency) body.currency = values.currency;
    if (values.memo) body.memo = values.memo;
    return submit(body);
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/purchasing/payments"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Pembayaran AP Baru</h1>
      </div>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Pemasok *</label>
          <Select className="w-full" {...register("supplierId")}>
            <option value="">— Pilih —</option>
            {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.code} — {s.name}</option>))}
          </Select>
          {errors.supplierId && <p className="text-xs text-red-600">{errors.supplierId.message}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Cabang *</label>
          <Select className="w-full" {...register("branchId")}>
            <option value="">— Pilih —</option>
            {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
          </Select>
          {errors.branchId && <p className="text-xs text-red-600">{errors.branchId.message}</p>}
        </div>
        <FormField name="paymentDate" label="Tanggal Pembayaran" type="date" register={register("paymentDate")} error={errors.paymentDate?.message} />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Rekening Bank *</label>
          <Select className="w-full" {...register("bankAccountId")}>
            <option value="">— Pilih —</option>
            {banks.map((b) => (<option key={b.id} value={b.id}>{b.code} — {b.name}</option>))}
          </Select>
          {errors.bankAccountId && <p className="text-xs text-red-600">{errors.bankAccountId.message}</p>}
        </div>
        <FormField name="currency" label="Mata Uang" register={register("currency")} error={errors.currency?.message} placeholder="Default pemasok" />
        <FormField name="amountForeign" label="Jumlah (Mata Uang)" register={register("amountForeign")} error={errors.amountForeign?.message} placeholder="0.00" />
        <FormField name="memo" label="Memo" register={register("memo")} error={errors.memo?.message} />
        <p className="text-xs text-zinc-500">Saat diposting, pembayaran dialokasikan FIFO ke invoice terbuka menurut tanggal jatuh tempo.</p>
        <Button type="submit" loading={isSubmitting}>Simpan Draf</Button>
      </form>
    </div>
  );
}
