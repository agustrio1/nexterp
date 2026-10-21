"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CODE_RE, RATE_RE, INT_RE,
  CATEGORY_METHOD_LABEL,
} from "@/app/(dashboard)/assets/_shared";

type Category = {
  id: string; code: string; name: string; depreciationMethod: string;
  usefulLifeMonths: number; residualPercent: string; decliningRatePercent: string | null;
  totalUnits: number | null; isActive: boolean;
};

const METHODS = ["straight_line", "declining_balance", "units_of_production"] as const;

function methodFields(m: string) {
  return { declining: m === "declining_balance", units: m === "units_of_production" };
}

export default function AssetCategoriesPage() {
  const [isActive, setIsActive] = useState("");
  const [rk, setRk] = useState(0);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [method, setMethod] = useState<string>("straight_line");
  const [life, setLife] = useState("48");
  const [residual, setResidual] = useState("");
  const [declRate, setDeclRate] = useState("");
  const [units, setUnits] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eMethod, setEMethod] = useState("straight_line");
  const [eLife, setELife] = useState("");
  const [eResidual, setEResidual] = useState("");
  const [eDeclRate, setEDeclRate] = useState("");
  const [eUnits, setEUnits] = useState("");
  const [eActive, setEActive] = useState(true);
  const [editing, setEditing] = useState(false);

  const params = new URLSearchParams();
  if (isActive) params.set("isActive", isActive);
  const qs = params.toString();
  const url = qs ? `/api/assets/categories?${qs}` : "/api/assets/categories";

  function startEdit(c: Category) {
    setEditId(c.id);
    setEName(c.name);
    setEMethod(c.depreciationMethod);
    setELife(String(c.usefulLifeMonths));
    setEResidual(c.residualPercent ?? "");
    setEDeclRate(c.decliningRatePercent ?? "");
    setEUnits(c.totalUnits === null ? "" : String(c.totalUnits));
    setEActive(c.isActive);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code.trim().toUpperCase())) { toast.error("Kode 2-20 karakter huruf/angka/strip, diawali huruf/angka."); return; }
    if (name.trim().length < 2) { toast.error("Nama kategori minimal 2 karakter."); return; }
    if (!INT_RE.test(life) || Number(life) < 1) { toast.error("Umum manfaat harus bilangan bulat ≥ 1."); return; }
    if (residual && !RATE_RE.test(residual)) { toast.error("Nilai residual tidak valid (maks 5 digit, 4 desimal)."); return; }
    const { declining, units: unitMode } = methodFields(method);
    if (declining && !RATE_RE.test(declRate)) { toast.error("Tarif saldo menurun tidak valid."); return; }
    if (unitMode && (!INT_RE.test(units) || Number(units) < 1)) { toast.error("Total unit harus bilangan bulat ≥ 1."); return; }
    const body: Record<string, unknown> = {
      code: code.trim().toUpperCase(), name: name.trim(), depreciationMethod: method,
      usefulLifeMonths: Number(life), residualPercent: residual || "0",
    };
    if (declining) body.decliningRatePercent = declRate;
    if (unitMode) body.totalUnits = Number(units);
    setSaving(true);
    try {
      const res = await fetch("/api/assets/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Kategori dibuat."); setCode(""); setName(""); setMethod("straight_line"); setLife("48"); setResidual(""); setDeclRate(""); setUnits(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat kategori.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onEdit() {
    if (!editId) return;
    const { declining, units: unitMode } = methodFields(eMethod);
    const body: Record<string, unknown> = {
      name: eName.trim(), depreciationMethod: eMethod, usefulLifeMonths: Number(eLife),
      residualPercent: eResidual || "0", isActive: eActive,
      decliningRatePercent: declining && eDeclRate ? eDeclRate : null,
      totalUnits: unitMode && eUnits ? Number(eUnits) : null,
    };
    setEditing(true);
    try {
      const res = await fetch(`/api/assets/categories/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Kategori diperbarui."); setEditId(null); setRk((k) => k + 1); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  const columns: Column<Category>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Metode", cell: (r) => CATEGORY_METHOD_LABEL[r.depreciationMethod] ?? r.depreciationMethod },
    { header: "Umur (bln)", cell: (r) => r.usefulLifeMonths },
    { header: "Residual %", cell: (r) => r.residualPercent },
    { header: "Saldo Menurun %", cell: (r) => r.decliningRatePercent ?? "—" },
    { header: "Total Unit", cell: (r) => r.totalUnits ?? "—" },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Ubah</Button> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Kategori Aset</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="KENDARAAN" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Metode *</label>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m} value={m}>{CATEGORY_METHOD_LABEL[m]}</option>)}</Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Umur Manfaat (bln) *</label><Input value={life} onChange={(e) => setLife(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Residual %</label><Input value={residual} onChange={(e) => setResidual(e.target.value)} placeholder="0" /></div>
        {methodFields(method).declining && (
          <div className="space-y-1"><label className="text-sm font-medium">Tarif Saldo Menurun % *</label><Input value={declRate} onChange={(e) => setDeclRate(e.target.value)} placeholder="25" /></div>
        )}
        {methodFields(method).units && (
          <div className="space-y-1"><label className="text-sm font-medium">Total Unit *</label><Input value={units} onChange={(e) => setUnits(e.target.value)} placeholder="100000" /></div>
        )}
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      {editId && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama</label><Input value={eName} onChange={(e) => setEName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Metode</label>
            <Select value={eMethod} onChange={(e) => setEMethod(e.target.value)}>{METHODS.map((m) => <option key={m} value={m}>{CATEGORY_METHOD_LABEL[m]}</option>)}</Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Umur Manfaat (bln)</label><Input value={eLife} onChange={(e) => setELife(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Residual %</label><Input value={eResidual} onChange={(e) => setEResidual(e.target.value)} /></div>
          {methodFields(eMethod).declining && (
            <div className="space-y-1"><label className="text-sm font-medium">Tarif Saldo Menurun %</label><Input value={eDeclRate} onChange={(e) => setEDeclRate(e.target.value)} /></div>
          )}
          {methodFields(eMethod).units && (
            <div className="space-y-1"><label className="text-sm font-medium">Total Unit</label><Input value={eUnits} onChange={(e) => setEUnits(e.target.value)} /></div>
          )}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={eActive} onChange={(e) => setEActive(e.target.checked)} /> Aktif</label>
            <div className="flex gap-2"><Button size="sm" loading={editing} onClick={onEdit}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
          </div>
        </div>
      )}

      <Select className="w-36" value={isActive} onChange={(e) => { setIsActive(e.target.value); setRk((k) => k + 1); }}>
        <option value="">Semua Aktif</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
      </Select>
      <DataTable<Category> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada kategori aset." />
    </div>
  );
}
