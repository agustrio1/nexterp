"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  fetchAssets, rp, AMOUNT_RE, DATE_RE,
  DOC_STATUS_LABEL, DOC_STATUS_STYLE,
  type AssetRef,
} from "@/app/(dashboard)/assets/_shared";

type Revaluation = {
  id: string; docNo: string | null; assetId: string; effectiveDate: string;
  newCost: string; newAccumulated: string; status: string; notes: string | null;
};

export default function AssetRevaluationsPage() {
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [fAsset, setFAsset] = useState("");
  const [rk, setRk] = useState(0);

  const [assetId, setAssetId] = useState("");
  const [date, setDate] = useState("");
  const [newCost, setNewCost] = useState("");
  const [newAccum, setNewAccum] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void fetchAssets().then(setAssets); }, []);
  const assetMap = new Map(assets.map((a) => [a.id, a]));

  const url = fAsset ? `/api/assets/revaluations?assetId=${fAsset}` : "/api/assets/revaluations";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId) { toast.error("Pilih aset."); return; }
    if (!date || !DATE_RE.test(date)) { toast.error("Tanggal berlaku wajib (YYYY-MM-DD)."); return; }
    if (!AMOUNT_RE.test(newCost)) { toast.error("Harga baru tidak valid."); return; }
    if (!AMOUNT_RE.test(newAccum)) { toast.error("Akumulasi baru tidak valid."); return; }
    const body: Record<string, unknown> = { assetId, effectiveDate: date, newCost, newAccumulated: newAccum };
    if (notes.trim()) body.notes = notes.trim();
    setSaving(true);
    try {
      const res = await fetch("/api/assets/revaluations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Revaluasi dibuat (draf)."); setAssetId(""); setDate(""); setNewCost(""); setNewAccum(""); setNotes(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat revaluasi.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function doPost(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/revaluations/${id}/post`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Revaluasi diposting."); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Aksi gagal.");
    } catch { toast.error("Koneksi terganggu."); } finally { setBusy(false); }
  }

  const columns: Column<Revaluation>[] = [
    { header: "No. Dokumen", cell: (r) => <code className="font-mono text-xs">{r.docNo ?? "—"}</code> },
    { header: "Aset", cell: (r) => { const a = assetMap.get(r.assetId); return a ? `${a.code} — ${a.name}` : "—"; } },
    { header: "Tgl. Berlaku", cell: (r) => r.effectiveDate },
    { header: "Harga Baru", cell: (r) => <span className="font-mono">{rp(r.newCost)}</span> },
    { header: "Akumulasi Baru", cell: (r) => <span className="font-mono">{rp(r.newAccumulated)}</span> },
    { header: "Status", cell: (r) => <span className={DOC_STATUS_STYLE[r.status] ?? ""}>{DOC_STATUS_LABEL[r.status] ?? r.status}</span> },
    {
      header: "Aksi", className: "w-[120px]", cell: (r) => (
        r.status === "draft" ? <Button size="sm" variant="outline" loading={busy} onClick={() => void doPost(r.id)}>Posting</Button> : null
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Revaluasi Aset</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Aset *</label>
          <Select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">— Pilih —</option>
            {assets.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Tgl. Berlaku *</label><Input value={date} onChange={(e) => setDate(e.target.value)} placeholder="2026-01-01" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Harga Perolehan Baru *</label><Input value={newCost} onChange={(e) => setNewCost(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Akumulasi Baru *</label><Input value={newAccum} onChange={(e) => setNewAccum(e.target.value)} /></div>
        <div className="space-y-1 sm:col-span-3"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      <Select className="w-52" value={fAsset} onChange={(e) => { setFAsset(e.target.value); setRk((k) => k + 1); }}>
        <option value="">Semua Aset</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
      </Select>
      <DataTable<Revaluation> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada revaluasi aset." />
    </div>
  );
}
