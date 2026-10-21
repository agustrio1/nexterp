"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  fetchAllComponents,
  COMPONENT_KIND_LABEL, PAY_FREQUENCY_LABEL,
  type ComponentRef,
} from "@/app/(dashboard)/payroll/_shared";

type StructureComponent = { componentId: string; code: string; name: string; kind: string; orderNo: number | null };
type StructureDetail = {
  id: string; code: string; name: string; payFrequency: string; isActive: boolean;
  components: StructureComponent[];
};

const FREQS = ["monthly", "bimonthly", "weekly"] as const;

export default function PayrollStructureDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [structure, setStructure] = useState<StructureDetail | null>(null);
  const [allComponents, setAllComponents] = useState<ComponentRef[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [freq, setFreq] = useState("monthly");
  const [isActive, setIsActive] = useState(true);
  const [savingMeta, setSavingMeta] = useState(false);
  const [savingComp, setSavingComp] = useState(false);

  useEffect(() => {
    void fetchAllComponents().then(setAllComponents);
    fetch(`/api/payroll/structures/${id}`, { credentials: "same-origin" })
      .then((res) => res.ok ? res.json() as Promise<{ data: StructureDetail }> : Promise.reject(new Error(String(res.status))))
      .then((j) => {
        setStructure(j.data);
        setName(j.data.name);
        setFreq(j.data.payFrequency);
        setIsActive(j.data.isActive);
        setSelected(new Set(j.data.components.map((c) => c.componentId)));
        setLoading(false);
      })
      .catch(() => { toast.error("Gagal memuat struktur."); setLoading(false); });
  }, [id]);

  async function saveMeta() {
    if (!structure) return;
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/payroll/structures/${structure.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), payFrequency: freq, isActive }), credentials: "same-origin" });
      if (res.ok) { toast.success("Struktur diperbarui."); setStructure((s) => (s ? { ...s, name: name.trim(), payFrequency: freq, isActive } : s)); }
      else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal memperbarui."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSavingMeta(false); }
  }

  async function saveComponents() {
    if (!structure) return;
    if (selected.size === 0) { toast.error("Pilih minimal satu komponen."); return; }
    setSavingComp(true);
    try {
      const res = await fetch(`/api/payroll/structures/${structure.id}/components`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ componentIds: Array.from(selected) }), credentials: "same-origin" });
      if (res.ok) {
        toast.success("Komponen struktur diperbarui.");
        const j = (await res.json()) as { data: { components?: { componentId: string }[] } };
        if (j.data.components) setSelected(new Set(j.data.components.map((c) => c.componentId)));
      } else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal menyimpan komponen."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSavingComp(false); }
  }

  function toggle(cid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid); else next.add(cid);
      return next;
    });
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!structure) return <p className="text-zinc-500">Struktur tidak ditemukan.</p>;

  return (
    <div className="space-y-4">
      <Link href="/payroll/structures" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Struktur Gaji
      </Link>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Struktur: <code className="font-mono">{structure.code}</code></h1>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Nama</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Frekuensi</label>
          <Select value={freq} onChange={(e) => setFreq(e.target.value)}>{FREQS.map((f) => <option key={f} value={f}>{PAY_FREQUENCY_LABEL[f]}</option>)}</Select>
        </div>
        <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label></div>
        <div className="flex items-end"><Button loading={savingMeta} onClick={() => void saveMeta()}>Simpan</Button></div>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Komponen ({selected.size})</h2>
          <Button size="sm" loading={savingComp} onClick={() => void saveComponents()}>Simpan Komponen</Button>
        </div>
        {allComponents.length === 0 && <p className="text-sm text-zinc-500">Belum ada komponen. Buat di menu Komponen Gaji.</p>}
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {allComponents.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded border border-zinc-100 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
              <span className="flex-1">{c.name} <code className="font-mono text-xs text-zinc-500">({c.code})</code></span>
              <span className="text-xs text-zinc-400">{COMPONENT_KIND_LABEL[c.kind] ?? c.kind}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
