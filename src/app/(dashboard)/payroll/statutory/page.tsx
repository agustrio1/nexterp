"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CODE_RE, AMOUNT_RE, RATE_RE,
  STATUTORY_KIND_LABEL, PARTY_LABEL, rp,
} from "@/app/(dashboard)/payroll/_shared";

type Rule = {
  id: string; code: string; kind: string; party: string; name: string;
  rate: string | null; flatAmount: string | null; wageCap: string | null;
  belowWageCap: boolean | null; source: string; effectiveFrom: string;
  isActive: boolean; notes: string | null;
};

const KINDS = ["pph21", "bpjs_kesehatan", "bpjs_jht", "bpjs_jp", "bpjs_kk", "bpjs_jkm", "other"] as const;
const PARTIES = ["employee", "employer", "both"] as const;

export default function PayrollStatutoryPage() {
  const [isActive, setIsActive] = useState("");
  const [fKind, setFKind] = useState("");
  const [rk, setRk] = useState(0);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("pph21");
  const [party, setParty] = useState<string>("employee");
  const [rate, setRate] = useState("");
  const [flatAmount, setFlatAmount] = useState("");
  const [wageCap, setWageCap] = useState("");
  const [source, setSource] = useState("");
  const [effFrom, setEffFrom] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eKind, setEKind] = useState("pph21");
  const [eParty, setEParty] = useState("employee");
  const [eRate, setERate] = useState("");
  const [eFlat, setEFlat] = useState("");
  const [eCap, setECap] = useState("");
  const [eSource, setESource] = useState("");
  const [eActive, setEActive] = useState(true);
  const [editing, setEditing] = useState(false);

  const params = new URLSearchParams();
  if (isActive) params.set("isActive", isActive);
  if (fKind) params.set("kind", fKind);
  const qs = params.toString();
  const url = qs ? `/api/payroll/statutory?${qs}` : "/api/payroll/statutory";

  function startEdit(r: Rule) {
    setEditId(r.id);
    setEName(r.name); setEKind(r.kind); setEParty(r.party);
    setERate(r.rate ?? ""); setEFlat(r.flatAmount ?? ""); setECap(r.wageCap ?? "");
    setESource(r.source); setEActive(r.isActive);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code.trim().toUpperCase())) { toast.error("Kode aturan 2-20 karakter huruf/angka/strip."); return; }
    if (name.trim().length < 2) { toast.error("Nama aturan minimal 2 karakter."); return; }
    if (!source.trim() || source.trim().length < 3) { toast.error("Sumber regulasi wajib (min 3 karakter)."); return; }
    if (!effFrom) { toast.error("Tanggal berlaku wajib diisi."); return; }
    if (rate && !RATE_RE.test(rate)) { toast.error("Tarif tidak valid (maks 5 digit, 4 desimal)."); return; }
    if (flatAmount && !AMOUNT_RE.test(flatAmount)) { toast.error("Nominal tetap tidak valid."); return; }
    if (wageCap && !AMOUNT_RE.test(wageCap)) { toast.error("Batas upah tidak valid."); return; }
    const body: Record<string, unknown> = { code: code.trim().toUpperCase(), name: name.trim(), kind, party, source: source.trim(), effectiveFrom: effFrom };
    if (rate) body.rate = rate;
    if (flatAmount) body.flatAmount = flatAmount;
    if (wageCap) body.wageCap = wageCap;
    setSaving(true);
    try {
      const res = await fetch("/api/payroll/statutory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Aturan statutory dibuat."); setCode(""); setName(""); setRate(""); setFlatAmount(""); setWageCap(""); setSource(""); setEffFrom(""); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat aturan.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onEdit() {
    if (!editId) return;
    if (eRate && !RATE_RE.test(eRate)) { toast.error("Tarif tidak valid."); return; }
    if (eFlat && !AMOUNT_RE.test(eFlat)) { toast.error("Nominal tetap tidak valid."); return; }
    if (eCap && !AMOUNT_RE.test(eCap)) { toast.error("Batas upah tidak valid."); return; }
    const body: Record<string, unknown> = { name: eName.trim(), kind: eKind, party: eParty, source: eSource.trim(), isActive: eActive };
    body.rate = eRate || null;
    body.flatAmount = eFlat || null;
    body.wageCap = eCap || null;
    setEditing(true);
    try {
      const res = await fetch(`/api/payroll/statutory/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Aturan diperbarui."); setEditId(null); setRk((k) => k + 1); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  const columns: Column<Rule>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Kategori", cell: (r) => STATUTORY_KIND_LABEL[r.kind] ?? r.kind },
    { header: "Pihak", cell: (r) => PARTY_LABEL[r.party] ?? r.party },
    { header: "Tarif", cell: (r) => r.rate ? `${r.rate}%` : "—" },
    { header: "Nominal", cell: (r) => r.flatAmount ? rp(r.flatAmount) : "—" },
    { header: "Batas Upah", cell: (r) => r.wageCap ? rp(r.wageCap) : "—" },
    { header: "Berlaku", cell: (r) => r.effectiveFrom.slice(0, 10) },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    {
      header: "Aksi", className: "w-[150px]", cell: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Ubah</Button>
          <Link href={`/payroll/statutory/${r.id}`}><Button variant="ghost" size="sm">Bracket</Button></Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Aturan Statutory</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PPH21-TER" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Kategori *</label>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{STATUTORY_KIND_LABEL[k]}</option>)}</Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Pihak *</label>
          <Select value={party} onChange={(e) => setParty(e.target.value)}>{PARTIES.map((p) => <option key={p} value={p}>{PARTY_LABEL[p]}</option>)}</Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Tarif (%)</label><Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="mis. 5" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nominal Tetap</label><Input value={flatAmount} onChange={(e) => setFlatAmount(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Batas Upah</label><Input value={wageCap} onChange={(e) => setWageCap(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Berlaku Tanggal *</label><Input type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} /></div>
        <div className="space-y-1 sm:col-span-3"><label className="text-sm font-medium">Sumber Regulasi *</label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="mis. PP 55/2022" /></div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      {editId && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama</label><Input value={eName} onChange={(e) => setEName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Kategori</label>
            <Select value={eKind} onChange={(e) => setEKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{STATUTORY_KIND_LABEL[k]}</option>)}</Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Pihak</label>
            <Select value={eParty} onChange={(e) => setEParty(e.target.value)}>{PARTIES.map((p) => <option key={p} value={p}>{PARTY_LABEL[p]}</option>)}</Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Tarif (%)</label><Input value={eRate} onChange={(e) => setERate(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nominal Tetap</label><Input value={eFlat} onChange={(e) => setEFlat(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Batas Upah</label><Input value={eCap} onChange={(e) => setECap(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Sumber</label><Input value={eSource} onChange={(e) => setESource(e.target.value)} /></div>
          <div className="flex flex-col gap-2 sm:col-span-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={eActive} onChange={(e) => setEActive(e.target.checked)} /> Aktif</label>
            <div className="flex gap-2"><Button size="sm" loading={editing} onClick={onEdit}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Select className="w-36" value={isActive} onChange={(e) => { setIsActive(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Aktif</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
        <Select className="w-48" value={fKind} onChange={(e) => { setFKind(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Kategori</option>
          {KINDS.map((k) => <option key={k} value={k}>{STATUTORY_KIND_LABEL[k]}</option>)}
        </Select>
      </div>
      <DataTable<Rule> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada aturan statutory." />
    </div>
  );
}
