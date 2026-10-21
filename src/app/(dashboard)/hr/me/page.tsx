"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";

type Profile = {
  id: string; code: string; firstName: string; lastName: string | null;
  birthDate: string | null; gender: string | null; npwp: string | null; email: string | null;
  phone: string | null; address: string | null; dateJoined: string; status: string; isActive: boolean;
};
type MyAttendance = { id: string; workDate: string; status: string; checkInAt: string | null; checkOutAt: string | null; overtimeMinutes: number };
type MyBalance = { id: string; leaveTypeId: string; year: number; totalDays: string; usedDays: string };
type MyLeaveReq = { id: string; docNo: string | null; leaveTypeId: string; startDate: string; endDate: string; days: string; status: string };
type MyOvertime = { id: string; docNo: string | null; workDate: string; hours: string; status: string };
type LeaveType = { id: string; code: string; name: string };

const ATT_LABEL: Record<string, string> = {
  present: "Hadir", absent: "Alpa", late: "Terlambat", leave: "Cuti", sick: "Sakit", permit: "Izin",
};
const REQ_LABEL: Record<string, string> = {
  draft: "Draf", pending: "Menunggu Persetujuan", approved: "Disetujui", rejected: "Ditolak", cancelled: "Dibatalkan",
};

export default function HRMePage() {
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [attendance, setAttendance] = useState<MyAttendance[]>([]);
  const [balances, setBalances] = useState<MyBalance[]>([]);
  const [requests, setRequests] = useState<MyLeaveReq[]>([]);
  const [overtimes, setOvertimes] = useState<MyOvertime[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);

  useEffect(() => {
    fetch("/api/hr/me", { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 404) { setNotLinked(true); return null; }
        if (!res.ok) throw new Error("Gagal memuat profil.");
        return res.json() as Promise<{ data: Profile }>;
      })
      .then((j) => {
        if (j) setProfile(j.data);
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setLoading(false));

    void Promise.all([
      fetch("/api/hr/me/attendance", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/hr/me/leave", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: { balances: [], requests: [] } }),
      fetch("/api/hr/me/overtime", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/hr/leave-types", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
    ]).then(([att, leave, ot, lt]) => {
      setAttendance(att.data as MyAttendance[]);
      setBalances(leave.data.balances as MyBalance[]);
      setRequests(leave.data.requests as MyLeaveReq[]);
      setOvertimes(ot.data as MyOvertime[]);
      setLeaveTypes((lt.data as LeaveType[]) ?? []);
    }).catch(() => {});
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (notLinked) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">HR Saya</h1>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Akun Anda belum ditautkan ke data karyawan. Hubungi administrator agar akun login Anda dihubungkan ke salah satu data karyawan.
        </p>
      </div>
    );
  }
  if (!profile) return <p className="text-red-600">Data karyawan Anda tidak ditemukan.</p>;

  const ltMap = new Map(leaveTypes.map((t) => [t.id, t.name]));

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">HR Saya</h1>

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">{profile.firstName} {profile.lastName ?? ""} <code className="ml-2 font-mono text-sm text-zinc-500">{profile.code}</code></h2>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div><span className="text-zinc-500">Masuk:</span> {profile.dateJoined.slice(0, 10)}</div>
          <div><span className="text-zinc-500">Email:</span> {profile.email ?? "—"}</div>
          <div><span className="text-zinc-500">Telepon:</span> {profile.phone ?? "—"}</div>
          <div><span className="text-zinc-500">NPWP:</span> {profile.npwp ?? "—"}</div>
          <div><span className="text-zinc-500">Status:</span> {profile.status}</div>
          <div><span className="text-zinc-500">Lahir:</span> {profile.birthDate ? profile.birthDate.slice(0, 10) : "—"}</div>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Saldo Cuti</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">Jenis Cuti</th><th className="px-3 py-2 text-left">Tahun</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Terpakai</th><th className="px-3 py-2 text-right">Sisa</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {balances.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2">{ltMap.get(b.leaveTypeId) ?? "—"}</td>
                  <td className="px-3 py-2">{b.year}</td>
                  <td className="px-3 py-2 text-right">{b.totalDays}</td>
                  <td className="px-3 py-2 text-right">{b.usedDays}</td>
                  <td className="px-3 py-2 text-right font-medium">{(Number(b.totalDays) - Number(b.usedDays)).toFixed(1)}</td>
                </tr>
              ))}
              {balances.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Belum ada saldo cuti.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Pengajuan Cuti</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">No. Dokumen</th><th className="px-3 py-2 text-left">Jenis</th><th className="px-3 py-2 text-left">Periode</th><th className="px-3 py-2 text-right">Hari</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2"><code className="font-mono text-xs">{r.docNo ?? "—"}</code></td>
                  <td className="px-3 py-2">{ltMap.get(r.leaveTypeId) ?? "—"}</td>
                  <td className="px-3 py-2">{r.startDate.slice(0, 10)} — {r.endDate.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">{r.days}</td>
                  <td className="px-3 py-2">{REQ_LABEL[r.status] ?? r.status}</td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Belum ada pengajuan cuti.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Absensi Saya</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Masuk</th><th className="px-3 py-2 text-left">Keluar</th><th className="px-3 py-2 text-right">Lembur (menit)</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {attendance.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2">{a.workDate.slice(0, 10)}</td>
                  <td className="px-3 py-2">{ATT_LABEL[a.status] ?? a.status}</td>
                  <td className="px-3 py-2">{a.checkInAt ? new Date(a.checkInAt).toLocaleString("id-ID").slice(0, 16) : "—"}</td>
                  <td className="px-3 py-2">{a.checkOutAt ? new Date(a.checkOutAt).toLocaleString("id-ID").slice(0, 16) : "—"}</td>
                  <td className="px-3 py-2 text-right">{a.overtimeMinutes || "—"}</td>
                </tr>
              ))}
              {attendance.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Belum ada catatan absensi.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Lembur Saya</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50"><tr><th className="px-3 py-2 text-left">No. Dokumen</th><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-right">Jam</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {overtimes.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2"><code className="font-mono text-xs">{o.docNo ?? "—"}</code></td>
                  <td className="px-3 py-2">{o.workDate.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">{o.hours}</td>
                  <td className="px-3 py-2">{REQ_LABEL[o.status] ?? o.status}</td>
                </tr>
              ))}
              {overtimes.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-500">Belum ada pengajuan lembur.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
