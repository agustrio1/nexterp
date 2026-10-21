"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";

type Evaluation = {
  id: string; employeeId: string; periodLabel: string; reviewerId: string | null;
  score: string | null; rating: string | null; status: string; notes: string | null;
};
type User = { id: string; name: string };

const STATUS_LABEL: Record<string, string> = { draft: "Draf", reviewed: "Ditinjau", finalized: "Final" };
const DECIMAL_RE = /^\d{1,12}(\.\d{1,2})?$/;

export default function HREvaluationsPage() {
  const refs = useHrRefs();
  const [fEmp, setFEmp] = useState("");
  const [rk, setRk] = useState(0);
  const [users, setUsers] = useState<User[]>([]);

  const [emp, setEmp] = useState("");
  const [period, setPeriod] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [score, setScore] = useState("");
  const [rating, setRating] = useState("");
  const [status, setStatus] = useState("draft");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editReviewer, setEditReviewer] = useState("");
  const [editScore, setEditScore] = useState("");
  const [editRating, setEditRating] = useState("");
  const [editStatus, setEditStatus] = useState("draft");
  const [editNotes, setEditNotes] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch("/api/users?status=active&limit=100", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: User[] }) => setUsers(j.data))
      .catch(() => {});
  }, []);

  const params = new URLSearchParams();
  if (fEmp) params.set("employeeId", fEmp);
  const qs = params.toString();
  const url = qs ? `/api/hr/evaluations?${qs}` : "/api/hr/evaluations";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) { toast.error("Pilih karyawan."); return; }
    if (!period.trim()) { toast.error("Periode wajib diisi (maks 50 karakter)."); return; }
    if (score && !DECIMAL_RE.test(score)) { toast.error("Skor desimal maks 2 angka di koma."); return; }
    setSaving(true);
    const body: Record<string, unknown> = { employeeId: emp, periodLabel: period.trim(), status };
    if (reviewer) body.reviewerId = reviewer;
    if (score) body.score = score;
    if (rating.trim()) body.rating = rating.trim();
    if (notes.trim()) body.notes = notes.trim();
    try {
      const res = await fetch("/api/hr/evaluations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Evaluasi dibuat."); setPeriod(""); setScore(""); setRating(""); setNotes(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat evaluasi.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  function startEdit(v: Evaluation) {
    setEditId(v.id); setEditReviewer(v.reviewerId ?? ""); setEditScore(v.score ?? "");
    setEditRating(v.rating ?? ""); setEditStatus(v.status); setEditNotes(v.notes ?? "");
  }

  async function onEdit() {
    if (!editId) return;
    if (editScore && !DECIMAL_RE.test(editScore)) { toast.error("Skor desimal tidak valid."); return; }
    const body: Record<string, unknown> = { status: editStatus };
    body.reviewerId = editReviewer || null;
    body.score = editScore || null;
    body.rating = editRating.trim() || null;
    body.notes = editNotes.trim() || null;
    setEditing(true);
    try {
      const res = await fetch(`/api/hr/evaluations/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Evaluasi diperbarui."); setEditId(null); setRk((k) => k + 1); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  const columns: Column<Evaluation>[] = [
    {
      header: "Karyawan", cell: (r) => {
        const e = refs.empMap.get(r.employeeId);
        return e ? `${e.firstName} ${e.lastName ?? ""} (${e.code})` : "—";
      },
    },
    { header: "Periode", cell: (r) => r.periodLabel },
    { header: "Peninjau", cell: (r) => (r.reviewerId ? users.find((u) => u.id === r.reviewerId)?.name ?? "—" : "—") },
    { header: "Skor", cell: (r) => r.score ?? "—" },
    { header: "Peringkat", cell: (r) => r.rating ?? "—" },
    { header: "Status", cell: (r) => STATUS_LABEL[r.status] ?? r.status },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Ubah</Button> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Evaluasi Kinerja</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-6">
        <div className="space-y-1"><label className="text-sm font-medium">Karyawan *</label>
          <Select value={emp} onChange={(e) => setEmp(e.target.value)}>
            <option value="">— Pilih —</option>
            {refs.employees.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Periode *</label><Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-Q3" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Peninjau (user)</label>
          <Select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
            <option value="">— Belum ditentukan —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Skor</label><Input value={score} onChange={(e) => setScore(e.target.value)} placeholder="85.5" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Peringkat</label><Input value={rating} onChange={(e) => setRating(e.target.value)} placeholder="Baik" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Status</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-4"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex items-end sm:col-span-2"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      {editId && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-6">
          <div className="space-y-1"><label className="text-sm font-medium">Peninjau</label>
            <Select value={editReviewer} onChange={(e) => setEditReviewer(e.target.value)}>
              <option value="">— Belum ditentukan —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Skor</label><Input value={editScore} onChange={(e) => setEditScore(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Peringkat</label><Input value={editRating} onChange={(e) => setEditRating(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Status</label>
            <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Catatan</label><Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></div>
          <div className="col-span-2 flex gap-2 sm:col-span-6"><Button size="sm" loading={editing} onClick={onEdit}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
        </div>
      )}

      <div className="flex gap-2">
        <Select className="w-56" value={fEmp} onChange={(e) => { setFEmp(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Karyawan</option>
          {refs.employees.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
        </Select>
      </div>
      <DataTable<Evaluation> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada evaluasi." />
    </div>
  );
}
