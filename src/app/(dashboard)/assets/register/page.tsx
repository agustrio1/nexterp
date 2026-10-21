"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  fetchCategories, CODE_RE, AMOUNT_RE, INT_RE, DATE_RE,
  rp, CATEGORY_METHOD_LABEL, ASSET_STATUS_LABEL, ASSET_STATUS_STYLE,
  type CategoryRef,
} from "@/app/(dashboard)/assets/_shared";

type Asset = {
  id: string; code: string; name: string; categoryId: string; categoryCode: string;
  branchId: string | null; location: string | null; inServiceDate: string;
  cost: string; accumulatedDepreciation: string; status: string; isActive: boolean;
};

const STATUSES = ["draft", "active", "idle", "in_service", "disposed"] as const;
const METHODS = ["straight_line", "declining_balance", "units_of_production"] as const;

export default function AssetRegisterPage() {
  const refs = useHrRefs();
  const [categories, setCategories] = useState<CategoryRef[]>([]);

  const [fCategory, setFCategory] = useState("");
  const [fBranch, setFBranch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fActive, setFActive] = useState("");
  const [rk, setRk] = useState(0);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [location, setLocation] = useState("");
  const [inServiceDate, setInServiceDate] = useState("");
  const [cost, setCost] = useState("");
  const [residual, setResidual] = useState("");
  const [life, setLife] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void fetchCategories().then(setCategories); }, []);

  const params = new URLSearchParams();
  if (fCategory) params.set("categoryId", fCategory);
  if (fBranch) params.set("branchId", fBranch);
  if (fStatus) params.set("status", fStatus);
  if (fActive) params.set("isActive", fActive);
  const qs = params.toString();
  const url = qs ? `/api/assets/register?${qs}` : "/api/assets/register";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code.trim().toUpperCase())) { toast.error("Kode aset tidak valid."); return; }
    if (name.trim().length < 2) { toast.error("Nama aset minimal 2 karakter."); return; }
    if (!categoryId) { toast.error("Pilih kategori aset."); return; }
    if (!inServiceDate || !DATE_RE.test(inServiceDate)) { toast.error("Tanggal operasional wajib (YYYY-MM-DD)."); return; }
    if (!AMOUNT_RE.test(cost)) { toast.error("Harga perolehan tidak valid."); return; }
    if (residual && !AMOUNT_RE.test(residual)) { toast.error("Nilai residual tidak valid."); return; }
    if (life && (!INT_RE.test(life) || Number(life) < 1)) { toast.error("Umur manfaat harus bilangan bulat ≥ 1."); return; }
    const body: Record<string, unknown> = {
      code: code.trim().toUpperCase(), name: name.trim(), categoryId,
      inServiceDate, cost, status,
    };
    if (branchId) body.branchId = branchId;
    if (departmentId) body.departmentId = departmentId;
    if (location.trim()) body.location = location.trim();
    if (residual) body.residualValue = residual;
    if (life) body.usefulLifeMonths = Number(life);
    if (method) body.depreciationMethod = method;
    setSaving(true);
    try {
      const res = await fetch("/api/assets/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) {
        toast.success("Aset dibuat.");
        setCode(""); setName(""); setCategoryId(""); setBranchId(""); setDepartmentId(""); setLocation("");
        setInServiceDate(""); setCost(""); setResidual(""); setLife(""); setMethod(""); setStatus("draft"); setRk((k) => k + 1);
      } else toast.error(j?.error?.message ?? "Gagal membuat aset.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  const columns: Column<Asset>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => <Link className="text-blue-600 hover:underline" href={`/assets/register/${r.id}`}>{r.name}</Link> },
    { header: "Kategori", cell: (r) => r.categoryCode },
    { header: "Cabang", cell: (r) => (r.branchId ? refs.branchMap.get(r.branchId)?.name ?? "—" : "—") },
    { header: "Operasional", cell: (r) => r.inServiceDate },
    { header: "Harga Perolehan", cell: (r) => <span className="font-mono">{rp(r.cost)}</span> },
    { header: "Akum. Susut", cell: (r) => <span className="font-mono">{rp(r.accumulatedDepreciation)}</span> },
    { header: "Status", cell: (r) => <span className={ASSET_STATUS_STYLE[r.status] ?? ""}>{ASSET_STATUS_LABEL[r.status] ?? r.status}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/assets/register/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Register Aset Tetap</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="AST-001" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Kategori *</label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— Pilih —</option>
            {categories.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Departemen</label>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">—</option>{refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Lokasi</label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Tgl. Operasional *</label><Input value={inServiceDate} onChange={(e) => setInServiceDate(e.target.value)} placeholder="2026-01-01" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Harga Perolehan *</label><Input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="150000000" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nilai Residual</label><Input value={residual} onChange={(e) => setResidual(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Umur Manfaat (bln)</label><Input value={life} onChange={(e) => setLife(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Metode Susut</label>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">— Ikuti Kategori —</option>
            {METHODS.map((m) => <option key={m} value={m}>{CATEGORY_METHOD_LABEL[m]}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Status *</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}
          </Select>
        </div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah Aset</Button></div>
      </form>

      <div className="flex flex-wrap gap-2">
        <Select className="w-44" value={fCategory} onChange={(e) => { setFCategory(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Kategori</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="w-40" value={fBranch} onChange={(e) => { setFBranch(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Cabang</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select className="w-40" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Status</option>{STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}
        </Select>
        <Select className="w-32" value={fActive} onChange={(e) => { setFActive(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
      </div>
      <DataTable<Asset> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada aset tetap." />
    </div>
  );
}
