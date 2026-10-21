"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Task = { id: string; title: string; accountName: string | null; dueDate: string | null; status: string; assignedToName: string | null; isCompleted: boolean };
type Account = { id: string; name: string };
type User = { id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  pending: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  completed: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  overdue: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export default function CrmTasksPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filterStatus, setFilterStatus] = useState("");

  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
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

  const url = filterStatus ? `/api/crm/tasks?status=${filterStatus}` : "/api/crm/tasks";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 1) { toast.error("Judul wajib diisi."); return; }
    const body: Record<string, unknown> = { title: title.trim() };
    if (accountId) body.accountId = accountId;
    if (description) body.description = description;
    if (dueDate) body.dueDate = dueDate;
    if (assignedTo) body.assignedTo = assignedTo;
    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Tugas dibuat."); setTitle(""); setDescription(""); setDueDate(""); setRefreshKey((k) => k + 1); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  async function onComplete(id: string) {
    const res = await fetch(`/api/crm/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isCompleted: true }), credentials: "same-origin" });
    if (res.ok) { toast.success("Tugas diselesaikan."); setRefreshKey((k) => k + 1); }
    else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
  }

  const columns: Column<Task>[] = [
    { header: "Jatuh Tempo", cell: (r) => r.dueDate ? r.dueDate.slice(0, 10) : "—" },
    { header: "Judul", cell: (r) => r.title },
    { header: "Akun", cell: (r) => r.accountName ?? "—" },
    { header: "Ditagihkan", cell: (r) => r.assignedToName ?? "—" },
    { header: "Status", cell: (r) => <span className={STATUS_STYLE[r.status] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{r.status}</span> },
    { header: "Aksi", className: "w-[110px]", cell: (r) => !r.isCompleted && <Button size="sm" variant="outline" onClick={() => void onComplete(r.id)}>Selesaikan</Button> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Tugas</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Judul *</label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Akun</label>
          <Select className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— Tanpa akun —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Jatuh Tempo</label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Deskripsi</label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Ditagihkan</label>
          <Select className="w-full" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">—</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </div>
        <div className="flex items-end"><Button type="submit" loading={submitting}>Simpan Tugas</Button></div>
      </form>

      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-500">Filter status:</span>
        <Select className="w-48" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </Select>
      </div>
      <DataTable<Task> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada tugas." />
    </div>
  );
}
