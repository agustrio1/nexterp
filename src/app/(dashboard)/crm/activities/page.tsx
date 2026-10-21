"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Activity = { id: string; type: string; subject: string; accountName: string | null; activityDate: string; assignedToName: string | null; isCompleted: boolean };
type Account = { id: string; name: string };
type User = { id: string; name: string };

const TYPE_LABEL: Record<string, string> = { call: "Panggilan", email: "Email", meeting: "Rapat", task: "Tugas", other: "Lainnya" };

export default function CrmActivitiesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filterAccount, setFilterAccount] = useState("");

  const [accountId, setAccountId] = useState("");
  const [type, setType] = useState("call");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/crm/accounts?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/users?status=active&limit=100", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
    ])
      .then(([a, u]: [{ data: Account[] }, { data: User[] }]) => { setAccounts(a.data); setUsers(u.data); })
      .catch(() => {});
  }, []);

  const url = filterAccount ? `/api/crm/activities?accountId=${filterAccount}` : "/api/crm/activities";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (subject.trim().length < 1) { toast.error("Subjek wajib diisi."); return; }
    const body: Record<string, unknown> = { type, subject: subject.trim() };
    if (accountId) body.accountId = accountId;
    if (description) body.description = description;
    if (assignedTo) body.assignedTo = assignedTo;
    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Aktivitas dicatat."); setSubject(""); setDescription(""); setRefreshKey((k) => k + 1); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  async function onComplete(id: string) {
    const res = await fetch(`/api/crm/activities/${id}/complete`, { method: "POST", credentials: "same-origin" });
    if (res.ok) { toast.success("Aktivitas diselesaikan."); setRefreshKey((k) => k + 1); }
    else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
  }

  const columns: Column<Activity>[] = [
    { header: "Tanggal", cell: (r) => r.activityDate ? r.activityDate.slice(0, 16).replace("T", " ") : "—" },
    { header: "Tipe", cell: (r) => TYPE_LABEL[r.type] ?? r.type },
    { header: "Subjek", cell: (r) => r.subject },
    { header: "Akun", cell: (r) => r.accountName ?? "—" },
    { header: "Ditagihkan", cell: (r) => r.assignedToName ?? "—" },
    { header: "Status", cell: (r) => r.isCompleted ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">Selesai</span> : <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">Terbuka</span> },
    { header: "Aksi", className: "w-[110px]", cell: (r) => !r.isCompleted && <Button size="sm" variant="outline" onClick={() => void onComplete(r.id)}>Selesaikan</Button> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Aktivitas CRM</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Akun</label>
          <Select className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— Tanpa akun —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Tipe *</label>
          <Select className="w-full" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="call">Panggilan</option><option value="email">Email</option><option value="meeting">Rapat</option><option value="task">Tugas</option><option value="other">Lainnya</option>
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Subjek *</label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Deskripsi</label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Ditagihkan</label>
          <Select className="w-full" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">—</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </div>
        <div className="flex items-end"><Button type="submit" loading={submitting}>Catat Aktivitas</Button></div>
      </form>

      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-500">Filter akun:</span>
        <Select className="w-64" value={filterAccount} onChange={(e) => { setFilterAccount(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua akun</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </div>
      <DataTable<Activity> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada aktivitas." />
    </div>
  );
}
