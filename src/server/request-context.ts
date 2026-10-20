import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Konteks satu request API — di-set di `apiHandler` (Node runtime) dan dipakai
 * oleh logger & error reporter agar setiap log bisa dikorelasikan ke satu
 * requestId (dan userId/path/method opsional). AsyncLocalStorage dipilih
 * karena implisit: handler tidak perlu meneruskan `ctx` ke setiap pemanggilan
 * service; cukup log call di lapisan mana pun ikut ter-label.
 *
 * Catatan runtime: Edge proxy (Next 16 `src/proxy.ts`) TIDAK berbagi proses
 * dengan route handler Node, sehingga proxy hanya MENGINJEKSI header
 * `x-request-id` — ALS dimulai ulang di sisi Node oleh `apiHandler`.
 */
export type RequestContext = {
  /** UUID; bila klien mengirim `x-request-id` dipakai nilai itu (dibatasi 128 char). */
  requestId: string;
  /** HTTP method uppercase, mis. "POST". */
  method?: string;
  /** Path request, mis. "/api/journals". */
  path?: string;
  /** Diisi setelah authContext tersedia (setelah auth guard); opsional. */
  userId?: string;
  /** Epoch ms saat apiHandler mulai — untuk mengukur durasi di exit log. */
  startedAt: number;
};

const als = new AsyncLocalStorage<RequestContext>();

/** Jalankan `fn` dengan `ctx` sebagai konteks aktif. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

/** Baca konteks aktif (undefined bila di luar request scope). */
export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/** Perbarui userId setelah actor dikenal; mengembalikan ctx baru bila ada. */
export function annotateRequestContext(patch: Partial<RequestContext>): void {
  const store = als.getStore();
  if (!store) return;
  Object.assign(store, patch);
}

/** Generator requestId canonical (bisa di-mock di test). */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Sanitasi header `x-request-id` yang datang dari klien: hanya menerima
 * karakter aman (alnum, dash, underscore, dot), max 128 char. Nilai tak valid
 * diganti UUID baru agar log tidak bisa diinjection string arbitrer.
 */
export function sanitizeRequestId(raw: string | null | undefined): string {
  if (!raw) return newRequestId();
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return newRequestId();
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return newRequestId();
  return trimmed;
}
