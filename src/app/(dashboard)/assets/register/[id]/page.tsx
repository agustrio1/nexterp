"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { sub } from "@/lib/money";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  rp, AMOUNT_RE, INT_RE, DATE_RE, PERIOD_KEY_RE,
  ASSET_STATUS_LABEL, ASSET_STATUS_STYLE,
} from "@/app/(dashboard)/assets/_shared";

type AssetDetail = {
  id: string; code: string; name: string; categoryCode: string; categoryName: string;
  branchId: string | null; departmentId: string | null; location: string | null;
  inServiceDate: string; cost: string; accumulatedDepreciation: string; residualValue: string | null;
  usefulLifeMonths: number | null; depreciationMethod: string | null; status: string; isActive: boolean; notes: string | null;
};

const STATUSES = ["draft", "active", "idle", "in_service", "disposed"] as const;

type UsageRow = { id: string; periodKey: string; units: number; notes: string | null };
type TransferRow = { id: string; transferDate: string; toBranchId: string | null; toDepartmentId: string | null; notes: string | null };
type MaintRow = { id: string; maintenanceDate: string; description: string; vendor: string | null; cost: string | null; notes: string | null };
type SchedRow = { id: string; periodKey: string; openingBookValue: string; depreciationAmount: string; accumulatedAfter: string; closingBookValue: string; isBooked: boolean };

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const refs = useHrRefs();
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [rk, setRk] = useState(0);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("draft");
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState("");

  const [uPeriod, setUPeriod] = useState("");
  const [uUnits, setUUnits] = useState("");
  const [busy, setBusy] = useState(false);

  const [tDate, setTDate] = useState("");
  const [tToBranch, setTToBranch] = useState("");
  const [tToDept, setTToDept] = useState("");

  const [mDate, setMDate] = useState("");
  const [mDesc, setMDesc] = useState("");
  const [mVendor, setMVendor] = useState("");
  const [mCost, setMCost] = useState("");

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/assets/register/${id}`, { credentials: "same-origin" });
    if (res.ok) { const j = (await res.json()) as { data: AssetDetail }; setAsset(j.data); }
    else toast.error("Gagal memuat aset.");
    setRk((k) => k + 1);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/assets/register/${id}`, { credentials: "same-origin" })
      .then((res) => res.ok ? res.json() as Promise<{ data: AssetDetail }> : Promise.reject(new Error(String(res.status))))
      .then((j) => {
        const a = j.data;
        setAsset(a); setLoading(false);
        setName(a.name); setBranchId(a.branchId ?? ""); setDepartmentId(a.departmentId ?? "");
        setLocation(a.location ?? ""); setStatus(a.status); setIsActive(a.isActive); setNotes(a.notes ?? "");
      })
      .catch(() => { toast.error("Gagal memuat aset."); setLoading(false); });
  }, [id]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!asset) return <p className="text-zinc-500">Aset tidak ditemukan.</p>;

  async function post(path: string, body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success(okMsg); void refetch(); }
      else toast.error(j?.error?.message ?? "Aksi gagal.");
    } catch { toast.error("Koneksi terganggu."); } finally { setBusy(false); }
  }

  async function onSave() {
    const body: Record<string, unknown> = { name: name.trim(), status, isActive };
    body.branchId = branchId || null;
    body.departmentId = departmentId || null;
    body.location = location.trim() || null;
    body.notes = notes.trim() || null;
    setSaving(true);
    try {
      const res = await fetch(`/api/assets/register/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Aset diperbarui."); void refetch(); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  function submitUsage() {
    if (!PERIOD_KEY_RE.test(uPeriod)) { toast.error("Periode harus YYYY-MM."); return; }
    if (!INT_RE.test(uUnits) || Number(uUnits) < 0) { toast.error("Unit harus bilangan bulat ≥ 0."); return; }
    void post(`/api/assets/register/${id}/usage`, { periodKey: uPeriod, units: Number(uUnits) }, "Pemakaian dicatat.");
    setUPeriod(""); setUUnits("");
  }

  function submitTransfer() {
    if (!tDate || !DATE_RE.test(tDate)) { toast.error("Tanggal transfer wajib."); return; }
    const body: Record<string, unknown> = { assetId: id, transferDate: tDate };
    if (tToBranch) body.toBranchId = tToBranch;
    if (tToDept) body.toDepartmentId = tToDept;
    void post("/api/assets/transfers", body, "Transfer dicatat.");
    setTDate(""); setTToBranch(""); setTToDept("");
  }

  function submitMaint() {
    if (!mDate || !DATE_RE.test(mDate)) { toast.error("Tanggal perawatan wajib."); return; }
    if (mDesc.trim().length < 2) { toast.error("Deskripsi minimal 2 karakter."); return; }
    const body: Record<string, unknown> = { assetId: id, maintenanceDate: mDate, description: mDesc.trim() };
    if (mVendor.trim()) body.vendor = mVendor.trim();
    if (mCost) { if (!AMOUNT_RE.test(mCost)) { toast.error("Biaya tidak valid."); return; } body.cost = mCost; }
    void post("/api/assets/maintenance", body, "Perawatan dicatat.");
    setMDate(""); setMDesc(""); setMVendor(""); setMCost("");
  }

  const usageCols: Column<UsageRow>[] = [
    { header: "Periode", cell: (r) => r.periodKey },
    { header: "Unit", cell: (r) => r.units },
    { header: "Catatan", cell: (r) => r.notes ?? "—" },
  ];
  const transferCols: Column<TransferRow>[] = [
    { header: "Tanggal", cell: (r) => r.transferDate },
    { header: "Ke Cabang", cell: (r) => (r.toBranchId ? refs.branchMap.get(r.toBranchId)?.name ?? "—" : "—") },
    { header: "Ke Departemen", cell: (r) => (r.toDepartmentId ? refs.deptMap.get(r.toDepartmentId)?.name ?? "—" : "—") },
    { header: "Catatan", cell: (r) => r.notes ?? "—" },
  ];
  const maintCols: Column<MaintRow>[] = [
    { header: "Tanggal", cell: (r) => r.maintenanceDate },
    { header: "Uraian", cell: (r) => r.description },
    { header: "Vendor", cell: (r) => r.vendor ?? "—" },
    { header: "Biaya", cell: (r) => <span className="font-mono">{rp(r.cost)}</span> },
  ];
  const schedCols: Column<SchedRow>[] = [
    { header: "Periode", cell: (r) => r.periodKey },
    { header: "Nilai Buku Awal", cell: (r) => <span className="font-mono">{rp(r.openingBookValue)}</span> },
    { header: "Penyusutan", cell: (r) => <span className="font-mono">{rp(r.depreciationAmount)}</span> },
    { header: "Akumulasi", cell: (r) => <span className="font-mono">{rp(r.accumulatedAfter)}</span> },
    { header: "Nilai Buku Akhir", cell: (r) => <span className="font-mono">{rp(r.closingBookValue)}</span> },
    { header: "Dibukukan", cell: (r) => (r.isBooked ? "Ya" : "—") },
  ];

  return (
    <div className="space-y-4">
      <Link href="/assets/register" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Register Aset
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <code className="font-mono">{asset.code}</code> — {asset.name}{" "}
          <span className={ASSET_STATUS_STYLE[asset.status] ?? ""}>{ASSET_STATUS_LABEL[asset.status] ?? asset.status}</span>
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-4">
        <div><p className="text-zinc-500">Kategori</p><p className="font-medium">{asset.categoryName}</p></div>
        <div><p className="text-zinc-500">Harga Perolehan</p><p className="font-mono font-medium">{rp(asset.cost)}</p></div>
        <div><p className="text-zinc-500">Akumulasi Susut</p><p className="font-mono font-medium">{rp(asset.accumulatedDepreciation)}</p></div>
        <div><p className="text-zinc-500">Nilai Buku</p><p className="font-mono font-medium">{rp(sub(asset.cost, asset.accumulatedDepreciation).toFixed(2))}</p></div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Departemen</label>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">—</option>{refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Lokasi</label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Status</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}</Select>
        </div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Catatan</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex items-center gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label></div>
        <div className="flex items-end"><Button loading={saving} onClick={onSave}>Simpan Perubahan</Button></div>
      </div>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Pemakaian (Unit Produksi)</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><label className="text-sm font-medium">Periode (YYYY-MM)</label><Input value={uPeriod} onChange={(e) => setUPeriod(e.target.value)} placeholder="2026-01" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Unit</label><Input value={uUnits} onChange={(e) => setUUnits(e.target.value)} /></div>
          <Button size="sm" loading={busy} onClick={submitUsage}>Catat</Button>
        </div>
        <DataTable<UsageRow> key={`u${rk}`} url={`/api/assets/register/${id}/usage`} columns={usageCols} rowKey={(r) => r.id} emptyMessage="Belum ada pemakaian." />
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Transfer Penempatan</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><label className="text-sm font-medium">Tanggal</label><Input value={tDate} onChange={(e) => setTDate(e.target.value)} placeholder="2026-01-01" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Ke Cabang</label>
            <Select value={tToBranch} onChange={(e) => setTToBranch(e.target.value)}><option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Ke Departemen</label>
            <Select value={tToDept} onChange={(e) => setTToDept(e.target.value)}><option value="">—</option>{refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          </div>
          <Button size="sm" loading={busy} onClick={submitTransfer}>Transfer</Button>
        </div>
        <DataTable<TransferRow> key={`t${rk}`} url={`/api/assets/transfers?assetId=${id}`} columns={transferCols} rowKey={(r) => r.id} emptyMessage="Belum ada transfer." />
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Perawatan</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><label className="text-sm font-medium">Tanggal</label><Input value={mDate} onChange={(e) => setMDate(e.target.value)} placeholder="2026-01-01" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Uraian *</label><Input value={mDesc} onChange={(e) => setMDesc(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Vendor</label><Input value={mVendor} onChange={(e) => setMVendor(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Biaya</label><Input value={mCost} onChange={(e) => setMCost(e.target.value)} /></div>
          <Button size="sm" loading={busy} onClick={submitMaint}>Catat</Button>
        </div>
        <DataTable<MaintRow> key={`m${rk}`} url={`/api/assets/maintenance?assetId=${id}`} columns={maintCols} rowKey={(r) => r.id} emptyMessage="Belum ada perawatan." />
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Jadwal Penyusutan</h2>
        <DataTable<SchedRow> key={`s${rk}`} url={`/api/assets/depreciation/schedules/${id}`} columns={schedCols} rowKey={(r) => r.id} emptyMessage="Belum ada jadwal penyusutan." />
      </section>
    </div>
  );
}
