"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  fetchPeriods, rp,
  RUN_STATUS_LABEL, RUN_STATUS_STYLE,
  type PeriodRef,
} from "@/app/(dashboard)/payroll/_shared";

type Run = {
  id: string; docNo: string | null; periodId: string; branchId: string | null;
  status: string; employeeCount: number | null; totalEarnings: string;
  totalDeductions: string; totalNet: string;
};

export default function PayrollRunsPage() {
  const refs = useHrRefs();
  const [periods, setPeriods] = useState<PeriodRef[]>([]);
  const [fPeriod, setFPeriod] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [rk, setRk] = useState(0);

  const [periodId, setPeriodId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchPeriods().then(setPeriods);
  }, []);

  const periodMap = new Map(periods.map((p) => [p.id, p]));

  const params = new URLSearchParams();
  if (fPeriod) params.set("periodId", fPeriod);
  if (fStatus) params.set("status", fStatus);
  const qs = params.toString();
  const url = qs ? `/api/payroll/runs?${qs}` : "/api/payroll/runs";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!periodId) { toast.error("Pilih periode (harus difinalisasi/diposting)."); return; }
    const body: Record<string, unknown> = { periodId };
    if (branchId) body.branchId = branchId;
    setSaving(true);
    try {
      const res = await fetch("/api/payroll/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Run dibuat (draf), kalkulasi diantrekan."); setPeriodId(""); setBranchId(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat run.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  const columns: Column<Run>[] = [
    { header: "No. Dokumen", cell: (r) => <code className="font-mono text-xs">{r.docNo ?? "—"}</code> },
    { header: "Periode", cell: (r) => periodMap.get(r.periodId)?.name ?? "—" },
    { header: "Cabang", cell: (r) => (r.branchId ? refs.branchMap.get(r.branchId)?.name ?? "—" : "Semua") },
    { header: "Karyawan", cell: (r) => r.employeeCount ?? "—" },
    { header: "Total Bruto", cell: (r) => <span className="font-mono">{rp(r.totalEarnings)}</span> },
    { header: "Total Potongan", cell: (r) => <span className="font-mono">{rp(r.totalDeductions)}</span> },
    { header: "Total Bersih", cell: (r) => <span className="font-mono">{rp(r.totalNet)}</span> },
    { header: "Status", cell: (r) => <span className={RUN_STATUS_STYLE[r.status] ?? ""}>{RUN_STATUS_LABEL[r.status] ?? r.status}</span> },
    { header: "Aksi", className: "w-[100px]", cell: (r) => <Link href={`/payroll/runs/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Run Payroll</h1>

      <form onSubmit={onCreate} className="grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-3">
        <div className="space-y-1"><label className="text-sm font-medium">Periode *</label>
          <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">— Pilih periode —</option>
            {periods.filter((p) => p.status === "finalized" || p.status === "posted").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">— Semua cabang —</option>
            {refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Buat Run</Button></div>
      </form>
      <p className="text-xs text-zinc-500">Hanya periode berstatus <b>Difinalisasi</b> atau <b>Diposting</b> yang dapat dibuatkan run.</p>

      <div className="flex gap-2">
        <Select className="w-48" value={fPeriod} onChange={(e) => { setFPeriod(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Periode</option>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select className="w-40" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Status</option>
          {Object.entries(RUN_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <DataTable<Run> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada run payroll." />
    </div>
  );
}
