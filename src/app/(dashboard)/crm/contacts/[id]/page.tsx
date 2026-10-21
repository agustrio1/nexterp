"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Contact = { id: string; accountId: string; accountName: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean; isActive: boolean };

export default function CrmContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/crm/contacts/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: Contact }) => {
        setContact(j.data);
        setName(j.data.name);
        setTitle(j.data.title ?? "");
        setEmail(j.data.email ?? "");
        setPhone(j.data.phone ?? "");
        setIsPrimary(j.data.isPrimary);
        setIsActive(j.data.isActive);
      })
      .catch(() => toast.error("Gagal memuat kontak."))
      .finally(() => setLoading(false));
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!contact) return;
    if (name.trim().length < 2) { toast.error("Nama kontak minimal 2 karakter."); return; }
    const body: Record<string, unknown> = { name: name.trim(), isPrimary, isActive, title: title || undefined, email: email || undefined, phone: phone || undefined };
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/contacts/${contact.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: Contact }; setContact(j.data); toast.success("Kontak diperbarui."); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!contact) return <p className="text-red-600">Kontak tidak ditemukan.</p>;

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/contacts"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{contact.name}</h1>
        {contact.isPrimary && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">Utama</span>}
        {!contact.isActive && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">Nonaktif</span>}
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <span className="font-medium text-zinc-500">Akun:</span>{" "}
        <Link className="text-blue-600 hover:underline" href={`/crm/accounts/${contact.accountId}`}>{contact.accountName}</Link>
      </div>

      <form onSubmit={onSave} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">Ubah Kontak</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Jabatan</label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Telepon</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Kontak utama</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label>
        </div>
        <div><Button type="submit" loading={saving}>Simpan Perubahan</Button></div>
      </form>
    </div>
  );
}
