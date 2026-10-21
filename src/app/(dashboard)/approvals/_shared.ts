/**
 * Helper bersama halaman Alur & Permintaan Persetujuan (U9). Seluruh data dari API;
 * nominal selalu string desimal. Envelope list:
 *  - approval-workflows   -> { data: [...] }        (datar, tanpa paginasi)
 *  - approval-requests    -> { data: [...], meta: { nextCursor } }   (keyset)
 */
import { formatMoney } from "@/lib/money";

/* ------------------------------ Format ------------------------------ */

export function rp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatMoney(value);
}

/* ------------------------------- Regex ------------------------------ */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DOCTYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
export const AMOUNT_RE = /^\d{1,16}(\.\d{1,2})?$/;

/* ---------------------------- Label & style ------------------------- */

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

export const REQUEST_STATUS_STYLE: Record<string, string> = {
  pending: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  approved: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  rejected: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
  cancelled: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export const ACTION_LABEL: Record<string, string> = {
  approve: "Setuju",
  reject: "Tolak",
};

/* ------------------------------- Tipe ------------------------------- */

export type WorkflowStep = {
  id: string;
  workflowId: string;
  stepNo: number;
  approverRoleId: string | null;
  approverUserId: string | null;
};

export type Workflow = {
  id: string;
  docType: string;
  name: string;
  branchId: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowDetail = Workflow & { steps: WorkflowStep[] };

export type ApprovalAction = {
  id: string;
  requestId: string;
  stepNo: number;
  actorId: string;
  action: string;
  note: string | null;
  actedAt: string;
};

export type ApprovalRequest = {
  id: string;
  docType: string;
  docId: string;
  workflowId: string;
  status: string;
  currentStep: number;
  amount: string | null;
  requestedBy: string;
  requestedAt: string;
  completedAt: string | null;
};

export type ApprovalRequestDetail = ApprovalRequest & {
  steps: WorkflowStep[];
  actions: ApprovalAction[];
};

export type NamedRef = { id: string; name: string };
export type RoleRef = { id: string; code: string; name: string };

export type Page<T> = { items: T[]; nextCursor: string | null };

/* ------------------------------- Fetch ------------------------------ */

type Envelope = { data?: unknown; meta?: { nextCursor?: string | null } };

async function getJson(url: string): Promise<Envelope> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Envelope;
}

async function getList<T>(url: string): Promise<T[]> {
  return ((await getJson(url)).data as T[]) ?? [];
}

export function fetchWorkflows(params: URLSearchParams): Promise<Workflow[]> {
  const qs = params.toString();
  return getList<Workflow>(`/api/approval-workflows${qs ? `?${qs}` : ""}`);
}

export async function fetchWorkflowDetail(id: string): Promise<WorkflowDetail> {
  return (await getJson(`/api/approval-workflows/${id}`)).data as WorkflowDetail;
}

export function fetchApprovalRequestsPage(params: URLSearchParams): Promise<Page<ApprovalRequest>> {
  const qs = params.toString();
  return getJson(`/api/approval-requests${qs ? `?${qs}` : ""}`).then((j) => ({
    items: ((j.data ?? []) as ApprovalRequest[]),
    nextCursor: j.meta?.nextCursor ?? null,
  }));
}

export async function fetchApprovalRequestDetail(id: string): Promise<ApprovalRequestDetail> {
  return (await getJson(`/api/approval-requests/${id}`)).data as ApprovalRequestDetail;
}

/** Opsi approver: user aktif (fallback [] bila izin kurang). */
export async function fetchUsersActive(): Promise<NamedRef[]> {
  try {
    const j = await getJson("/api/users?status=active&limit=200");
    const items = (j.data ?? []) as Array<{ id: string; name: string }>;
    return items.map((u) => ({ id: u.id, name: u.name }));
  } catch {
    return [];
  }
}

/** Opsi approver: role (fallback [] bila izin kurang). */
export async function fetchRoles(): Promise<RoleRef[]> {
  try {
    const items = await getList<RoleRef>("/api/roles");
    return items.map((r) => ({ id: r.id, code: r.code, name: r.name }));
  } catch {
    return [];
  }
}

export async function readError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Gagal (${res.status}).`;
}

/** Cocokkan slug docType (min 3, maks 80, huruf kecil). */
export const isValidDocType = (v: string): boolean =>
  v.length >= 3 && v.length <= 80 && DOCTYPE_RE.test(v);

/** Nominal >= 0 (nol diizinkan pada rentang alur). */
export const isValidAmount = (v: string): boolean => AMOUNT_RE.test(v);
