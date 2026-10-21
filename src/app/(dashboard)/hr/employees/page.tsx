"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useHrRefs } from "@/app/(dashboard)/hr/_use-refs";
import { employeeName } from "@/app/(dashboard)/hr/_shared";

type Employee = {
  id: string; code: string; firstName: string; lastName: string | null;
  departmentId: string | null; positionId: string | null; branchId: string | null;
  dateJoined: string; status: string; isActive: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  probation: "Masa Percobaan",
  active: "Aktif",
  on_leave: "Sedang Cuti",
  inactive: "Nonaktif",
  terminated: "Resign/PHK",
};

const STATUS_STYLE: Record<string, string> = {
  probation: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  active: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  on_leave: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  inactive: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  terminated: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export default function HREmployeesPage() {
  const refs = useHrRefs();
  const [isActive, setIsActive] = useState("");
  const [status, setStatus] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (isActive) params.set("isActive", isActive);
  if (status) params.set("status", status);
  if (departmentId) params.set("departmentId", departmentId);
  if (branchId) params.set("branchId", branchId);
  const qs = params.toString();
  const url = qs ? `/api/hr/employees?${qs}` : "/api/hr/employees";

  const columns: Column<Employee>[] = [
    { header: "Kode", cell: (r) => <code className="font-mono text-xs">{r.code}</code> },
    { header: "Nama", cell: (r) => employeeName(r) },
    { header: "Departemen", cell: (r) => (r.departmentId ? refs.deptMap.get(r.departmentId)?.name ?? "—" : "—") },
    { header: "Jabatan", cell: (r) => (r.positionId ? refs.posMap.get(r.positionId)?.name ?? "—" : "—") },
    { header: "Cabang", cell: (r) => (r.branchId ? refs.branchMap.get(r.branchId)?.name ?? "—" : "—") },
    { header: "Masuk", cell: (r) => r.dateJoined.slice(0, 10) },
    { header: "Status", cell: (r) => <span className={STATUS_STYLE[r.status] ?? ""}>{STATUS_LABEL[r.status] ?? r.status}</span> },
    { header: "Aksi", className: "w-[80px]", cell: (r) => <Link href={`/hr/employees/${r.id}`}><Button variant="ghost" size="sm">Detail</Button></Link> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Karyawan</h1>
        <Link href="/hr/employees/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select className="w-36" value={isActive} onChange={(e) => { setIsActive(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua Aktif</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
        <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua Status</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select className="w-48" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua Departemen</option>
          {refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select className="w-44" value={branchId} onChange={(e) => { setBranchId(e.target.value); setRefreshKey((k) => k + 1); }}>
          <option value="">Semua Cabang</option>
          {refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </div>
      <DataTable<Employee> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Belum ada karyawan." />
    </div>
  );
}
