"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export default function NewCrmAccountPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("prospect");
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [country, setCountry] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 2) { toast.error("Kode akun minimal 2 karakter."); return; }
    if (name.trim().length < 2) { toast.error("Nama akun minimal 2 karakter."); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Format email tidak valid."); return; }

    const body: Record<string, unknown> = { code: code.trim().toUpperCase(), name: name.trim(), type };
    if (taxId) body.taxId = taxId;
    if (address) body.address = address;
    if (city) body.city = city;
    if (province) body.province = province;
    if (country) body.country = country;
    if (phone) body.phone = phone;
    if (email) body.email = email;
    if (website) body.website = website;
    if (notes) body.notes = notes;

    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Akun dibuat."); router.push(`/crm/accounts/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/accounts"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Akun CRM Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PTMAJU" /></div>
          <div className="space-y-1.5 sm:col-span-2"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tipe</label>
            <Select className="w-full" value={type} onChange={(e) => setType(e.target.value)}><option value="prospect">Prospect</option><option value="customer">Customer</option><option value="partner">Partner</option></Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">NPWP</label><Input value={taxId} onChange={(e) => setTaxId(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Telepon</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Website</label><Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Kota</label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Provinsi</label><Input value={province} onChange={(e) => setProvince(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Negara</label><Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Indonesia" /></div>
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Alamat</label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div><Button type="submit" loading={submitting}>Simpan Akun</Button></div>
      </form>
    </div>
  );
}
