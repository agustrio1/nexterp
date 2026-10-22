"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Unit = { id: string; code: string; name: string };
type Conv = {
  id: string; fromUnitId: string; fromUnitCode: string; fromUnitName: string;
  toUnitId: string; toUnitCode: string; toUnitName: string; ratio: string; note: string | null;
};

const RATIO_RE = /^\d{1,12}(\.\d{1,6})?$/;
const isPositiveRatio = (v: string): boolean => RATIO_RE.test(v) && /[1-9]/.test(v.replace(".", ""));

async function readError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Gagal (${res.status}).`;
}

export default function UnitConversionsPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [rows, setRows] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(true);

  const [fromUnitId, setFromUnitId] = useState("");
  const [toUnitId, setToUnitId] = useState("");
  const [ratio, setRatio] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [uRes, cRes] = await Promise.all([
        fetch("/api/units?isActive=true", { credentials: "same-origin" }),
        fetch("/api/unit-conversions", { credentials: "same-origin" }),
      ]);
      const uj = (uRes.ok ? await uRes.json() : { data: [] }) as { data?: Unit[] };
      setUnits(uj.data ?? []);
      if (!cRes.ok) throw new Error();
      const cj = (await cRes.json()) as { data?: Conv[] };
      setRows(cj.data ?? []);
    } catch { toast.error("Gagal memuat konversi satuan."); } finally { setLoading(false); }
  }

  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => { if (!ignore) void load(); });
    return () => { ignore = true; };
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!fromUnitId || !toUnitId) { toast.error("Pilih satuan asal & tujuan."); return; }
    if (fromUnitId === toUnitId) { toast.error("Satuan asal & tujuan tidak boleh sama."); return; }
    if (!isPositiveRatio(ratio)) { toast.error("Rasio harus > 0 (maks 12 digit, 6 desimal)."); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { fromUnitId, toUnitId, ratio };
      if (note.trim()) body.note = note.trim();
      const res = await fetch("/api/unit-conversions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), credentials: "same-origin",
      });
      if (res.ok) { toast.success("Konversi dibuat."); setRatio(""); setNote(""); await load(); }
      else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Konversi Satuan</h1>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Satuan asal *</label>
          <Select value={fromUnitId} onChange={(e) => setFromUnitId(e.target.value)}>
            <option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
          </Select></div>
        <div className="space-y-1"><label className="text-sm font-medium">Satuan tujuan *</label>
          <Select value={toUnitId} onChange={(e) => setToUnitId(e.target.value)}>
            <option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
          </Select></div>
        <div className="space-y-1"><label className="text-sm font-medium">Rasio *</label>
          <Input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="mis. 12.000000" /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Catatan</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex items-end gap-2 sm:col-span-4">
          <Button type="submit" loading={saving}>Simpan</Button>
        </div>
        <p className="text-xs text-zinc-500 sm:col-span-4">
          Rasio = jumlah satuan asal untuk 1 satuan tujuan (mis. 1 dus = 12 pcs → rasio 12, asal pcs, tujuan dus).
        </p>
      </form>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">Belum ada konversi satuan.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Dari</th><th className="px-3 py-2">Ke</th>
                <th className="px-3 py-2 text-right">Rasio</th><th className="px-3 py-2">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2">{c.fromUnitCode} — {c.fromUnitName}</td>
                  <td className="px-3 py-2">{c.toUnitCode} — {c.toUnitName}</td>
                  <td className="px-3 py-2 text-right font-mono">{c.ratio}</td>
                  <td className="px-3 py-2 text-xs">{c.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
