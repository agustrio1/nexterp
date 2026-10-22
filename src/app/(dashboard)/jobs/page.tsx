"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Job = {
  id: string; type: string; status: string;
  fileName: string | null; contentType: string | null;
  attempts: number; maxAttempts: number;
  runAt: string | null; claimedAt: string | null; finishedAt: string | null;
  lastError: string | null; idempotencyKey: string | null;
  createdAt: string; createdBy: string | null; hasArtifact: boolean;
};

const TYPES = ["export.report", "payroll.run"] as const;
const STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

const TYPE_LABEL: Record<string, string> = { "export.report": "Ekspor Laporan", "payroll.run": "Run Payroll" };
const STATUS_LABEL: Record<string, string> = {
  queued: "Antre", running: "Berjalan", succeeded: "Sukses", failed: "Gagal", cancelled: "Dibatalkan",
};
const STATUS_STYLE: Record<string, string> = {
  queued: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  running: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  succeeded: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  failed: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
  cancelled: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const fmt = (v: string | null): string => (v ? new Date(v).toLocaleString("id-ID") : "—");

async function readError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Gagal (${res.status}).`;
}

export default function JobsPage() {
  const [rows, setRows] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");

  const [selected, setSelected] = useState<Job | null>(null);
  const [cancelling, setCancelling] = useState(false);

  function filterParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (fStatus) p.set("status", fStatus);
    if (fType) p.set("type", fType);
    p.set("limit", "50");
    return p;
  }

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(() => fetch(`/api/jobs?${filterParams()}`, { credentials: "same-origin" }))
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const j = (await res.json()) as { data?: Job[]; meta?: { nextCursor?: string | null } };
        if (!ignore) { setRows(j.data ?? []); setNextCursor(j.meta?.nextCursor ?? null); setLoading(false); }
      })
      .catch(() => { if (!ignore) { setLoading(false); toast.error("Gagal memuat job."); } });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fStatus, fType]);

  async function refresh() {
    try {
      const res = await fetch(`/api/jobs?${filterParams()}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error();
      const j = (await res.json()) as { data?: Job[]; meta?: { nextCursor?: string | null } };
      setRows(j.data ?? []); setNextCursor(j.meta?.nextCursor ?? null);
    } catch { toast.error("Gagal memuat ulang."); }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const p = filterParams(); p.set("cursor", nextCursor);
      const res = await fetch(`/api/jobs?${p}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error();
      const j = (await res.json()) as { data?: Job[]; meta?: { nextCursor?: string | null } };
      setRows((prev) => [...prev, ...(j.data ?? [])]); setNextCursor(j.meta?.nextCursor ?? null);
    } catch { toast.error("Gagal memuat tambahan."); } finally { setLoadingMore(false); }
  }

  async function cancel(id: string) {
    setCancelling(true);
    try {
      const res = await fetch(`/api/jobs/${id}/cancel`, { method: "POST", credentials: "same-origin" });
      if (res.ok) { toast.success("Job dibatalkan."); setSelected(null); await refresh(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setCancelling(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Monitor Job</h1>
        <Button variant="outline" onClick={() => void refresh()}>Muat ulang</Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Select className="w-44" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Semua status</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Select className="w-52" value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">Semua tipe</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada job.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2">ID</th><th className="px-3 py-2">Tipe</th><th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Percobaan</th><th className="px-3 py-2">Dibuat</th><th className="px-3 py-2">Selesai</th><th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-3 py-2 font-mono text-xs">{r.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-xs">{TYPE_LABEL[r.type] ?? r.type}</td>
                    <td className="px-3 py-2"><span className={STATUS_STYLE[r.status] ?? ""}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                    <td className="px-3 py-2 text-xs">{r.attempts}/{r.maxAttempts}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{fmt(r.createdAt)}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{fmt(r.finishedAt)}</td>
                    <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => setSelected(r)}>Detail</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && <div className="flex justify-center"><Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>Muat lebih</Button></div>}
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg space-y-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Detail Job</h2>
              <span className={STATUS_STYLE[selected.status] ?? ""}>{STATUS_LABEL[selected.status] ?? selected.status}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-zinc-500">ID</dt><dd className="font-mono">{selected.id}</dd>
              <dt className="text-zinc-500">Tipe</dt><dd>{TYPE_LABEL[selected.type] ?? selected.type}</dd>
              <dt className="text-zinc-500">Percobaan</dt><dd>{selected.attempts}/{selected.maxAttempts}</dd>
              <dt className="text-zinc-500">Run at</dt><dd>{fmt(selected.runAt)}</dd>
              <dt className="text-zinc-500">Diklaim</dt><dd>{fmt(selected.claimedAt)}</dd>
              <dt className="text-zinc-500">Selesai</dt><dd>{fmt(selected.finishedAt)}</dd>
              <dt className="text-zinc-500">File</dt><dd>{selected.fileName ?? "—"}</dd>
              <dt className="text-zinc-500">Artefak</dt><dd>{selected.hasArtifact ? "Tersedia" : "—"}</dd>
              <dt className="text-zinc-500">Idempotency</dt><dd className="font-mono break-all">{selected.idempotencyKey ?? "—"}</dd>
            </dl>
            {selected.lastError && (
              <div><div className="text-xs text-zinc-500">Error terakhir</div><pre className="mt-1 max-h-32 overflow-auto rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{selected.lastError}</pre></div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setSelected(null)}>Tutup</Button>
              {selected.status === "queued" && (
                <Button variant="destructive" loading={cancelling} onClick={() => void cancel(selected.id)}>Batalkan</Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
