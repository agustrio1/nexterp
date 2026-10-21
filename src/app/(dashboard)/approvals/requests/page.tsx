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
  readError, rp, isValidDocType, isValidAmount, UUID_RE,
  fetchApprovalRequestsPage,
  REQUEST_STATUS_LABEL, REQUEST_STATUS_STYLE,
  type ApprovalRequest,
} from "@/app/(dashboard)/approvals/_shared";

const STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

const emptyForm = { docType: "", docId: "", amount: "", branchId: "" };

export default function ApprovalRequestsPage() {
  const refs = useHrRefs();

  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [fStatus, setFStatus] = useState("");
  const [fDocType, setFDocType] = useState("");
  const [fForMe, setFForMe] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const set = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function filterParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (fStatus) p.set("status", fStatus);
    if (fDocType.trim()) p.set("docType", fDocType.trim());
    if (fForMe) p.set("forMe", fForMe);
    p.set("limit", "50");
    return p;
  }

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => { if (!ignore) setLoading(true); })
      .then(() => fetchApprovalRequestsPage(filterParams()))
      .then((page) => { if (!ignore) { setRows(page.items); setNextCursor(page.nextCursor); setLoading(false); } })
      .catch(() => { if (!ignore) { setLoading(false); toast.error("Gagal memuat pengajuan."); } });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fStatus, fDocType, fForMe]);

  async function refreshFirst() {
    try { const page = await fetchApprovalRequestsPage(filterParams()); setRows(page.items); setNextCursor(page.nextCursor); }
    catch { /* diam */ }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const p = filterParams(); p.set("cursor", nextCursor);
      const page = await fetchApprovalRequestsPage(p);
      setRows((prev) => [...prev, ...page.items]); setNextCursor(page.nextCursor);
    } catch { toast.error("Gagal memuat tambahan."); } finally { setLoadingMore(false); }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidDocType(form.docType.trim())) { toast.error("Jenis dokumen harus slug huruf kecil."); return; }
    if (!UUID_RE.test(form.docId.trim())) { toast.error("ID dokumen harus UUID."); return; }
    if (form.amount && !isValidAmount(form.amount)) { toast.error("Nominal tidak valid."); return; }
    const body: Record<string, unknown> = { docType: form.docType.trim(), docId: form.docId.trim() };
    if (form.amount) body.amount = form.amount;
    if (form.branchId) body.branchId = form.branchId;
    setSaving(true);
    try {
      const res = await fetch("/api/approval-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), credentials: "same-origin",
      });
      if (res.ok) { toast.success("Pengajuan dikirim."); setForm(emptyForm); setShowForm(false); await refreshFirst(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pengajuan Persetujuan</h1>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Tutup" : "Ajukan Dokumen"}</Button>
      </div>

      {showForm && (
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
          <div className="space-y-1"><label className="text-sm font-medium">Jenis dokumen *</label>
            <Input value={form.docType} onChange={(e) => set("docType", e.target.value)} placeholder="mis. purchase_order" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">ID dokumen (UUID) *</label>
            <Input value={form.docId} onChange={(e) => set("docId", e.target.value)} placeholder="xxxxxxxx-xxxx-..." /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nominal</label>
            <Input inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="— (opsional)" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
            <Select value={form.branchId} onChange={(e) => set("branchId", e.target.value)}>
              <option value="">—</option>
              {refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select></div>
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button type="submit" loading={saving}>Kirim</Button>
            <Button type="button" variant="outline" onClick={() => { setForm(emptyForm); setShowForm(false); }}>Batal</Button>
          </div>
          <p className="text-xs text-zinc-500 sm:col-span-4">
            Sistem akan memilih alur aktif yang cocok berdasarkan docType + cabang + nominal.
          </p>
        </form>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Select className="w-40" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Semua status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{REQUEST_STATUS_LABEL[s]}</option>)}
        </Select>
        <Input className="w-56" value={fDocType} onChange={(e) => setFDocType(e.target.value)} placeholder="Filter docType" />
        <Select className="w-52" value={fForMe} onChange={(e) => setFForMe(e.target.value)}>
          <option value="">Semua pengajuan</option>
          <option value="true">Menunggu tindakan saya</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada pengajuan.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2">DocType</th><th className="px-3 py-2">ID Dokumen</th>
                  <th className="px-3 py-2 text-right">Nominal</th><th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Langkah</th><th className="px-3 py-2">Diajukan</th><th className="px-3 py-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-3 py-2 font-mono text-xs">{r.docType}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.docId.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(r.amount)}</td>
                    <td className="px-3 py-2"><span className={REQUEST_STATUS_STYLE[r.status] ?? ""}>{REQUEST_STATUS_LABEL[r.status] ?? r.status}</span></td>
                    <td className="px-3 py-2 text-xs">{r.status === "pending" ? `${r.currentStep}` : "—"}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(r.requestedAt).toLocaleString("id-ID")}</td>
                    <td className="px-3 py-2 text-right"><Link href={`/approvals/requests/${r.id}`}><Button size="sm" variant="outline">Detail</Button></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && <div className="flex justify-center"><Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>Muat lebih</Button></div>}
        </>
      )}
    </div>
  );
}
