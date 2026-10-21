"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Lead = { id: string; name: string; source: string | null; status: string; contactName: string | null; email: string | null; phone: string | null; company: string | null; assignedTo: string | null; assignedToName: string | null; notes: string | null; convertedAccountId: string | null; convertedContactId: string | null };
type User = { id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  new: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  contacted: "rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  qualified: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  discarded: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
  converted: "rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

export default function CrmLeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("new");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");

  const [accountCode, setAccountCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/crm/leads/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: Lead }) => {
        setLead(j.data);
        setName(j.data.name);
        setSource(j.data.source ?? "");
        setStatus(j.data.status);
        setContactName(j.data.contactName ?? "");
        setEmail(j.data.email ?? "");
        setPhone(j.data.phone ?? "");
        setCompany(j.data.company ?? "");
        setAssignedTo(j.data.assignedTo ?? "");
        setNotes(j.data.notes ?? "");
      })
      .catch(() => toast.error("Gagal memuat lead."))
      .finally(() => setLoading(false));
    fetch("/api/users?status=active&limit=100", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: User[] }) => setUsers(j.data))
      .catch(() => {});
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    if (name.trim().length < 2) { toast.error("Nama lead minimal 2 karakter."); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Format email tidak valid."); return; }
    const body: Record<string, unknown> = {
      name: name.trim(), status,
      source: source || undefined, contactName: contactName || undefined,
      email: email || undefined, phone: phone || undefined, company: company || undefined,
      assignedTo: assignedTo || undefined, notes: notes || undefined,
    };
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/leads/${lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: Lead }; setLead(j.data); toast.success("Lead diperbarui."); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onConvert(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    if (accountCode.trim().length < 2) { toast.error("Kode akun minimal 2 karakter."); return; }
    if (accountName.trim().length < 2) { toast.error("Nama akun minimal 2 karakter."); return; }
    if (cName.trim().length < 2) { toast.error("Nama kontak minimal 2 karakter."); return; }
    if (cEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cEmail)) { toast.error("Format email tidak valid."); return; }
    const body: Record<string, unknown> = {
      accountCode: accountCode.trim().toUpperCase(), accountName: accountName.trim(), contactName: cName.trim(),
      contactEmail: cEmail || undefined, contactPhone: cPhone || undefined,
    };
    setConverting(true);
    try {
      const res = await fetch(`/api/crm/leads/${lead.id}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) {
        const j = (await res.json()) as { data: { accountId: string } };
        toast.success("Lead dikonversi menjadi akun & kontak.");
        router.push(`/crm/accounts/${j.data.accountId}`);
      }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setConverting(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!lead) return <p className="text-red-600">Lead tidak ditemukan.</p>;

  const converted = lead.status === "converted";

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/leads"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{lead.name}</h1>
        <span className={STATUS_STYLE[lead.status] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{lead.status}</span>
      </div>

      {converted && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm dark:border-purple-900 dark:bg-purple-950/40">
          <p className="font-medium text-purple-800 dark:text-purple-200">Lead ini telah dikonversi.</p>
          <div className="mt-2 flex gap-4">
            {lead.convertedAccountId && <Link className="text-blue-600 hover:underline" href={`/crm/accounts/${lead.convertedAccountId}`}>Lihat Akun →</Link>}
            {lead.convertedContactId && <Link className="text-blue-600 hover:underline" href={`/crm/contacts/${lead.convertedContactId}`}>Lihat Kontak →</Link>}
          </div>
        </div>
      )}

      {!converted && (
        <form onSubmit={onSave} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Ubah Lead</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama Lead *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Status</label>
              <Select className="w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="discarded">Discarded</option>
              </Select>
            </div>
            <div className="space-y-1"><label className="text-sm font-medium">Sumber</label><Input value={source} onChange={(e) => setSource(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Nama Kontak</label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Telepon</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Perusahaan</label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Ditagihkan</label>
              <Select className="w-full" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">— Tidak ditagihkan —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </div>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div><Button type="submit" loading={saving}>Simpan Perubahan</Button></div>
        </form>
      )}

      {!converted && (
        <form onSubmit={onConvert} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h2 className="font-medium">Konversi Menjadi Akun & Kontak</h2>
            <p className="mt-1 text-sm text-zinc-500">Akan membuat akun CRM baru dan kontak utama, lalu menandai lead sebagai converted.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1"><label className="text-sm font-medium">Kode Akun *</label><Input value={accountCode} onChange={(e) => setAccountCode(e.target.value)} placeholder="PTMAJU" /></div>
            <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama Akun *</label><Input value={accountName} onChange={(e) => setAccountName(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Nama Kontak *</label><Input value={cName} onChange={(e) => setCName(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Email Kontak</label><Input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Telepon Kontak</label><Input value={cPhone} onChange={(e) => setCPhone(e.target.value)} /></div>
          </div>
          <div><Button type="submit" loading={converting} variant="outline">Konversi Lead</Button></div>
        </form>
      )}
    </div>
  );
}
