"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  fetchAssets, fetchBankAccounts, rp, AMOUNT_RE, DATE_RE,
  DOC_STATUS_LABEL, DOC_STATUS_STYLE,
  type AssetRef, type BankRef,
} from "@/app/(dashboard)/assets/_shared";

type Disposal = {
  id: string; docNo: string | null; assetId: string; disposalDate: string;
  proceedsAmount: string; gainAmount: string | null; lossAmount: string | null;
  bankAccountId: string | null; status: string; reason: string | null; notes: string | null;
};

export default function AssetDisposalsPage() {
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [banks, setBanks] = useState<BankRef[]>([]);

  const [fAsset, setFAsset] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [rk, setRk] = useState(0);

  const [assetId, setAssetId] = useState("");
  const [date, setDate] = useState("");
  const [proceeds, setProceeds] = useState("0");
  const [bankId, setBankId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.allSettled([fetchAssets(), fetchBankAccounts()]).then(([a, b]) => {
      if (a.status === "fulfilled") setAssets(a.value);
      if (b.status === "fulfilled") setBanks(b.value);
    });
  }, []);

  const assetMap = new Map(assets.map((a) => [a.id, a]));

  const params = new URLSearchParams();
  if (fAsset) params.set("assetId", fAsset);
  if (fStatus) params.set("status", fStatus);
  const qs = params.toString();
  const url = qs ? `/api/assets/disposals?${qs}` : "/api/assets/disposals";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId) { toast.error("Pilih aset."); return; }
    if (!date || !DATE_RE.test(date)) { toast.error("Tanggal pelepasan wajib (YYYY-MM-DD)."); return; }
    if (proceeds && !AMOUNT_RE.test(proceeds)) { toast.error("Hasil pelepasan tidak valid."); return; }
    const body: Record<string, unknown> = { assetId, disposalDate: date, proceedsAmount: proceeds || "0" };
    if (bankId) body.bankAccountId = bankId;
    if (notes.trim()) body.notes = notes.trim();
    setSaving(true);
    try {
      const res = await fetch("/api/assets/disposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Pelepasan dibuat (draf)."); setAssetId(""); setDate(""); setProceeds("0"); setBankId(""); setNotes(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat pelepasan.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function doAction(id: string, kind: "post" | "reverse", withReason?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/disposals/${id}/${kind}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: kind === "post" ? "{}" : JSON.stringify({ reason: withReason }), credentials: "same-origin",
      });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success(kind === "post" ? "Pelepasan diposting." : "Pelepasan direversal."); setPendingId(null); setReason(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Aksi gagal.");
    } catch { toast.error("Koneksi terganggu."); } finally { setBusy(false); }
  }

  function submitReason() {
    if (!pendingId) return;
    if (reason.trim().length < 5) { toast.error("Alasan minimal 5 karakter."); return; }
    void doAction(pendingId, "reverse", reason.trim());
  }

  const columns: Column<Disposal>[] = [
    { header: "No. Dokumen", cell: (r) => <code className="font-mono text-xs">{r.docNo ?? "—"}</code> },
    { header: "Aset", cell: (r) => { const a = assetMap.get(r.assetId); return a ? `${a.code} — ${a.name}` : "—"; } },
    { header: "Tanggal", cell: (r) => r.disposalDate },
    { header: "Hasil", cell: (r) => <span className="font-mono">{rp(r.proceedsAmount)}</span> },
    { header: "Laba", cell: (r) => <span className="font-mono">{rp(r.gainAmount)}</span> },
    { header: "Rugi", cell: (r) => <span className="font-mono">{rp(r.lossAmount)}</span> },
    { header: "Status", cell: (r) => <span className={DOC_STATUS_STYLE[r.status] ?? ""}>{DOC_STATUS_LABEL[r.status] ?? r.status}</span> },
    {
      header: "Aksi", className: "w-[200px]", cell: (r) => (
        <div className="flex gap-1">
          {r.status === "draft" && <Button size="sm" variant="outline" loading={busy} onClick={() => void doAction(r.id, "post")}>Posting</Button>}
          {r.status === "posted" && <Button size="sm" variant="ghost" onClick={() => { setPendingId(r.id); setReason(""); }}>Reversal</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pelepasan Aset</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Aset *</label>
          <Select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">— Pilih —</option>
            {assets.filter((a) => a.isActive && a.status !== "disposed").map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Tanggal *</label><Input value={date} onChange={(e) => setDate(e.target.value)} placeholder="2026-01-01" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Hasil Pelepasan</label><Input value={proceeds} onChange={(e) => setProceeds(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Rekening Penerimaan</label>
          <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="">—</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-3"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      {pendingId && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="min-w-[240px] flex-1 space-y-1"><label className="text-sm font-medium">Alasan reversal *</label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Minimal 5 karakter" /></div>
          <Button size="sm" loading={busy} onClick={submitReason}>Konfirmasi</Button>
          <Button size="sm" variant="ghost" onClick={() => { setPendingId(null); setReason(""); }}>Batal</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Select className="w-52" value={fAsset} onChange={(e) => { setFAsset(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Aset</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </Select>
        <Select className="w-40" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Status</option>{Object.entries(DOC_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <DataTable<Disposal> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada pelepasan aset." />
    </div>
  );
}
