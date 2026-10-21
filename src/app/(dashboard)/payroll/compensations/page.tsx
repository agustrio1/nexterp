"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import {
  fetchStructures, fetchComponents, toMap, rp, AMOUNT_RE, RATE_RE,
  PAY_FREQUENCY_LABEL,
  type StructureRef, type ComponentRef,
} from "@/app/(dashboard)/payroll/_shared";

type Compensation = { id: string; employeeId: string; structureId: string | null; baseSalary: string; effectiveFrom: string };
type ComponentValue = { id: string; employeeId: string; componentId: string; amount: string | null; percentValue: string | null; effectiveFrom: string };

async function getArr<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) return [];
  const j = (await res.json()) as { data?: T[] };
  return Array.isArray(j.data) ? j.data : [];
}

export default function PayrollCompensationsPage() {
  const refs = useHrRefs();
  const [structures, setStructures] = useState<StructureRef[]>([]);
  const [components, setComponents] = useState<ComponentRef[]>([]);
  const [emp, setEmp] = useState("");

  const [comps, setComps] = useState<Compensation[]>([]);
  const [values, setValues] = useState<ComponentValue[]>([]);
  const [loading, setLoading] = useState(false);

  // gaji pokok form
  const [structureId, setStructureId] = useState("");
  const [baseSalary, setBaseSalary] = useState("");
  const [compEff, setCompEff] = useState("");
  const [savingComp, setSavingComp] = useState(false);

  // nilai komponen form
  const [componentId, setComponentId] = useState("");
  const [cvAmount, setCvAmount] = useState("");
  const [cvPercent, setCvPercent] = useState("");
  const [cvEff, setCvEff] = useState("");
  const [savingVal, setSavingVal] = useState(false);

  useEffect(() => {
    void fetchStructures().then(setStructures);
    void fetchComponents().then(setComponents);
  }, []);

  const structMap = toMap(structures);
  const compMap = toMap(components);

  // Dimuat saat karyawan dipilih (handler event, bukan effect) untuk menghindari
  // setState sinkron di dalam body effect.
  function loadEmployeeData(id: string) {
    if (!id) { setComps([]); setValues([]); return; }
    setLoading(true);
    Promise.all([
      getArr<Compensation>(`/api/payroll/compensations?employeeId=${id}`),
      getArr<ComponentValue>(`/api/payroll/component-values?employeeId=${id}`),
    ])
      .then(([c, v]) => { setComps(c); setValues(v); setLoading(false); })
      .catch(() => setLoading(false));
  }

  function onSelectEmployee(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setEmp(id);
    setStructureId(""); setBaseSalary(""); setCompEff("");
    setComponentId(""); setCvAmount(""); setCvPercent(""); setCvEff("");
    loadEmployeeData(id);
  }

  async function onSaveCompensation(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) { toast.error("Pilih karyawan."); return; }
    if (!AMOUNT_RE.test(baseSalary)) { toast.error("Gaji pokok tidak valid (maks 16 digit, 2 desimal)."); return; }
    if (!compEff) { toast.error("Tanggal berlaku wajib diisi."); return; }
    const body: Record<string, unknown> = { employeeId: emp, baseSalary, effectiveFrom: compEff };
    if (structureId) body.structureId = structureId;
    setSavingComp(true);
    try {
      const res = await fetch("/api/payroll/compensations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) {
        toast.success("Gaji pokok disimpan."); setBaseSalary(""); setCompEff("");
        setComps(await getArr<Compensation>(`/api/payroll/compensations?employeeId=${emp}`));
      } else toast.error(j?.error?.message ?? "Gagal menyimpan gaji pokok.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSavingComp(false); }
  }

  async function onSaveValue(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) { toast.error("Pilih karyawan."); return; }
    if (!componentId) { toast.error("Pilih komponen."); return; }
    if (!cvEff) { toast.error("Tanggal berlaku wajib diisi."); return; }
    if (!cvAmount && !cvPercent) { toast.error("Isi nominal atau persentase."); return; }
    if (cvAmount && !AMOUNT_RE.test(cvAmount)) { toast.error("Nominal tidak valid."); return; }
    if (cvPercent && !RATE_RE.test(cvPercent)) { toast.error("Persentase tidak valid (maks 5 digit, 4 desimal)."); return; }
    const body: Record<string, unknown> = { employeeId: emp, componentId, effectiveFrom: cvEff };
    if (cvAmount) body.amount = cvAmount;
    if (cvPercent) body.percentValue = cvPercent;
    setSavingVal(true);
    try {
      const res = await fetch("/api/payroll/component-values", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) {
        toast.success("Nilai komponen disimpan."); setCvAmount(""); setCvPercent(""); setCvEff("");
        setValues(await getArr<ComponentValue>(`/api/payroll/component-values?employeeId=${emp}`));
      } else toast.error(j?.error?.message ?? "Gagal menyimpan nilai komponen.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSavingVal(false); }
  }

  const activeEmployees = refs.employees.filter((x) => x.isActive);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Kompensasi Karyawan</h1>

      <div className="max-w-md space-y-1">
        <label className="text-sm font-medium">Pilih Karyawan *</label>
        <Select value={emp} onChange={onSelectEmployee}>
          <option value="">— Pilih karyawan —</option>
          {activeEmployees.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
        </Select>
      </div>

      {!emp && <p className="text-sm text-zinc-500">Pilih karyawan untuk melihat & mengelola gaji pokok serta nilai komponen.</p>}

      {emp && loading && <div className="flex justify-center py-8"><Spinner size={24} /></div>}

      {emp && !loading && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Gaji pokok */}
          <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Gaji Pokok</h2>
            <form onSubmit={onSaveCompensation} className="grid grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Struktur Gaji</label>
                <Select value={structureId} onChange={(e) => setStructureId(e.target.value)}>
                  <option value="">— Tanpa struktur —</option>
                  {structures.map((s) => <option key={s.id} value={s.id}>{s.name} ({PAY_FREQUENCY_LABEL[s.payFrequency]})</option>)}
                </Select>
              </div>
              <div className="space-y-1"><label className="text-sm font-medium">Gaji Pokok *</label><Input value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} placeholder="0.00" /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Berlaku Tanggal *</label><Input type="date" value={compEff} onChange={(e) => setCompEff(e.target.value)} /></div>
              <div className="flex items-end sm:col-span-2"><Button type="submit" loading={savingComp}>Simpan</Button></div>
            </form>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
              {comps.length === 0 && <p className="py-2 text-zinc-500">Belum ada riwayat gaji pokok.</p>}
              {comps.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="font-mono text-zinc-900 dark:text-zinc-100">{rp(c.baseSalary)}</p>
                    <p className="text-xs text-zinc-500">
                      Berlaku {c.effectiveFrom.slice(0, 10)} · {c.structureId ? structMap.get(c.structureId)?.name ?? "—" : "tanpa struktur"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Nilai komponen */}
          <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Nilai Komponen</h2>
            <form onSubmit={onSaveValue} className="grid grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Komponen *</label>
                <Select value={componentId} onChange={(e) => setComponentId(e.target.value)}>
                  <option value="">— Pilih komponen —</option>
                  {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1"><label className="text-sm font-medium">Nominal</label><Input value={cvAmount} onChange={(e) => setCvAmount(e.target.value)} placeholder="0.00" /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Persentase</label><Input value={cvPercent} onChange={(e) => setCvPercent(e.target.value)} placeholder="%" /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Berlaku Tanggal *</label><Input type="date" value={cvEff} onChange={(e) => setCvEff(e.target.value)} /></div>
              <div className="flex items-end"><Button type="submit" loading={savingVal}>Simpan</Button></div>
            </form>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
              {values.length === 0 && <p className="py-2 text-zinc-500">Belum ada nilai komponen.</p>}
              {values.map((v) => (
                <div key={v.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-zinc-900 dark:text-zinc-100">{compMap.get(v.componentId)?.name ?? "—"}</p>
                    <p className="text-xs text-zinc-500">Berlaku {v.effectiveFrom.slice(0, 10)}</p>
                  </div>
                  <p className="font-mono text-zinc-900 dark:text-zinc-100">
                    {v.amount ? rp(v.amount) : v.percentValue ? `${v.percentValue}%` : "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
