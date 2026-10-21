"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  readError, rp,
  fetchApprovalRequestDetail, fetchUsersActive, fetchRoles,
  REQUEST_STATUS_LABEL, REQUEST_STATUS_STYLE, ACTION_LABEL,
  type ApprovalRequestDetail, type NamedRef, type RoleRef,
} from "@/app/(dashboard)/approvals/_shared";

export default function ApprovalRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [users, setUsers] = useState<NamedRef[]>([]);
  const [detail, setDetail] = useState<ApprovalRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);

  useEffect(() => {
    let ignore = false;
    Promise.all([fetchUsersActive(), fetchRoles()])
      .then(([u, r]) => { if (!ignore) { setUsers(u); setRoles(r); } })
      .catch(() => { /* biarkan kosong */ });
    return () => { ignore = true; };
  }, []);

  const load = useCallback(async () => {
    const d = await fetchApprovalRequestDetail(id);
    setDetail(d);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let ignore = false;
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(load)
      .then(() => { if (!ignore) setLoading(false); })
      .catch(() => { if (!ignore) { setLoading(false); setNotFound(true); } });
    return () => { ignore = true; };
  }, [id, load]);

  async function act(action: "approve" | "reject") {
    if (!detail) return;
    setActing(true);
    try {
      const body: Record<string, unknown> = { action };
      if (note.trim().length >= 3) body.note = note.trim();
      const res = await fetch(`/api/approval-requests/${detail.id}/act`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), credentials: "same-origin",
      });
      if (res.ok) { toast.success(action === "approve" ? "Langkah disetujui." : "Pengajuan ditolak."); setNote(""); await load(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setActing(false); }
  }

  async function cancel() {
    if (!detail) return;
    setActing(true);
    try {
      const body: Record<string, unknown> = {};
      if (note.trim().length >= 3) body.reason = note.trim();
      const res = await fetch(`/api/approval-requests/${detail.id}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), credentials: "same-origin",
      });
      if (res.ok) { toast.success("Pengajuan dibatalkan."); setNote(""); await load(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setActing(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (notFound || !detail) return <p className="text-sm text-zinc-400">Pengajuan tidak ditemukan.</p>;

  const actionsByStep = new Map<number, typeof detail.actions[number]>();
  for (const a of detail.actions) {
    // Langkah hanya punya satu aksi final per actor; tampilan ringkas: aksi terakhir per step.
    actionsByStep.set(a.stepNo, a);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Detail Pengajuan</h1>
        <Link href="/approvals/requests"><Button variant="outline">Kembali</Button></Link>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-4">
        <div><div className="text-xs text-zinc-500">DocType</div><div className="font-mono">{detail.docType}</div></div>
        <div><div className="text-xs text-zinc-500">ID Dokumen</div><div className="font-mono text-xs">{detail.docId}</div></div>
        <div><div className="text-xs text-zinc-500">Nominal</div><div className="font-mono">{rp(detail.amount)}</div></div>
        <div><div className="text-xs text-zinc-500">Status</div><div><span className={REQUEST_STATUS_STYLE[detail.status] ?? ""}>{REQUEST_STATUS_LABEL[detail.status] ?? detail.status}</span></div></div>
        <div><div className="text-xs text-zinc-500">Langkah aktif</div><div>{detail.status === "pending" ? detail.currentStep : "—"}</div></div>
        <div><div className="text-xs text-zinc-500">Total langkah</div><div>{detail.steps.length}</div></div>
        <div><div className="text-xs text-zinc-500">Pengaju</div><div className="text-xs">{users.find((u) => u.id === detail.requestedBy)?.name ?? detail.requestedBy.slice(0, 8)}</div></div>
        <div><div className="text-xs text-zinc-500">Diajukan</div><div className="text-xs">{new Date(detail.requestedAt).toLocaleString("id-ID")}</div></div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-2 w-12">#</th><th className="px-3 py-2">Approver</th>
              <th className="px-3 py-2">Aksi</th><th className="px-3 py-2">Oleh</th>
              <th className="px-3 py-2">Waktu</th><th className="px-3 py-2">Catatan</th>
            </tr>
          </thead>
          <tbody>
            {detail.steps.map((s) => {
              const act = actionsByStep.get(s.stepNo);
              const approverName = s.approverRoleId
                ? (roles.find((r) => r.id === s.approverRoleId)?.name ?? `Role ${s.approverRoleId.slice(0, 8)}`)
                : s.approverUserId
                  ? (users.find((u) => u.id === s.approverUserId)?.name ?? `User ${s.approverUserId.slice(0, 8)}`)
                  : "—";
              const actorName = act ? (users.find((u) => u.id === act.actorId)?.name ?? act.actorId.slice(0, 8)) : null;
              const isActive = detail.status === "pending" && s.stepNo === detail.currentStep;
              return (
                <tr key={s.id} className={isActive ? "bg-amber-50/60 dark:bg-amber-950/30" : "border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"}>
                  <td className="px-3 py-2 font-mono text-xs">{s.stepNo}{isActive ? " ←" : ""}</td>
                  <td className="px-3 py-2">{approverName}</td>
                  <td className="px-3 py-2 text-xs">{act ? (ACTION_LABEL[act.action] ?? act.action) : (isActive ? "Menunggu" : "—")}</td>
                  <td className="px-3 py-2 text-xs">{actorName ?? "—"}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{act ? new Date(act.actedAt).toLocaleString("id-ID") : "—"}</td>
                  <td className="px-3 py-2 text-xs">{act?.note ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail.status === "pending" && (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-sm font-medium">Tindakan approver</div>
          <textarea
            className="w-full rounded-md border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan (opsional, min 3 karakter bila diisi)"
          />
          <div className="flex flex-wrap gap-2">
            <Button loading={acting} onClick={() => void act("approve")}>Setujui langkah ini</Button>
            <Button variant="destructive" loading={acting} onClick={() => void act("reject")}>Tolak</Button>
            <Button variant="outline" loading={acting} onClick={() => void cancel()}>Batalkan pengajuan</Button>
          </div>
          <p className="text-xs text-zinc-500">
            Server memeriksa kelayakan: hanya approver langkah aktif yang dapat menyetujui/menolak, dan pengaju tidak dapat menyetujui pengajuannya sendiri.
          </p>
        </div>
      )}

      {detail.completedAt && (
        <p className="text-xs text-zinc-500">
          Selesai: {new Date(detail.completedAt).toLocaleString("id-ID")}
        </p>
      )}
    </div>
  );
}
