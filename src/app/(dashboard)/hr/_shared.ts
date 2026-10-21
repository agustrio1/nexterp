/**
 * Helper bersama halaman HR: memuat daftar referensi (karyawan/departemen/
 * jabatan/cabang/shift) untuk mapping nama di tabel & opsi select.
 * Setiap fetch gagal (mis. izin tidak ada) jatuh ke array kosong — halaman
 * tetap tampil dengan "—" pada kolom nama.
 */

export type EmployeeRef = { id: string; code: string; firstName: string; lastName: string | null; status: string; isActive: boolean };
export type NamedRef = { id: string; name: string };
export type ShiftRef = NamedRef & { workStart: string | null; workEnd: string | null; isActive: boolean };

async function getJson<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: T[] };
    return Array.isArray(j.data) ? j.data : [];
  } catch {
    return [];
  }
}

export async function fetchEmployees(): Promise<EmployeeRef[]> {
  return getJson<EmployeeRef>("/api/hr/employees");
}

export async function fetchDepartments(): Promise<NamedRef[]> {
  return getJson<NamedRef>("/api/departments");
}

export async function fetchPositions(): Promise<NamedRef[]> {
  return getJson<NamedRef>("/api/hr/positions");
}

export async function fetchBranches(): Promise<NamedRef[]> {
  return getJson<NamedRef>("/api/branches");
}

export async function fetchShifts(): Promise<ShiftRef[]> {
  return getJson<ShiftRef>("/api/hr/shifts");
}

export function employeeName(e: EmployeeRef | undefined): string {
  if (!e) return "—";
  return e.lastName ? `${e.firstName} ${e.lastName}` : e.firstName;
}

export function toMap<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

/** Semua select karyawan memakai daftar ini (hanya yang isActive). */
export function activeEmployees(items: EmployeeRef[]): EmployeeRef[] {
  return items.filter((e) => e.isActive);
}
