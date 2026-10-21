"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  readError, rp, isValidDocType, isValidAmount,
  fetchWorkflows, fetchUsersActive, fetchRoles,
  type Workflow, type NamedRef, type RoleRef,
} from "@/app/(dashboard)/approvals/_shared";

/** Baris langkah pada form pembuatan (id lokal untuk manipulasi array). */
type StepDraft = { key: number; kind: "role" | "user"; value: string };

let nextKey = 1;
const newStep = (): StepDraft => ({ key: nextKey++, kind: "role", value: "" });

export default function ApprovalWorkflowsPage() {
  const refs = useHrRefs();
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [users, setUsers] = useState<NamedRef[]>([]);

  const [rows, setRows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  const [fDocType, setFDocType] = useState("");
  const [fActive, setFActive] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [docType, setDocType] = useState("");
  const [branchId, setBranchId] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<StepDraft[]>([newStep()]);

  useEffect(() => {
    let ignore = false;
    Promise.all([fetchUsersActive(), fetchRoles()])
      .then(([u, r]) => { if (!ignore) { setUsers(u); setRoles(r); } })
      .catch(() => { /* opsi approver boleh kosong */ });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    let ignore = false;
    const p = new URLSearchParams();
    if (fDocType.trim()) p.set("docType", fDocType.trim());
    if (fActive) p.set("isActive", fActive);
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(() => fetchWorkflows(p))
      .then((d) => { if (!ignore) { setRows(d); setLoading(false); } })
      .catch(() => { if (!ignore) { setLoading(false); toast.error("Gagal memuat alur."); } });
    return () => { ignore = true; };
  }, [fDocType, fActive]);

  function resetForm() {
    setName(""); setDocType(""); setBranchId(""); setMinAmount(""); setMaxAmount("");
    setIsActive(true); setSteps([newStep()]);
  }

  function updateStep(key: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeStep(key: number) {
    setSteps((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.key !== key)));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidDocType(docType.trim())) { toast.error("Jenis dokumen harus slug (huruf kecil, min 3)."); return; }
    if (name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    if (minAmount && !isValidAmount(minAmount)) { toast.error("minAmount tidak valid."); return; }
    if (maxAmount && !isValidAmount(maxAmount)) { toast.error("maxAmount tidak valid."); return; }
    if (minAmount && maxAmount && Number(minAmount) > Number(maxAmount)) {
      toast.error("minAmount tidak boleh lebih besar dari maxAmount."); return;
    }
    const cleanSteps: Array<{ approverRoleId?: string; approverUserId?: string }> = [];
    for (const s of steps) {
      if (!s.value) { toast.error("Setiap langkah harus menunjuk role atau user."); return; }
      if (s.kind === "role") cleanSteps.push({ approverRoleId: s.value });
      else cleanSteps.push({ approverUserId: s.value });
    }
    if (cleanSteps.length === 0) { toast.error("Minimal satu langkah."); return; }

    const body: Record<string, unknown> = {
      docType: docType.trim(), name: name.trim(), isActive, steps: cleanSteps,
    };
    if (branchId) body.branchId = branchId;
    if (minAmount) body.minAmount = minAmount;
    if (maxAmount) body.maxAmount = maxAmount;

    setSaving(true);
    try {
      const res = await fetch("/api/approval-workflows", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), credentials: "same-origin",
      });
      if (res.ok) { toast.success("Alur persetujuan dibuat."); resetForm(); setShowForm(false);
        const p = new URLSearchParams(); if (fDocType.trim()) p.set("docType", fDocType.trim()); if (fActive) p.set("isActive", fActive);
        setRows(await fetchWorkflows(p));
      } else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Alur Persetujuan</h1>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Tutup" : "Buat Alur"}</Button>
      </div>

      {showForm && (
        <form onSubmit={onCreate} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1"><label className="text-sm font-medium">Jenis dokumen *</label>
              <Input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="mis. purchase_order" /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Nama *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Global</option>
                {refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select></div>
            <div className="space-y-1"><label className="text-sm font-medium">Status</label>
              <Select value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true")}>
                <option value="true">Aktif</option><option value="false">Nonaktif</option>
              </Select></div>
            <div className="space-y-1"><label className="text-sm font-medium">minAmount</label>
              <Input inputMode="decimal" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="— (tanpa batas)" /></div>
            <div className="space-y-1"><label className="text-sm font-medium">maxAmount</label>
              <Input inputMode="decimal" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="— (tanpa batas)" /></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Langkah persetujuan *</label>
              <Button type="button" size="sm" variant="outline" onClick={() => setSteps((p) => [...p, newStep()])}>+ Tambah langkah</Button>
            </div>
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-end gap-2">
                <div className="w-8 text-sm text-zinc-500">#{i + 1}</div>
                <div className="w-32 space-y-1"><label className="text-xs text-zinc-500">Tipe</label>
                  <Select value={s.kind} onChange={(e) => updateStep(s.key, { kind: e.target.value as "role" | "user", value: "" })}>
                    <option value="role">Role</option><option value="user">User</option>
                  </Select></div>
                <div className="flex-1 space-y-1"><label className="text-xs text-zinc-500">Approver</label>
                  <Select value={s.value} onChange={(e) => updateStep(s.key, { value: e.target.value })}>
                    <option value="">—</option>
                    {s.kind === "role"
                      ? roles.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)
                      : users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select></div>
                <Button type="button" size="sm" variant="ghost" disabled={steps.length <= 1} onClick={() => removeStep(s.key)}>Hapus</Button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="submit" loading={saving}>Simpan</Button>
            <Button type="button" variant="outline" onClick={() => { resetForm(); setShowForm(false); }}>Batal</Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Input className="w-56" value={fDocType} onChange={(e) => setFDocType(e.target.value)} placeholder="Filter docType" />
        <Select className="w-40" value={fActive} onChange={(e) => setFActive(e.target.value)}>
          <option value="">Semua status</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada alur persetujuan.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Nama</th><th className="px-3 py-2">DocType</th>
                <th className="px-3 py-2">Cabang</th><th className="px-3 py-2 text-right">Rentang</th>
                <th className="px-3 py-2">Status</th><th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2 font-medium">{w.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{w.docType}</td>
                  <td className="px-3 py-2 text-xs">{w.branchId ? (refs.branchMap.get(w.branchId)?.name ?? w.branchId.slice(0, 8)) : "Global"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {w.minAmount == null && w.maxAmount == null ? "—" : `${rp(w.minAmount)} – ${rp(w.maxAmount)}`}
                  </td>
                  <td className="px-3 py-2 text-xs">{w.isActive ? "Aktif" : "Nonaktif"}</td>
                  <td className="px-3 py-2 text-right"><Link href={`/approvals/workflows/${w.id}`}><Button size="sm" variant="outline">Kelola</Button></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
