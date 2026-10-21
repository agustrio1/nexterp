"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  CODE_RE, PERIOD_STATUS_LABEL, PERIOD_STATUS_STYLE,
} from "@/app/(dashboard)/payroll/_shared";

type Period = {
  id: string; code: string; name: string; periodStart: string; periodEnd: string;
  branchId: string | null; status: string;
};

function PeriodStatusBadge({ status }: { status: string }) {
  return (
    <span className={PERIOD_STATUS_STYLE[status] ?? ""}>{PERIOD_STATUS_LABEL[status] ?? status}</span>
  );
}

export default function PayrollPeriodsPage() {
  const refs = useHrRefs();
  const [fStatus, setFStatus] = useState("");
  const [rk, setRk] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [branchId, setBranchId] = useState("");
  const [saving, setSaving] = useState(false);

  const params = new URLSearchParams();
  if (fStatus) params.set("status", fStatus);
  const qs = params.toString();
  const url = qs ? `/api/payroll/periods?${qs}` : "/api/payroll/periods";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code.trim().toUpperCase())) { toast.error("Kode periode 2-20 karakter huruf/angka/strip."); return; }
    if (name.trim().length < 2) { toast.error("Nama periode minimal 2 karakter."); return; }
    if (!start || !end) { toast.error("Tanggal mulai/selesai wajib diisi."); return; }
    const body: Record<string, unknown> = { code: code.trim().toUpperCase(), name: name.trim(), periodStart: start, periodEnd: end };
    if (branchId) body.branchId = branchId;
    setSaving(true);
    try {
      const res = await fetch("/api/payroll/periods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Periode dibuat (draf)."); setCode(""); setName(""); setStart(""); setEnd(""); setBranchId(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat periode.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onAction(id: string, action: "finalize" | "close", okMsg: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/payroll/periods/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success(okMsg); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal memproses.");
    } catch { toast.error("Koneksi terganggu."); } finally { setBusyId(null); }
  }

  const columns: Column<Period>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Mulai", cell: (r) => r.periodStart.slice(0, 10) },
    { header: "Selesai", cell: (r) => r.periodEnd.slice(0, 10) },
    { header: "Cabang", cell: (r) => (r.branchId ? refs.branchMap.get(r.branchId)?.name ?? "—" : "Semua") },
    { header: "Status", cell: (r) => <PeriodStatusBadge status={r.status} /> },
    {
      header: "Aksi", className: "w-[180px]", cell: (r) => (
        <div className="flex gap-1">
          {r.status === "draft" && <Button size="sm" variant="outline" loading={busyId === r.id} onClick={() => void onAction(r.id, "finalize", "Periode difinalisasi.")}>Finalisasi</Button>}
          {r.status === "posted" && <Button size="sm" variant="outline" loading={busyId === r.id} onClick={() => void onAction(r.id, "close", "Periode ditutup.")}>Tutup</Button>}
        </div>
      ),
    },
  ];

  const allBranches = refs.branches;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Periode Payroll</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-5">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="2026-01" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Januari 2026" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Mulai *</label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Selesai *</label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">— Semua cabang —</option>
            {allBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div className="flex items-end sm:col-span-5"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      <div className="flex gap-2">
        <Select className="w-44" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Status</option>
          <option value="draft">Draf</option><option value="finalized">Difinalisasi</option>
          <option value="posted">Diposting</option><option value="closed">Ditutup</option>
        </Select>
      </div>
      <DataTable<Period> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada periode payroll." />
    </div>
  );
}
