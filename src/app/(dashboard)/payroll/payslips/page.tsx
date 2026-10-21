"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import { rp } from "@/app/(dashboard)/payroll/_shared";

type Payslip = {
  id: string; docNo: string | null; employeeCode: string; employeeName: string;
  periodLabel: string; grossEarnings: string; totalDeductions: string; netPay: string;
  status: string; issuedAt: string | null; reason: string | null;
};

export default function PayrollPayslipsPage() {
  const refs = useHrRefs();
  const [fEmp, setFEmp] = useState("");
  const [rk, setRk] = useState(0);

  const [voidId, setVoidId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const params = new URLSearchParams();
  if (fEmp) params.set("employeeId", fEmp);
  const qs = params.toString();
  const url = qs ? `/api/payroll/payslips?${qs}` : "/api/payroll/payslips";

  async function submitVoid() {
    if (!voidId) return;
    if (reason.trim().length < 3) { toast.error("Alasan minimal 3 karakter."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/payroll/payslips/${voidId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Slip dibatalkan."); setVoidId(null); setReason(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membatalkan slip.");
    } catch { toast.error("Koneksi terganggu."); } finally { setBusy(false); }
  }

  const columns: Column<Payslip>[] = [
    { header: "No. Dokumen", cell: (r) => <code className="font-mono text-xs">{r.docNo ?? "—"}</code> },
    { header: "Karyawan", cell: (r) => `${r.employeeName} (${r.employeeCode})` },
    { header: "Periode", cell: (r) => r.periodLabel },
    { header: "Bruto", cell: (r) => <span className="font-mono">{rp(r.grossEarnings)}</span> },
    { header: "Potongan", cell: (r) => <span className="font-mono">{rp(r.totalDeductions)}</span> },
    { header: "Bersih", cell: (r) => <span className="font-mono font-medium">{rp(r.netPay)}</span> },
    { header: "Terbit", cell: (r) => (r.issuedAt ? new Date(r.issuedAt).toLocaleDateString("id-ID") : "—") },
    { header: "Status", cell: (r) => (r.status === "issued" ? <span className="text-green-700 dark:text-green-400">Terbit</span> : <span className="text-red-600">Batal{r.reason ? ` (${r.reason})` : ""}</span>) },
    {
      header: "Aksi", className: "w-[110px]", cell: (r) => (
        r.status === "issued"
          ? <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setVoidId(r.id); setReason(""); }}>Batalkan</Button>
          : null
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Slip Gaji</h1>

      {voidId && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="min-w-[240px] flex-1 space-y-1">
            <label className="text-sm font-medium">Alasan pembatalan slip *</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Minimal 3 karakter" />
          </div>
          <Button size="sm" loading={busy} onClick={submitVoid}>Konfirmasi</Button>
          <Button size="sm" variant="ghost" onClick={() => setVoidId(null)}>Batal</Button>
        </div>
      )}

      <div className="flex gap-2">
        <Select className="w-56" value={fEmp} onChange={(e) => { setFEmp(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Karyawan</option>
          {refs.employees.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
        </Select>
      </div>
      <DataTable<Payslip> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada slip gaji." />
    </div>
  );
}
