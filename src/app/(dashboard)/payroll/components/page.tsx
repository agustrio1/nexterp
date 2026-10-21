"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CODE_RE,
  COMPONENT_KIND_LABEL,
  COMPONENT_BASIS_LABEL,
  STATUTORY_KIND_LABEL,
} from "@/app/(dashboard)/payroll/_shared";

type Component = {
  id: string; code: string; name: string; kind: string; basis: string;
  statutoryKind: string | null; orderNo: number | null;
  includeInTaxBase: boolean; includeInBpjsBase: boolean; isActive: boolean;
};

const KINDS = ["earning", "deduction"] as const;
const BASES = ["fixed", "percentage_of_base", "statutory", "attendance"] as const;
const STATUTORY_KINDS = ["pph21", "bpjs_kesehatan", "bpjs_jht", "bpjs_jp", "bpjs_kk", "bpjs_jkm", "other"] as const;

export default function PayrollComponentsPage() {
  const [isActive, setIsActive] = useState("");
  const [kind, setKind] = useState("");
  const [rk, setRk] = useState(0);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nKind, setNKind] = useState<string>("earning");
  const [nBasis, setNBasis] = useState<string>("fixed");
  const [nStatKind, setNStatKind] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [taxBase, setTaxBase] = useState(false);
  const [bpjsBase, setBpjsBase] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState("earning");
  const [editBasis, setEditBasis] = useState("fixed");
  const [editStatKind, setEditStatKind] = useState("");
  const [editOrder, setEditOrder] = useState("");
  const [editTax, setEditTax] = useState(false);
  const [editBpjs, setEditBpjs] = useState(false);
  const [editActive, setEditActive] = useState(true);
  const [editing, setEditing] = useState(false);

  const params = new URLSearchParams();
  if (isActive) params.set("isActive", isActive);
  if (kind) params.set("kind", kind);
  const qs = params.toString();
  const url = qs ? `/api/payroll/components?${qs}` : "/api/payroll/components";

  function startEdit(c: Component) {
    setEditId(c.id);
    setEditName(c.name);
    setEditKind(c.kind);
    setEditBasis(c.basis);
    setEditStatKind(c.statutoryKind ?? "");
    setEditOrder(c.orderNo === null ? "" : String(c.orderNo));
    setEditTax(c.includeInTaxBase);
    setEditBpjs(c.includeInBpjsBase);
    setEditActive(c.isActive);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code.trim().toUpperCase())) { toast.error("Kode 2-20 karakter huruf/angka/strip, diawali huruf/angka."); return; }
    if (name.trim().length < 2) { toast.error("Nama komponen minimal 2 karakter."); return; }
    if (orderNo && !/^\d+$/.test(orderNo)) { toast.error("Urutan harus bilangan bulat."); return; }
    const body: Record<string, unknown> = {
      code: code.trim().toUpperCase(), name: name.trim(), kind: nKind, basis: nBasis,
      includeInTaxBase: taxBase, includeInBpjsBase: bpjsBase,
    };
    if (nStatKind) body.statutoryKind = nStatKind;
    if (orderNo) body.orderNo = Number(orderNo);
    setSaving(true);
    try {
      const res = await fetch("/api/payroll/components", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { toast.success("Komponen dibuat."); setCode(""); setName(""); setNStatKind(""); setOrderNo(""); setTaxBase(false); setBpjsBase(false); setRk((k) => k + 1); }
      else toast.error(j?.error?.message ?? "Gagal membuat komponen.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onEdit() {
    if (!editId) return;
    if (editOrder && !/^\d+$/.test(editOrder)) { toast.error("Urutan harus bilangan bulat."); return; }
    const body: Record<string, unknown> = {
      name: editName.trim(), kind: editKind, basis: editBasis,
      includeInTaxBase: editTax, includeInBpjsBase: editBpjs, isActive: editActive,
      statutoryKind: editStatKind || null, orderNo: editOrder === "" ? null : Number(editOrder),
    };
    setEditing(true);
    try {
      const res = await fetch(`/api/payroll/components/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { toast.success("Komponen diperbarui."); setEditId(null); setRk((k) => k + 1); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setEditing(false); }
  }

  const columns: Column<Component>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => r.name },
    { header: "Jenis", cell: (r) => COMPONENT_KIND_LABEL[r.kind] ?? r.kind },
    { header: "Basis", cell: (r) => COMPONENT_BASIS_LABEL[r.basis] ?? r.basis },
    { header: "Statutory", cell: (r) => (r.statutoryKind ? STATUTORY_KIND_LABEL[r.statutoryKind] ?? r.statutoryKind : "—") },
    { header: "Objek Pajak", cell: (r) => (r.includeInTaxBase ? "Ya" : "—") },
    { header: "Objek BPJS", cell: (r) => (r.includeInBpjsBase ? "Ya" : "—") },
    { header: "Urutan", cell: (r) => r.orderNo ?? "—" },
    { header: "Status", cell: (r) => (r.isActive ? <span className="text-green-700 dark:text-green-400">Aktif</span> : <span className="text-zinc-400">Nonaktif</span>) },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Ubah</Button> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Komponen Gaji</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BASIC" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Nama *</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Jenis *</label>
          <Select value={nKind} onChange={(e) => setNKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{COMPONENT_KIND_LABEL[k]}</option>)}</Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Basis *</label>
          <Select value={nBasis} onChange={(e) => setNBasis(e.target.value)}>{BASES.map((b) => <option key={b} value={b}>{COMPONENT_BASIS_LABEL[b]}</option>)}</Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Kategori Statutory</label>
          <Select value={nStatKind} onChange={(e) => setNStatKind(e.target.value)}>
            <option value="">— Bukan statutory —</option>
            {STATUTORY_KINDS.map((s) => <option key={s} value={s}>{STATUTORY_KIND_LABEL[s]}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Urutan</label><Input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="1" /></div>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={taxBase} onChange={(e) => setTaxBase(e.target.checked)} /> Objek Pajak</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bpjsBase} onChange={(e) => setBpjsBase(e.target.checked)} /> Objek BPJS</label>
        </div>
        <div className="flex items-end"><Button type="submit" loading={saving}>Tambah</Button></div>
      </form>

      {editId && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Nama</label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Jenis</label>
            <Select value={editKind} onChange={(e) => setEditKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{COMPONENT_KIND_LABEL[k]}</option>)}</Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Basis</label>
            <Select value={editBasis} onChange={(e) => setEditBasis(e.target.value)}>{BASES.map((b) => <option key={b} value={b}>{COMPONENT_BASIS_LABEL[b]}</option>)}</Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Kategori Statutory</label>
            <Select value={editStatKind} onChange={(e) => setEditStatKind(e.target.value)}>
              <option value="">— Bukan statutory —</option>
              {STATUTORY_KINDS.map((s) => <option key={s} value={s}>{STATUTORY_KIND_LABEL[s]}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Urutan</label><Input value={editOrder} onChange={(e) => setEditOrder(e.target.value)} /></div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editTax} onChange={(e) => setEditTax(e.target.checked)} /> Objek Pajak</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editBpjs} onChange={(e) => setEditBpjs(e.target.checked)} /> Objek BPJS</label>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} /> Aktif</label>
            <div className="flex gap-2"><Button size="sm" loading={editing} onClick={onEdit}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Batal</Button></div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Select className="w-36" value={isActive} onChange={(e) => { setIsActive(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Aktif</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
        <Select className="w-40" value={kind} onChange={(e) => { setKind(e.target.value); setRk((k) => k + 1); }}>
          <option value="">Semua Jenis</option><option value="earning">Penerimaan</option><option value="deduction">Potongan</option>
        </Select>
      </div>
      <DataTable<Component> key={rk} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada komponen gaji." />
    </div>
  );
}
