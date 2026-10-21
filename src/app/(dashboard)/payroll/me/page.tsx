"use client";

import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { rp } from "@/app/(dashboard)/payroll/_shared";

type Line = { label: string; amount: string };
type Snapshot = { periodLabel?: string; earnings?: Line[]; deductions?: Line[]; employerCosts?: Line[] };
type MyPayslip = {
  id: string; docNo: string | null; periodLabel: string;
  grossEarnings: string; totalDeductions: string; netPay: string;
  status: string; issuedAt: string | null; snapshot: Snapshot | null;
};

export default function PayrollMyPayslipsPage() {
  const [rows, setRows] = useState<MyPayslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/payroll/me/payslips", { credentials: "same-origin" })
      .then((res) => res.ok ? res.json() as Promise<{ data: MyPayslip[] }> : Promise.reject(new Error(String(res.status))))
      .then((j) => { setRows(Array.isArray(j.data) ? j.data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Payroll Saya</h1>
      <p className="text-sm text-zinc-500">Slip gaji untuk periode yang telah diposting. Hanya Anda yang dapat melihatnya.</p>

      {rows.length === 0 && <EmptyState description="Belum ada slip gaji untuk Anda." />}

      <div className="space-y-3">
        {rows.map((p) => (
          <div key={p.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">{p.periodLabel}</p>
                <p className="text-xs text-zinc-500">
                  <code className="font-mono">{p.docNo ?? "—"}</code>
                  {p.issuedAt ? ` · Terbit ${new Date(p.issuedAt).toLocaleDateString("id-ID")}` : ""}
                  {p.status !== "issued" ? " · Batal" : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-500">Take Home Pay</p>
                <p className="font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-50">{rp(p.netPay)}</p>
              </div>
            </div>
            <div className="mt-2 flex gap-6 text-sm">
              <span className="text-zinc-500">Bruto: <span className="font-mono text-zinc-900 dark:text-zinc-100">{rp(p.grossEarnings)}</span></span>
              <span className="text-zinc-500">Potongan: <span className="font-mono text-zinc-900 dark:text-zinc-100">{rp(p.totalDeductions)}</span></span>
            </div>
            {p.snapshot && ((p.snapshot.earnings?.length ?? 0) > 0 || (p.snapshot.deductions?.length ?? 0) > 0) && (
              <>
                <button className="mt-2 text-xs text-blue-600 hover:underline" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                  {openId === p.id ? "Sembunyikan rincian" : "Lihat rincian"}
                </button>
                {openId === p.id && (
                  <div className="mt-3 grid gap-4 border-t border-zinc-100 pt-3 dark:border-zinc-800 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium text-green-700 dark:text-green-400">Penerimaan</p>
                      <div className="space-y-0.5 text-sm">
                        {(p.snapshot.earnings ?? []).map((l, i) => (
                          <div key={i} className="flex justify-between"><span>{l.label}</span><span className="font-mono">{rp(l.amount)}</span></div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-red-700 dark:text-red-400">Potongan</p>
                      <div className="space-y-0.5 text-sm">
                        {(p.snapshot.deductions ?? []).map((l, i) => (
                          <div key={i} className="flex justify-between"><span>{l.label}</span><span className="font-mono">{rp(l.amount)}</span></div>
                        ))}
                        {(p.snapshot.deductions ?? []).length === 0 && <p className="text-xs text-zinc-400">Tidak ada potongan.</p>}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
