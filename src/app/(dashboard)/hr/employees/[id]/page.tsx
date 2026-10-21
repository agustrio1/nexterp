"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { DialogConfirm } from "@/components/ui/dialog-confirm";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";

type Employee = {
  id: string; code: string; userId: string | null; firstName: string; lastName: string | null;
  birthDate: string | null; gender: string | null; npwp: string | null; address: string | null;
  phone: string | null; email: string | null; departmentId: string | null; positionId: string | null;
  branchId: string | null; managerId: string | null; dateJoined: string; status: string; isActive: boolean;
};
type Contract = {
  id: string; docNo: string | null; code: string; type: string;
  startDate: string; endDate: string | null; status: string; notes: string | null;
};

const EMP_STATUS_LABEL: Record<string, string> = {
  probation: "Masa Percobaan", active: "Aktif", on_leave: "Sedang Cuti",
  inactive: "Nonaktif", terminated: "Resign/PHK",
};
const CONTRACT_TYPE_LABEL: Record<string, string> = {
  pkwt: "PKWT (Waktu Tertentu)", pkwtt: "PKWTT (Tanpa Waktu)", outsourcing: "Alih Daya", intern: "Magang",
};
const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: "Draf", active: "Aktif", ended: "Berakhir", cancelled: "Dibatalkan",
};

