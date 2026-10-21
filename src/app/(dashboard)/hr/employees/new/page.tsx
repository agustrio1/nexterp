"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";

const STATUS_LABEL: Record<string, string> = {
  probation: "Masa Percobaan",
  active: "Aktif",
  on_leave: "Sedang Cuti",
  inactive: "Nonaktif",
  terminated: "Resign/PHK",
};

export default function HREmployeeNewPage() {
  const router = useRouter();
  const refs = useHrRefs();
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateJoined, setDateJoined] = useState("");
  const [status, setStatus] = useState("active");
  const [departmentId, setDepartmentId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [npwp, setNpwp] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code.trim().toUpperCase())) { toast.error("Kode 2-20 karakter: huruf/angka/strip/underscore, diawali huruf/angka."); return; }
    if (!firstName.trim()) { toast.error("Nama depan wajib diisi."); return; }
    if (!dateJoined) { toast.error("Tanggal masuk wajib diisi."); return; }

    const body: Record<string, unknown> = { code: code.trim().toUpperCase(), firstName: firstName.trim(), dateJoined, status };
    if (lastName.trim()) body.lastName = lastName.trim();
    if (departmentId) body.departmentId = departmentId;
    if (positionId) body.positionId = positionId;
    if (branchId) body.branchId = branchId;
    if (managerId) body.managerId = managerId;
    if (birthDate) body.birthDate = birthDate;
    if (gender) body.gender = gender;
    if (npwp.trim()) body.npwp = npwp.trim();
    if (phone.trim()) body.phone = phone.trim();
    if (email.trim()) body.email = email.trim();
    if (address.trim()) body.address = address.trim();

    setSaving(true);
    try {
      const res = await fetch("/api/hr/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { data?: { id: string }; error?: { message?: string } } | null;
      if (res.ok && j?.data?.id) { toast.success("Karyawan dibuat."); router.push(`/hr/employees/${j.data.id}`); }
      else toast.error(j?.error?.message ?? "Gagal membuat karyawan.");
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Karyawan Baru</h1>
      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1"><label className="text-sm font-medium">Kode *</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="KRY-0001" /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Tanggal Masuk *</label><Input type="date" value={dateJoined} onChange={(e) => setDateJoined(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nama Depan *</label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Nama Belakang</label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Status</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Jenis Kelamin</label>
            <Select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">— Pilih —</option><option value="M">Laki-laki</option><option value="F">Perempuan</option>
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
              {refs.employees.filter((emp) => emp.isActive).map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName ?? ""} ({emp.code})</option>)}
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm font-medium">Tanggal Lahir</label><Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">NPWP</label><Input value={npwp} onChange={(e) => setNpwp(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Telepon</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Alamat</label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        <div className="flex gap-2">
          <Button type="submit" loading={saving}>Simpan</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>Batal</Button>
        </div>
      </form>
    </div>
  );
}
