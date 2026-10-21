"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Segment = { id: string; name: string; description: string | null; criteria: unknown; isActive: boolean };
type Account = { id: string; name: string };

export default function CrmSegmentsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [assignSegment, setAssignSegment] = useState("");
  const [assignAccount, setAssignAccount] = useState("");
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/crm/accounts?isActive=true", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/crm/segments", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
    ])
      .then(([a, s]: [{ data: Account[] }, { data: Segment[] }]) => { setAccounts(a.data); setSegments(s.data); })
      .catch(() => {});
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) { toast.error("Nama segmen minimal 2 karakter."); return; }
    let parsedCriteria: unknown;
    if (criteria.trim()) {
      try { parsedCriteria = JSON.parse(criteria); }
      catch { toast.error("Kriteria harus berupa JSON yang valid."); return; }
    }
    const body: Record<string, unknown> = { name: name.trim() };
    if (description) body.description = description;
    if (criteria.trim()) body.criteria = parsedCriteria;
    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/segments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Segmen dibuat."); setName(""); setDescription(""); setCriteria(""); setRefreshKey((k) => k + 1); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSubmitting(false); }
  }

  async function onAssign(action: "assign" | "unassign") {
    if (!assignSegment || !assignAccount) { toast.error("Pilih segmen dan akun."); return; }
    setAssigning(true);
    try {
      const res = await fetch(`/api/crm/segments/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segmentId: assignSegment, accountId: assignAccount }), credentials: "same-origin" });
      if (res.ok) toast.success(action === "assign" ? "Akun ditambahkan ke segmen." : "Akun dikeluarkan dari segmen.");
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setAssigning(false); }
  }

  const columns: Column<Segment>[] = [
    { header: "Nama", cell: (r) => r.name },
    { header: "Deskripsi", cell: (r) => r.description ?? "—" },
    { header: "Kriteria", cell: (r) => <code className="text-xs text-zinc-500">{r.criteria ? JSON.stringify(r.criteria) : "—"}</code> },
    { header: "Status", cell: (r) => r.isActive ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">Aktif</span> : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">Nonaktif</span> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Segmen</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Deskripsi</label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Kriteria (JSON)</label><Input value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder='{"type":"customer"}' /></div>
        <div className="sm:col-span-4"><Button type="submit" loading={submitting}>Simpan Segmen</Button></div>
      </form>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Segmen</label>
          <Select className="w-full" value={assignSegment} onChange={(e) => setAssignSegment(e.target.value)}>
            <option value="">— Pilih segmen —</option>
            {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Akun</label>
          <Select className="w-full" value={assignAccount} onChange={(e) => setAssignAccount(e.target.value)}>
            <option value="">— Pilih akun —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
        <div className="flex items-end"><Button variant="outline" size="sm" disabled={assigning} onClick={() => void onAssign("assign")}>Masukkan</Button></div>
        <div className="flex items-end"><Button variant="destructive" size="sm" disabled={assigning} onClick={() => void onAssign("unassign")}>Keluarkan</Button></div>
      </div>

      <DataTable<Segment> key={refreshKey} url="/api/crm/segments" columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada segmen." />
    </div>
  );
}