export default function HREmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const refs = useHrRefs();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // form state (diisi dari emp)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [npwp, setNpwp] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [status, setStatus] = useState("active");
  const [isActive, setIsActive] = useState(true);

  // form kontrak baru
  const [cCode, setCCode] = useState("");
  const [cType, setCType] = useState("pkwt");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const [cStatus, setCStatus] = useState("draft");
  const [cAdding, setCAdding] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/hr/employees/${id}`, { credentials: "same-origin" }),
      fetch(`/api/hr/contracts?employeeId=${id}`, { credentials: "same-origin" }),
    ])
      .then(async ([eRes, cRes]) => {
        if (!eRes.ok) { const j = (await eRes.json().catch(() => null)) as { error?: { message?: string } } | null; throw new Error(j?.error?.message ?? "Gagal memuat karyawan."); }
        const e = (await eRes.json()) as { data: Employee };
        setEmp(e.data);
        setFirstName(e.data.firstName);
        setLastName(e.data.lastName ?? "");
        setBirthDate(e.data.birthDate ? e.data.birthDate.slice(0, 10) : "");
        setGender(e.data.gender ?? "");
        setNpwp(e.data.npwp ?? "");
        setPhone(e.data.phone ?? "");
        setEmail(e.data.email ?? "");
        setAddress(e.data.address ?? "");
        setDepartmentId(e.data.departmentId ?? "");
        setPositionId(e.data.positionId ?? "");
        setBranchId(e.data.branchId ?? "");
        setManagerId(e.data.managerId ?? "");
        setStatus(e.data.status);
        setIsActive(e.data.isActive);
        if (cRes.ok) { const c = (await cRes.json()) as { data: Contract[] }; setContracts(c.data); }
      })
      .catch((err: Error) => toast.error(err.message || "Gagal memuat karyawan."))
      .finally(() => setLoading(false));
  }, [id]);

  async function reloadContracts() {
    const res = await fetch(`/api/hr/contracts?employeeId=${id}`, { credentials: "same-origin" });
    if (res.ok) { const j = (await res.json()) as { data: Contract[] }; setContracts(j.data); }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) return;
    if (!firstName.trim()) { toast.error("Nama depan wajib diisi."); return; }
    const body: Record<string, unknown> = { firstName: firstName.trim(), status, isActive };
    body.lastName = lastName.trim() || null;
    body.birthDate = birthDate || null;
    body.gender = gender || null;
    body.npwp = npwp.trim() || null;
    body.phone = phone.trim() || null;
    body.email = email.trim() || null;
    body.address = address.trim() || null;
    body.departmentId = departmentId || null;
    body.positionId = positionId || null;
    body.branchId = branchId || null;
    body.managerId = managerId || null;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/employees/${emp.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { data?: Employee; error?: { message?: string } } | null;
      if (res.ok && j?.data) { setEmp(j.data); toast.success("Data karyawan diperbarui."); }
      else toast.error(j?.error?.message ?? "Gagal memperbarui.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onUnlinkUser() {
    if (!emp) return;
    const res = await fetch(`/api/hr/employees/${emp.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: null }), credentials: "same-origin" });
    if (res.ok) { const j = (await res.json()) as { data: Employee }; setEmp(j.data); toast.success("Tautan login dilepas."); }
    else { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(j?.error?.message ?? "Gagal melepas tautan."); }
  }

  async function onAddContract(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) return;
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(cCode.trim().toUpperCase())) { toast.error("Kode kontrak 2-20 karakter huruf/angka/strip."); return; }
    if (!cStart) { toast.error("Tanggal mulai wajib diisi."); return; }
    const body: Record<string, unknown> = { employeeId: emp.id, code: cCode.trim().toUpperCase(), type: cType, startDate: cStart, status: cStatus };
    if (cEnd) body.endDate = cEnd;
    setCAdding(true);
    try {
      const res = await fetch("/api/hr/contracts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { data?: Contract; error?: { message?: string } } | null;
      if (res.ok) { toast.success("Kontrak dibuat."); setCCode(""); setCStart(""); setCEnd(""); setCStatus("draft"); await reloadContracts(); }
      else toast.error(j?.error?.message ?? "Gagal membuat kontrak.");
    } catch { toast.error("Koneksi terganggu."); } finally { setCAdding(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!emp) return <p className="text-red-600">Karyawan tidak ditemukan.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/hr/employees"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <code className="font-mono text-lg">{emp.code}</code> — {emp.firstName} {emp.lastName ?? ""}
        </h1>
        {!emp.isActive && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">Nonaktif</span>}
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          <div><span className="text-zinc-500">Masuk:</span> {emp.dateJoined.slice(0, 10)}</div>
          <div><span className="text-zinc-500">Status:</span> {EMP_STATUS_LABEL[emp.status] ?? emp.status}</div>
          <div><span className="text-zinc-500">Tautan login:</span> {emp.userId ? "Terhubung" : "Belum ada"}</div>
        </div>
        {emp.userId && (
          <div className="mt-3">
            <DialogConfirm
              trigger={<Button variant="outline" size="sm">Lepas Tautan Login</Button>}
              title="Lepas tautan login karyawan ini?"
              confirmLabel="Lepas"
              onConfirm={onUnlinkUser}
            />
          </div>
        )}
      </div>

      <form onSubmit={onSave} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">Ubah Data Karyawan</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1"><label className="text-sm font-medium">Nama Depan *</label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nama Belakang</label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Status Kerja</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(EMP_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Jenis Kelamin</label>
            <Select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">—</option><option value="M">Laki-laki</option><option value="F">Perempuan</option>
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Departemen</label>
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">— Tanpa departemen —</option>
              {refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Jabatan</label>
            <Select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
              <option value="">— Tanpa jabatan —</option>
              {refs.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Cabang</label>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">— Tanpa cabang —</option>
              {refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Atasan</label>
            <Select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">— Tanpa atasan —</option>
              {refs.employees.filter((x) => x.isActive && x.id !== emp.id).map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ""} ({x.code})</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Tanggal Lahir</label><Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">NPWP</label><Input value={npwp} onChange={(e) => setNpwp(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Telepon</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Alamat</label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Aktif</label>
        <div><Button type="submit" loading={saving}>Simpan Perubahan</Button></div>
      </form>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Kontrak Kerja</h2>
        <form onSubmit={onAddContract} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-5">
          <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={cCode} onChange={(e) => setCCode(e.target.value)} placeholder="KTR-001" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Tipe</label>
            <Select value={cType} onChange={(e) => setCType(e.target.value)}>
              {Object.entries(CONTRACT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Mulai *</label><Input type="date" value={cStart} onChange={(e) => setCStart(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Sampai</label><Input type="date" value={cEnd} onChange={(e) => setCEnd(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Status</label>
            <Select value={cStatus} onChange={(e) => setCStatus(e.target.value)}>
              {Object.entries(CONTRACT_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="col-span-2 sm:col-span-5"><Button type="submit" size="sm" loading={cAdding}><Plus className="h-4 w-4" /> Tambah Kontrak</Button></div>
        </form>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr><th className="px-3 py-2 text-left">No. Dokumen</th><th className="px-3 py-2 text-left">Kode</th><th className="px-3 py-2 text-left">Tipe</th><th className="px-3 py-2 text-left">Periode</th><th className="px-3 py-2 text-left">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2"><code className="font-mono text-xs">{c.docNo ?? "—"}</code></td>
                  <td className="px-3 py-2">{c.code}</td>
                  <td className="px-3 py-2">{CONTRACT_TYPE_LABEL[c.type] ?? c.type}</td>
                  <td className="px-3 py-2">{c.startDate.slice(0, 10)} — {c.endDate ? c.endDate.slice(0, 10) : "∞"}</td>
                  <td className="px-3 py-2">{CONTRACT_STATUS_LABEL[c.status] ?? c.status}</td>
                </tr>
              ))}
              {contracts.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Belum ada kontrak.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
