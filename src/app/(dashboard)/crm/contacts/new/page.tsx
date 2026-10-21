"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Account = { id: string; code: string; name: string };

export default function NewCrmContactPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/crm/accounts?isActive=true", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: Account[] }) => {
        setAccounts(j.data);
        const preset = new URLSearchParams(window.location.search).get("accountId");
        if (preset && j.data.some((a) => a.id === preset)) setAccountId(preset);
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) { toast.error("Pilih akun."); return; }
    if (name.trim().length < 2) { toast.error("Nama kontak minimal 2 karakter."); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Format email tidak valid."); return; }

    const body: Record<string, unknown> = { accountId, name: name.trim(), isPrimary };
    if (title) body.title = title;
    if (email) body.email = email;
    if (phone) body.phone = phone;

    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Kontak dibuat."); router.push(`/crm/contacts/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/contacts"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Kontak Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5"><label className="text-sm font-medium">Akun *</label>
          <Select className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">— Pilih —</option>{accounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}</Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Jabatan</label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Telepon</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Kontak utama akun</label>
        <div><Button type="submit" loading={submitting}>Simpan Kontak</Button></div>
      </form>
    </div>
  );
}
