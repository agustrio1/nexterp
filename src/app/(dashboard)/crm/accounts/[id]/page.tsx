"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Account = { id: string; code: string; name: string; type: string; taxId: string | null; address: string | null; city: string | null; province: string | null; country: string | null; phone: string | null; email: string | null; website: string | null; notes: string | null; isActive: boolean };
type Contact = { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean; isActive: boolean };

export default function CrmAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/crm/accounts/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: Account }) => {
        setAccount(j.data);
        setName(j.data.name);
        setType(j.data.type);
        setTaxId(j.data.taxId ?? "");
        setAddress(j.data.address ?? "");
        setCity(j.data.city ?? "");
        setProvince(j.data.province ?? "");
        setCountry(j.data.country ?? "");
        setPhone(j.data.phone ?? "");
        setEmail(j.data.email ?? "");
        setWebsite(j.data.website ?? "");
        setNotes(j.data.notes ?? "");
        setIsActive(j.data.isActive);
      })
      .catch(() => toast.error("Gagal memuat akun."))
      .finally(() => setLoading(false));
    fetch(`/api/crm/contacts?accountId=${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: Contact[] }) => setContacts(j.data))
      .catch(() => {});
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    if (name.trim().length < 2) { toast.error("Nama akun minimal 2 karakter."); return; }
    const body: Record<string, unknown> = {
      name: name.trim(), type, isActive,
      taxId: taxId || undefined, address: address || undefined, city: city || undefined,
      province: province || undefined, country: country || undefined, phone: phone || undefined,
      email: email || undefined, website: website || undefined, notes: notes || undefined,
    };
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/accounts/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: Account }; setAccount(j.data); toast.success("Akun diperbarui."); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!account) return <p className="text-red-600">Akun tidak ditemukan.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/accounts"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold"><code className="font-mono text-lg">{account.code}</code> — {account.name}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{account.type}</span>
        {!account.isActive && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">Nonaktif</span>}
      </div>

      <form onSubmit={onSave} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">Ubah Akun</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Tipe</label>
            <Select className="w-full" value={type} onChange={(e) => setType(e.target.value)}><option value="prospect">Prospect</option><option value="customer">Customer</option><option value="partner">Partner</option></Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">NPWP</label><Input value={taxId} onChange={(e) => setTaxId(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Telepon</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Website</label><Input value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Kota</label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Provinsi</label><Input value={province} onChange={(e) => setProvince(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Negara</label><Input value={country} onChange={(e) => setCountry(e.target.value)} /></div>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Alamat</label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label>
        <div><Button type="submit" loading={saving}>Simpan Perubahan</Button></div>
      </form>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Kontak</h2>
          <Link href={`/crm/contacts/new?accountId=${account.id}`}><Button size="sm" variant="outline"><Plus className="h-4 w-4" /> Kontak Baru</Button></Link>
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">Nama</th><th className="px-3 py-2 text-left">Jabatan</th><th className="px-3 py-2 text-left">Email</th><th className="px-3 py-2 text-left">Telepon</th><th className="px-3 py-2 text-left">Utama</th><th className="px-3 py-2 text-left">Aksi</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.name}{!c.isActive && <span className="ml-2 text-xs text-zinc-400">(nonaktif)</span>}</td>
                  <td className="px-3 py-2">{c.title ?? "—"}</td>
                  <td className="px-3 py-2">{c.email ?? "—"}</td>
                  <td className="px-3 py-2">{c.phone ?? "—"}</td>
                  <td className="px-3 py-2">{c.isPrimary ? "✓" : "—"}</td>
                  <td className="px-3 py-2"><Link className="text-blue-600 hover:underline" href={`/crm/contacts/${c.id}`}>Detail</Link></td>
                </tr>
              ))}
              {contacts.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">Belum ada kontak.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
