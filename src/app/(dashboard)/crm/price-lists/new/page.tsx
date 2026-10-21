"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function NewPriceListPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 2) { toast.error("Kode daftar harga minimal 2 karakter."); return; }
    if (name.trim().length < 2) { toast.error("Nama daftar harga minimal 2 karakter."); return; }
    if (!validFrom) { toast.error("Tanggal mulai wajib diisi."); return; }

    const body: Record<string, unknown> = { code: code.trim().toUpperCase(), name: name.trim(), validFrom };
    if (validTo) body.validTo = validTo;

    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/price-lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Daftar harga dibuat."); router.push(`/crm/price-lists/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/price-lists"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Daftar Harga Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="HARGA1" /></div>
          <div className="space-y-1.5 sm:col-span-2"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Berlaku Dari *</label><Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Sampai</label><Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></div>
        </div>
        <div><Button type="submit" loading={submitting}>Simpan Daftar Harga</Button></div>
      </form>
    </div>
  );
}
