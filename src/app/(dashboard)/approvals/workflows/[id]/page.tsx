"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  readError, isValidAmount,
  fetchWorkflowDetail, fetchUsersActive, fetchRoles,
  type WorkflowDetail, type NamedRef, type RoleRef,
} from "@/app/(dashboard)/approvals/_shared";

type StepDraft = { key: number; kind: "role" | "user"; value: string };
let nextKey = 1;
const newStep = (): StepDraft => ({ key: nextKey++, kind: "role", value: "" });

export default function ApprovalWorkflowDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const refs = useHrRefs();

  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [users, setUsers] = useState<NamedRef[]>([]);

  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Field form
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("");
  const [branchId, setBranchId] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<StepDraft[]>([]);

  useEffect(() => {
    let ignore = false;
    Promise.all([fetchUsersActive(), fetchRoles()])
      .then(([u, r]) => { if (!ignore) { setUsers(u); setRoles(r); } })
      .catch(() => { /* biarkan kosong */ });
    return () => { ignore = true; };
  }, []);

  const load = useCallback(async () => {
    const d = await fetchWorkflowDetail(id);
    setDetail(d);
    setName(d.name); setDocType(d.docType); setBranchId(d.branchId ?? "");
    setMinAmount(d.minAmount ?? ""); setMaxAmount(d.maxAmount ?? ""); setIsActive(d.isActive);
    setSteps(d.steps.map((s) => s.approverRoleId
      ? { key: nextKey++, kind: "role" as const, value: s.approverRoleId }
      : { key: nextKey++, kind: "user" as const, value: s.approverUserId ?? "" }));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let ignore = false;
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(load)
      .then(() => { if (!ignore) setLoading(false); })
      .catch(() => { if (!ignore) { setLoading(false); toast.error("Gagal memuat alur."); } });
    return () => { ignore = true; };
  }, [id, load]);

  function updateStep(key: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeStep(key: number) {
    setSteps((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.key !== key)));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (name.trim().length < 2) { toast.error("Nama minimal 2 karakter."); return; }
    if (minAmount && !isValidAmount(minAmount)) { toast.error("minAmount tidak valid."); return; }
    if (maxAmount && !isValidAmount(maxAmount)) { toast.error("maxAmount tidak valid."); return; }
    if (minAmount && maxAmount && Number(minAmount) > Number(maxAmount)) {
      toast.error("minAmount tidak boleh lebih besar dari maxAmount."); return;
    }
    if (steps.length === 0 || steps.some((s) => !s.value)) {
      toast.error("Setiap langkah harus menunjuk role atau user."); return;
    }

    const cleanSteps: Array<{ approverRoleId?: string; approverUserId?: string }> = steps.map((s) =>
      s.kind === "role" ? { approverRoleId: s.value } : { approverUserId: s.value },
    );

    const body: Record<string, unknown> = { name: name.trim(), isActive, steps: cleanSteps };
    body.branchId = branchId || null;
    body.minAmount = minAmount || null;
    body.maxAmount = maxAmount || null;
    if (docType.trim() && docType.trim() !== detail.docType) body.docType = docType.trim();

    setSaving(true);
    try {
      const res = await fetch(`/api/approval-workflows/${detail.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), credentials: "same-origin",
      });
      if (res.ok) { toast.success("Alur diperbarui."); setEditing(false); await load(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  function onCancelEdit() { setEditing(false); if (detail) void load(); }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!detail) return <p className="text-sm text-zinc-400">Alur tidak ditemukan.</p>;

  const branchName = detail.branchId ? (refs.branchMap.get(detail.branchId)?.name ?? detail.branchId.slice(0, 8)) : "Global";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{detail.name}</h1>
          <p className="text-sm text-zinc-500 font-mono">{detail.docType}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/approvals/workflows"><Button variant="outline">Kembali</Button></Link>
          {!editing && <Button onClick={() => setEditing(true)}>Ubah</Button>}
        </div>
      </div>

      {!editing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-4">
            <div><div className="text-xs text-zinc-500">Cabang</div><div>{branchName}</div></div>
            <div><div className="text-xs text-zinc-500">minAmount</div><div className="font-mono">{detail.minAmount ?? "—"}</div></div>
            <div><div className="text-xs text-zinc-500">maxAmount</div><div className="font-mono">{detail.maxAmount ?? "—"}</div></div>
            <div><div className="text-xs text-zinc-500">Status</div><div>{detail.isActive ? "Aktif" : "Nonaktif"}</div></div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2 w-16">#</th><th className="px-3 py-2">Tipe</th><th className="px-3 py-2">Approver</th>
                </tr>
              </thead>
              <tbody>
                {detail.steps.map((s) => {
                  const roleName = s.approverRoleId ? roles.find((r) => r.id === s.approverRoleId) : null;
                  const userName = s.approverUserId ? users.find((u) => u.id === s.approverUserId) : null;
                  return (
                    <tr key={s.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-3 py-2 font-mono text-xs">{s.stepNo}</td>
                      <td className="px-3 py-2 text-xs">{s.approverRoleId ? "Role" : "User"}</td>
                      <td className="px-3 py-2">
                        {roleName ? `${roleName.code} — ${roleName.name}`
                          : userName ? userName.name
                          : (s.approverRoleId ?? s.approverUserId ?? "—").toString().slice(0, 8)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <form onSubmit={onSave} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1"><label className="text-sm font-medium">Jenis dokumen</label>
              <Input value={docType} onChange={(e) => setDocType(e.target.value)} /></div>
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
              <Input inputMode="decimal" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="kosong = tanpa batas" /></div>
            <div className="space-y-1"><label className="text-sm font-medium">maxAmount</label>
              <Input inputMode="decimal" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="kosong = tanpa batas" /></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Langkah persetujuan * <span className="text-xs text-zinc-500">(mengganti seluruh langkah lama)</span></label>
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
            <Button type="button" variant="outline" onClick={onCancelEdit}>Batal</Button>
          </div>
        </form>
      )}
    </div>
  );
}
