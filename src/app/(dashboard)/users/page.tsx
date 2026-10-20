"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Search, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DialogConfirm } from "@/components/ui/dialog-confirm";

type User = { id: string; name: string; email: string; status: string; createdAt: string };

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  const qs = params.toString();
  const url = qs ? `/api/users?${qs}` : "/api/users";
  const fetchUrl = `${url}${url.includes("?") ? "&" : "?"}_r=${refreshKey}`;

  async function toggleStatus(user: User) {
    const newStatus = user.status === "active" ? "suspended" : "active";
    const res = await fetch(`/api/users/${user.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
      credentials: "same-origin",
    });
    if (res.ok) {
      toast.success(`Status diubah ke ${newStatus}.`);
      setRefreshKey((k) => k + 1);
    } else {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      toast.error(body?.error?.message ?? "Gagal mengubah status.");
    }
  }

  const columns: Column<User>[] = [
    { header: "Nama", cell: (u) => <span className="font-medium">{u.name}</span> },
    { header: "Email", cell: (u) => u.email },
    {
      header: "Status",
      cell: (u) => (
        <span
          className={
            u.status === "active"
              ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300"
              : "rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
          }
        >
          {u.status}
        </span>
      ),
    },
    { header: "Dibuat", cell: (u) => new Date(u.createdAt).toLocaleDateString("id-ID") },
    {
      header: "Aksi",
      className: "w-[180px]",
      cell: (u) => (
        <div className="flex gap-1">
          <Link href={`/users/${u.id}`}>
            <Button variant="ghost" size="sm">Edit</Button>
          </Link>
          <DialogConfirm
            trigger={
              <Button variant="ghost" size="sm">
                {u.status === "active" ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
              </Button>
            }
            title={u.status === "active" ? "Suspend pengguna?" : "Aktifkan pengguna?"}
            description={`${u.name} (${u.email})`}
            destructive={u.status === "active"}
            onConfirm={() => toggleStatus(u)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pengguna</h1>
        <Link href="/users/new">
          <Button size="sm"><Plus className="h-4 w-4" /> Tambah</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" aria-hidden />
          <Input
            placeholder="Cari nama atau email…"
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") setRefreshKey((k) => k + 1); }}
            onBlur={() => setRefreshKey((k) => k + 1)}
          />
        </div>
        <Select
          className="w-36"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setRefreshKey((k) => k + 1); }}
        >
          <option value="">Semua status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      <DataTable<User>
        key={refreshKey}
        url={fetchUrl}
        columns={columns}
        rowKey={(u) => u.id}
        emptyMessage="Belum ada pengguna."
      />
    </div>
  );
}
