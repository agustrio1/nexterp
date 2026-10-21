"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CODE_RE, PAY_FREQUENCY_LABEL } from "@/app/(dashboard)/payroll/_shared";

type Structure = {
  id: string; code: string; name: string; payFrequency: string; isActive: boolean;
};

const FREQS = ["monthly", "bimonthly", "weekly"] as const;

export default function PayrollStructuresPage() {
  const [isActive, setIsActive] = useState("");
  const [rk, setRk] = useState(0);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [freq, setFreq] = useState<string>("monthly");
  const [saving, setSaving] = useState(false);

  const params = new URLSearchParams();
  if (isActive) params.set("isActive", isActive);
  const qs = params.toString();
  const url = qs ? `/api/payroll/structures?${qs}` : "/api/payroll/structures";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code.trim().toUpperCase())) { toast.error("Kode struktur 2-20 karakter huruf/angka/strip."); return; }
    if (name.trim().length < 2) { toast.error("Nama struktur minimal 2 karakter."); return; }
    const body: Record<string, unknown> = { code: code.trim().toUpperCase(), name: name.trim(), payFrequency: freq };
    setSaving(true);
    try {
      const res = await fetch("/api/payroll/structures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Struktur dibuat."); setCode(""); setName(""); setFreq("monthly"); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat struktur.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  const columns: Column<Structure>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Frekuensi", cell: (r) => PAY_FREQUENCY_LABEL[r.payFrequency] ?? r.payFrequency },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[120px]", cell: (r) => <Link href={`/payroll/structures/${r.id}`}><Button variant="ghost" size="sm">Kelola Komponen</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Struktur Gaji</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="STR-01" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Frekuensi *</label>
          <Select value={freq} onChange={(e) => setFreq(e.target.value)}>{FREQS.map((f) => <option key={f} value={f}>{PAY_FREQUENCY_LABEL[f]}</option>)}</Select>
        </div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      <div className="flex gap-2">
        <Select className="w-36" value={isActive} onChange={(e) => { setIsActive(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Aktif</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
      </div>
      <DataTable<Structure> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada struktur gaji." />
    </div>
  );
}
