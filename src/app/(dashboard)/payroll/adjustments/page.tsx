"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  fetchPeriods, fetchComponents, toMap, rp, AMOUNT_RE,
  COMPONENT_KIND_LABEL,
  type PeriodRef, type ComponentRef,
} from "@/app/(dashboard)/payroll/_shared";

type Adjustment = {
  id: string; employeeId: string; periodId: string | null; componentId: string | null;
  kind: string; amount: string; effectiveFrom: string; isActive: boolean; notes: string | null;
};

export default function PayrollAdjustmentsPage() {
  const refs = useHrRefs();
  const [periods, setPeriods] = useState<PeriodRef[]>([]);
  const [components, setComponents] = useState<ComponentRef[]>([]);

  const [fEmp, setFEmp] = useState("");
  const [fPeriod, setFPeriod] = useState("");
  const [rk, setRk] = useState(0);

  const [emp, setEmp] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [kind, setKind] = useState("earning");
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void fetchPeriods().then(setPeriods);
    void fetchComponents().then(setComponents);
  }, []);

  const periodMap = toMap(periods);
  const compMap = toMap(components);

  const params = new URLSearchParams();
  if (fEmp) params.set("employeeId", fEmp);
  if (fPeriod) params.set("periodId", fPeriod);
  const qs = params.toString();
  const url = qs ? `/api/payroll/adjustments?${qs}` : "/api/payroll/adjustments";

  function startEdit(a: Adjustment) {
    setEditId(a.id);
    setEditAmount(a.amount);
    setEditNotes(a.notes ?? "");
    setEditActive(a.isActive);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) { toast.error("Pilih karyawan."); return; }
    if (!AMOUNT_RE.test(amount)) { toast.error("Nominal tidak valid (maks 16 digit, 2 desimal)."); return; }
    if (!effectiveFrom) { toast.error("Tanggal berlaku wajib diisi."); return; }
    const body: Record<string, unknown> = { employeeId: emp, kind, amount, effectiveFrom };
    if (periodId) body.periodId = periodId;
    if (componentId) body.componentId = componentId;
    if (notes.trim()) body.notes = notes.trim();
    setSaving(true);
    try {
      const res = await fetch("/api/payroll/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Penyesuaian dibuat."); setPeriodId(""); setComponentId(""); setAmount(""); setEffectiveFrom(""); setNotes(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat penyesuaian.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onEdit() {
    if (!editId) return;
    if (!AMOUNT_RE.test(editAmount)) { toast.error("Nominal tidak valid."); return; }
    const body: Record<string, unknown> = { amount: editAmount, isActive: editActive };
    if (editNotes.trim()) body.notes = editNotes.trim();
    else body.notes = null;
    setEditing(true);
    try {
      const res = await fetch(`/api/payroll/adjustments/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Penyesuaian diperbarui."); setEditId(null); setRk((k) => k + 1); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  const columns: Column<Adjustment>[] = [
    {
      header: "Karyawan", cell: (r) => {
        const e = refs.empMap.get(r.employeeId);
        return e ? `${e.firstName} ${e.lastName ?? ""} (${e.code})` : "—";
      },
    },
    { header: "Periode", cell: (r) => (r.periodId ? periodMap.get(r.periodId)?.name ?? "—" : "Umum") },
    { header: "Komponen", cell: (r) => (r.componentId ? compMap.get(r.componentId)?.name ?? "—" : "—") },
    { header: "Jenis", cell: (r) => COMPONENT_KIND_LABEL[r.kind] ?? r.kind },
    { header: "Nominal", cell: (r) => <span className="font-mono">{rp(r.amount)}</span> },
    { header: "Berlaku", cell: (r) => r.effectiveFrom.slice(0, 10) },
    { header: "Catatan", cell: (r) => r.notes ?? "—" },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Ubah</Button> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Penyesuaian Gaji</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Karyawan *</label>
          <Select value={emp} onChange={(e) => setEmp(e.target.value)}>
            <option value="">— Pilih —</option>
            {refs.employees.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Periode</label>
          <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">— Umum (semua periode) —</option>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Komponen</label>
          <Select value={componentId} onChange={(e) => setComponentId(e.target.value)}>
            <option value="">— Tanpa komponen —</option>
            {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Jenis *</label>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="earning">Penerimaan</option><option value="deduction">Potongan</option>
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Nominal *</label><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Berlaku Tanggal *</label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex items-end sm:col-span-4"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      {editId && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-4">
          <div className="space-y-1"><label className="text-sm font-medium">Nominal</label><Input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Catatan</label><Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} /> Aktif</label>
            <div className="flex gap-2"><Button size="sm" loading={editing} onClick={onEdit}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Select className="w-56" value={fEmp} onChange={(e) => { setFEmp(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Karyawan</option>
          {refs.employees.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
        </Select>
        <Select className="w-48" value={fPeriod} onChange={(e) => { setFPeriod(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Periode</option>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <DataTable<Adjustment> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada penyesuaian gaji." />
    </div>
  );
}
