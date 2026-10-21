"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type User = { id: string; name: string };

export default function NewCrmLeadPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/users?status=active&limit=100", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: User[] }) => setUsers(j.data))
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) { toast.error("Nama lead minimal 2 karakter."); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Format email tidak valid."); return; }

    const body: Record<string, unknown> = { name: name.trim() };
    if (source) body.source = source;
    if (contactName) body.contactName = contactName;
    if (email) body.email = email;
    if (phone) body.phone = phone;
    if (company) body.company = company;
    if (assignedTo) body.assignedTo = assignedTo;
    if (notes) body.notes = notes;

    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Lead dibuat."); router.push(`/crm/leads/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/leads"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Lead Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2"><label className="text-sm font-medium">Nama Lead *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Sumber</label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Website, Referral…" /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Nama Kontak</label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Telepon</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><label className="text-sm font-medium">Perusahaan</label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Ditagihkan</label>
            <Select className="w-full" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">— Tidak ditagihkan —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div><Button type="submit" loading={submitting}>Simpan Lead</Button></div>
      </form>
    </div>
  );
}
