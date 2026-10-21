"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  DASH_TABS, fetchDashboard, DashboardAccessError, rp, qty, num, boolBadge,
  type DashKey, type Range,
  type ExecutiveData, type FinanceData, type CashFlowData, type SalesData,
  type PurchasingData, type InventoryData, type HrData, type PayrollData,
} from "@/app/(dashboard)/dashboard/_shared";

/* --------------------------- Primitif UI ---------------------------- */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-zinc-400">{hint}</p> : null}
    </div>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  if (rows.length === 0) return <p className="py-3 text-sm text-zinc-400">Tidak ada data.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
            {head.map((h, i) => <th key={i} className="py-2 pr-4 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
              {r.map((c, ci) => <td key={ci} className={`py-2 pr-4 ${ci > 0 ? "font-mono" : ""}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function rangeLabel(range?: Range): string {
  if (!range) return "";
  return `${range.from} → ${range.to}`;
}

/* ------------------------------ Halaman ----------------------------- */

export default function DashboardPage() {
  const refs = useHrRefs();
  const [tab, setTab] = useState<DashKey>("executive");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [branch, setBranch] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [data, setData] = useState<unknown>(null);

  useEffect(() => {
    let ignore = false;
    const load = async (): Promise<unknown> => {
      if (from && to && to < from) throw new RangeError("invalid-range");
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (branch) params.set("branchId", branch);
      return fetchDashboard(tab, params);
    };
    // Semua setState di dalam callback async (bukan di body effect).
    Promise.resolve()
      .then(() => { if (!ignore) { setLoading(true); setError(null); setNoAccess(false); } })
      .then(load)
      .then((d) => { if (!ignore) { setData(d); setLoading(false); } })
      .catch((e: unknown) => {
        if (ignore) return;
        if (e instanceof RangeError) setError("Tanggal akhir tidak boleh sebelum tanggal awal.");
        else if (e instanceof DashboardAccessError && e.status === 403) setNoAccess(true);
        else if (e instanceof DashboardAccessError) setError(`Gagal memuat (${e.status}).`);
        else setError("Koneksi terganggu.");
        setData(null); setLoading(false);
      });
    return () => { ignore = true; };
  }, [tab, from, to, branch]);

  function reset() { setFrom(""); setTo(""); setBranch(""); }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>

      {/* Filter */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="space-y-1"><label className="text-xs font-medium text-zinc-500">Tanggal Awal</label>
          <Input className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="YYYY-MM-DD" /></div>
        <div className="space-y-1"><label className="text-xs font-medium text-zinc-500">Tanggal Akhir</label>
          <Input className="w-40" value={to} onChange={(e) => setTo(e.target.value)} placeholder="YYYY-MM-DD" /></div>
        <div className="space-y-1"><label className="text-xs font-medium text-zinc-500">Cabang</label>
          <Select className="w-44" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Semua Cabang</option>
            {refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={reset}>Reset</Button>
        <p className="ml-auto self-center text-xs text-zinc-400">Kosong = bulan berjalan. Rentang memakai tanggal, bukan periode akuntansi.</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {DASH_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${tab === t.key ? "border-blue-600 font-medium text-blue-600" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size={28} /></div>
      ) : noAccess ? (
        <EmptyState title="Akses terbatas" description="Anda tidak memiliki izin untuk melihat dashboard (reporting.dashboards.read)." />
      ) : error ? (
        <Card><CardContent className="py-6 text-sm text-red-600">{error}</CardContent></Card>
      ) : data ? (
        <DashboardBody tab={tab} data={data} />
      ) : null}
    </div>
  );
}

/* ---------------------------- Per tab body -------------------------- */

function DashboardBody({ tab, data }: { tab: DashKey; data: unknown }) {
  if (tab === "executive") {
    const d = data as ExecutiveData;
    return (
      <div className="space-y-4">
        <p className="text-xs text-zinc-400">Rentang: {rangeLabel(d.range)}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Pendapatan" value={rp(d.profit.revenue)} />
          <Stat label="Beban" value={rp(d.profit.expense)} />
          <Stat label="Laba Bersih" value={rp(d.profit.netIncome)} />
          <Stat label="Total Aset" value={rp(d.position.assets)} hint={`Neraca seimbang: ${boolBadge(d.position.balanced)}`} />
          <Stat label="Kewajiban" value={rp(d.position.liabilities)} />
          <Stat label="Ekuitas" value={rp(d.position.equity)} hint={`Laba ditahan: ${rp(d.position.retainedEarnings)}`} />
          <Stat label="Piutang" value={rp(d.receivables.outstanding)} hint={`${num(d.receivables.openInvoices)} faktur terbuka`} />
          <Stat label="Utang" value={rp(d.payables.outstanding)} hint={`${num(d.payables.openInvoices)} faktur terbuka`} />
          <Stat label="Nilai Persediaan" value={rp(d.inventory.value)} hint={`Kuantitas: ${num(d.inventory.quantity)}`} />
          <Stat label="Headcount" value={num(d.headcount)} />
        </div>
      </div>
    );
  }

  if (tab === "finance") {
    const d = data as FinanceData;
    return (
      <div className="space-y-4">
        <p className="text-xs text-zinc-400">Rentang: {rangeLabel(d.range)}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Pendapatan" value={rp(d.profit.revenue)} />
          <Stat label="Beban" value={rp(d.profit.expense)} />
          <Stat label="Laba Bersih" value={rp(d.profit.netIncome)} />
          <Stat label="Total Aset" value={rp(d.position.assets)} />
          <Stat label="Kewajiban" value={rp(d.position.liabilities)} />
          <Stat label="Ekuitas" value={rp(d.position.equity)} />
          <Stat label="Neraca Saldo" value={`${num(d.trialBalance.accounts)} akun`} hint={`Debit ${rp(d.trialBalance.debit)} · Kredit ${rp(d.trialBalance.credit)} · Seimbang ${boolBadge(d.trialBalance.balanced)}`} />
          <Stat label="Arus Kas Bersih" value={rp(d.cashFlow.netChange)} hint={`Rekonsiliasi: ${boolBadge(d.cashFlow.reconciles)}`} />
        </div>
        <Card><CardHeader><CardTitle>Rincian Arus Kas</CardTitle></CardHeader>
          <CardContent><MiniTable head={["Seksi", "Bersih"]} rows={[
            ["Operasi", rp(d.cashFlow.operating)],
            ["Investasi", rp(d.cashFlow.investing)],
            ["Pendanaan", rp(d.cashFlow.financing)],
          ]} /></CardContent></Card>
      </div>
    );
  }

  if (tab === "cashflow") {
    const d = data as CashFlowData;
    const s = d.sections;
    return (
      <div className="space-y-4">
        <p className="text-xs text-zinc-400">Rentang: {rangeLabel(d.range)} · Metode: {d.method} · Rekonsiliasi: {boolBadge(d.reconciliation.reconciles)}</p>
        <Card><CardHeader><CardTitle>Arus Kas per Seksi</CardTitle></CardHeader>
          <CardContent><MiniTable head={["Seksi", "Masuk", "Keluar", "Bersih"]} rows={[
            ["Operasi", rp(s.operating.inflow), rp(s.operating.outflow), rp(s.operating.net)],
            ["Investasi", rp(s.investing.inflow), rp(s.investing.outflow), rp(s.investing.net)],
            ["Pendanaan", rp(s.financing.inflow), rp(s.financing.outflow), rp(s.financing.net)],
          ]} /></CardContent></Card>
      </div>
    );
  }

  if (tab === "sales") {
    const d = data as SalesData;
    return (
      <div className="space-y-4">
        <p className="text-xs text-zinc-400">Rentang: {rangeLabel(d.range)}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Nilai SO" value={rp(d.totals.soValue)} hint={`${num(d.totals.soCount)} pesanan`} />
          <Stat label="Nilai Faktur" value={rp(d.totals.invoiceValue)} />
          <Stat label="Pembayaran" value={rp(d.totals.paymentValue)} />
          <Stat label="Piutang" value={rp(d.totals.outstanding)} hint={`${num(d.customers)} pelanggan`} />
        </div>
        <Card><CardHeader><CardTitle>Umur Piutang</CardTitle></CardHeader>
          <CardContent><MiniTable head={["Ember", "Jumlah", "Nilai"]} rows={d.aging.buckets.map((b) => [b.label, num(b.count), rp(b.amount)])} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Pelanggan Piutang Terbesar</CardTitle></CardHeader>
          <CardContent><MiniTable head={["Kode", "Nama", "Outstanding"]} rows={d.topCustomersByOutstanding.map((c) => [c.customerCode, c.customerName, rp(c.outstanding)])} /></CardContent></Card>
      </div>
    );
  }

  if (tab === "purchasing") {
    const d = data as PurchasingData;
    return (
      <div className="space-y-4">
        <p className="text-xs text-zinc-400">Rentang: {rangeLabel(d.range)}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Nilai PO" value={rp(d.totals.poValue)} hint={`${num(d.totals.poCount)} pesanan`} />
          <Stat label="Nilai Faktur" value={rp(d.totals.invoiceValue)} />
          <Stat label="Pembayaran" value={rp(d.totals.paymentValue)} />
          <Stat label="Utang" value={rp(d.totals.outstanding)} hint={`${num(d.suppliers)} pemasok`} />
        </div>
        <Card><CardHeader><CardTitle>Umur Utang</CardTitle></CardHeader>
          <CardContent><MiniTable head={["Ember", "Jumlah", "Nilai"]} rows={d.aging.buckets.map((b) => [b.label, num(b.count), rp(b.amount)])} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Pemasok Utang Terbesar</CardTitle></CardHeader>
          <CardContent><MiniTable head={["Kode", "Nama", "Outstanding"]} rows={d.topSuppliersByOutstanding.map((c) => [c.supplierCode, c.supplierName, rp(c.outstanding)])} /></CardContent></Card>
      </div>
    );
  }

  if (tab === "inventory") {
    const d = data as InventoryData;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Nilai Persediaan" value={rp(d.valuation.value)} hint={`${num(d.valuation.lines)} baris`} />
          <Stat label="Kuantitas Total" value={num(d.valuation.quantity)} />
          <Stat label="Stok Menipis" value={num(d.lowStock.count)} hint={`Habis dekat: ${num(d.nearExpiry.count)}`} />
        </div>
        <Card><CardHeader><CardTitle>Stok Menipis (butuh pesan)</CardTitle></CardHeader>
          <CardContent><MiniTable head={["SKU", "Produk", "On Hand", "Reorder Point", "Saran"]} rows={d.lowStock.items.map((i) => [i.productSku, i.productName, qty(i.onHand), qty(i.reorderPoint), qty(i.suggestedQuantity)])} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Nilai Persediaan Terbesar</CardTitle></CardHeader>
          <CardContent><MiniTable head={["SKU", "Produk", "Gudang", "Nilai"]} rows={d.valuation.topByValue.map((i) => [i.productSku, i.productName, i.warehouseCode, rp(i.value)])} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Menjelang Kedaluwarsa ({d.nearExpiry.horizon} hari)</CardTitle></CardHeader>
          <CardContent><MiniTable head={["SKU", "Produk", "Gudang", "Tgl. ED", "Sisa"]} rows={d.nearExpiry.items.map((i) => [i.productSku, i.productName, i.warehouseCode, i.expiryDate, qty(i.remaining)])} /></CardContent></Card>
      </div>
    );
  }

  if (tab === "hr") {
    const d = data as HrData;
    return (
      <div className="space-y-4">
        <p className="text-xs text-zinc-400">Rentang: {rangeLabel(d.range)}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Headcount" value={num(d.headcount.total)} hint={`${num(d.headcount.departments)} departemen`} />
          <Stat label="Catatan Absensi" value={num(d.attendance.records)} hint={`${num(d.attendance.employees)} karyawan`} />
          <Stat label="Menit Lembur" value={num(d.attendance.overtimeMinutes)} />
          <Stat label="Sisa Cuti" value={num(d.leaveBalances.totalRemaining)} hint={`Tahun ${d.leaveBalances.year} · ${num(d.leaveBalances.employees)} karyawan`} />
        </div>
      </div>
    );
  }

  // payroll
  const d = data as PayrollData;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Karyawan" value={num(d.totals.employeeCount)} hint={`${num(d.departments)} departemen`} />
        <Stat label="Gaji Kotor" value={rp(d.totals.grossEarnings)} />
        <Stat label="Pajak" value={rp(d.totals.tax)} />
        <Stat label="Gaji Bersih" value={rp(d.totals.netPay)} hint={`Total biaya: ${rp(d.totals.totalCost)}`} />
      </div>
      <Card><CardHeader><CardTitle>Biaya Payroll per Departemen</CardTitle></CardHeader>
        <CardContent><MiniTable head={["Kode", "Departemen", "Karyawan", "Total Biaya"]} rows={d.topByTotalCost.map((r) => [r.departmentCode, r.departmentName, num(r.employeeCount), rp(r.totalCost)])} /></CardContent></Card>
    </div>
  );
}
