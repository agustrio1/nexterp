"use client";

import { useEffect, useState } from "react";

import {
  fetchBranches,
  fetchDepartments,
  fetchEmployees,
  fetchPositions,
  fetchShifts,
  toMap,
  type EmployeeRef,
  type NamedRef,
  type ShiftRef,
} from "@/app/(dashboard)/hr/_shared";

export type HrRefs = {
  employees: EmployeeRef[];
  empMap: Map<string, EmployeeRef>;
  departments: NamedRef[];
  deptMap: Map<string, NamedRef>;
  positions: NamedRef[];
  posMap: Map<string, NamedRef>;
  branches: NamedRef[];
  branchMap: Map<string, NamedRef>;
  shifts: ShiftRef[];
  shiftMap: Map<string, ShiftRef>;
};

const EMPTY_MAP = new Map<string, never>();

/**
 * Muat semua referensi HR (karyawan/departemen/jabatan/cabang/shift) sekali
 * per mount. Fetch individual yang gagal (mis. izin kurang) jadi array kosong.
 */
export function useHrRefs(): HrRefs {
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [departments, setDepartments] = useState<NamedRef[]>([]);
  const [positions, setPositions] = useState<NamedRef[]>([]);
  const [branches, setBranches] = useState<NamedRef[]>([]);
  const [shifts, setShifts] = useState<ShiftRef[]>([]);

  useEffect(() => {
    void Promise.allSettled([
      fetchEmployees(),
      fetchDepartments(),
      fetchPositions(),
      fetchBranches(),
      fetchShifts(),
    ]).then(([e, d, p, b, s]) => {
      if (e.status === "fulfilled") setEmployees(e.value);
      if (d.status === "fulfilled") setDepartments(d.value);
      if (p.status === "fulfilled") setPositions(p.value);
      if (b.status === "fulfilled") setBranches(b.value);
      if (s.status === "fulfilled") setShifts(s.value);
    });
  }, []);

  return {
    employees,
    empMap: employees.length ? toMap(employees) : EMPTY_MAP,
    departments,
    deptMap: departments.length ? toMap(departments) : EMPTY_MAP,
    positions,
    posMap: positions.length ? toMap(positions) : EMPTY_MAP,
    branches,
    branchMap: branches.length ? toMap(branches) : EMPTY_MAP,
    shifts,
    shiftMap: shifts.length ? toMap(shifts) : EMPTY_MAP,
  };
}
