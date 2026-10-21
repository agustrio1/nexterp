"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Account = { id: string; name: string };
type Stage = { id: string; name: string };
type User = { id: string; name: string };

export default function NewOpportunityPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [accountId, setAccountId] = useState("");
  const [stageId, setStageId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [probability, setProbability] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/crm/accounts?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/crm/pipeline-stages", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/users?status=active&limit=100", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
    ])
      .then(([a, s, u]: [{ data: Account[] }, { data: Stage[] }, { data: User[] }]) => {
        setAccounts(a.data);
        setStages(s.data);
        setUsers(u.data);
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) { toast.error("Pilih akun."); return; }
    if (!stageId) { toast.error("Pilih tahap pipeline."); return; }
    if (title.trim().length < 2) { toast.error("Judul peluang minimal 2 karakter."); return; }
    if (amount && !/^\d{1,14}(\.\d{1,2})?$/.test(amount.trim())) { toast.error("Nominal maksimal 14 digit + 2 desimal."); return; }
    if (currency && !/^[A-Za-z]{3}$/.test(currency.trim())) { toast.error("Kode mata uang harus 3 huruf."); return; }
    if (probability && !/^\d{1,3}(\.\d{1,2})?$/.test(probability.trim())) { toast.error("Probabilitas 0-100."); return; }

    const body: Record<string, unknown> = { accountId, stageId, title: title.trim() };
    if (amount) body.amount = amount.trim();
    if (currency) body.currency = currency.trim().toUpperCase();
    if (expectedCloseDate) body.expectedCloseDate = expectedCloseDate;
    if (assignedTo) body.assignedTo = assignedTo;
    if (probability) body.probability = probability.trim();

    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/opportunities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: { id: string } }; toast.success("Peluang dibuat."); router.push(`/crm/opportunities/${j.data.id}`); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/opportunities"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Peluang Baru</h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-sm font-medium">Akun *</label>
            <Select className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— Pilih akun —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tahap *</label>
            <Select className="w-full" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">— Pilih tahap —</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Probabilitas %</label><Input value={probability} onChange={(e) => setProbability(e.target.value)} placeholder="0-100" /></div>
          <div className="space-y-1.5 sm:col-span-3"><label className="text-sm font-medium">Judul *</label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Nominal</label><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Mata Uang</label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="IDR" maxLength={3} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Est. Close</label><Input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><label className="text-sm font-medium">Ditagihkan</label>
            <Select className="w-full" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">— Tidak ditagihkan —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
        </div>
        <div><Button type="submit" loading={submitting}>Simpan Peluang</Button></div>
      </form>
    </div>
  );
}
