/**
 * Guard CSRF same-origin (murni, tanpa efek samping DB).
 * Dipakai `apiHandler` untuk metode tidak aman (POST/PUT/PATCH/DELETE).
 *
 * Aturan:
 * - Browser modern selalu mengirim `Origin` untuk permintaan lintas-origin metode
 *   tidak aman; `Referer` jadi fallback (klien lama / top-level navigation).
 * - Keduanya absen -> izinkan. Klien non-browser sah (curl, service-to-service)
 *   tidak mengirim Origin, dan tetap terlapis oleh `parseBody` (wajib JSON) +
 *   cookie sesi `sameSite=lax` (browser tidak mengirim cookie pada POST lintas-site).
 * - Ada Origin -> harus sama persis dengan `appOrigin` (scheme://host[:port]).
 * - Referer saja -> harus sama persis atau berprefix `<appOrigin>/` (path bebas).
 *
 * Modul ini SENGAJA tidak mengimpor `errors.ts` agar bisa diimpor oleh modul
 * errors tanpa siklus; penelepon yang mengubah hasil menjadi AppError.
 */

/** Header minimal yang diperlukan — kompatibel dengan `Headers`. */
export type HeadersReader = { get(name: string): string | null };

/** Normalisasi origin dari `APP_URL`; membuang path & trailing slash. */
export function appOriginFrom(appUrl: string): string {
  try {
    return new URL(appUrl).origin;
  } catch {
    return appUrl.replace(/\/+$/, "");
  }
}

/**
 * Fungsi murni: kembalikan `undefined` bila lolos, atau string alasan (untuk log server)
 * bila header Origin/Referer mengindikasikan permintaan lintas-origin.
 */
export function sameOriginViolation(
  headers: HeadersReader,
  appOrigin: string,
): string | undefined {
  const origin = headers.get("origin");
  if (origin) {
    return origin === appOrigin ? undefined : `origin=${origin}`;
  }
  const referer = headers.get("referer");
  if (referer) {
    return referer === appOrigin || referer.startsWith(appOrigin + "/")
      ? undefined
      : `referer=${referer.slice(0, 200)}`;
  }
  return undefined;
}

/** Metode yang dianggap tidak aman (RFC 9110 §4.2.1) dan karenanya perlu CSRF+limit. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

/** Ambil IP klien dari `x-forwarded-for` (proxy/edge paling depan). Fallback "0". */
export function clientIpFrom(headers: HeadersReader): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "0";
}

/**
 * Segmen path level-1 setelah `/api/` — dipakai sebagai grup bucket rate-limit
 * (mis. `/api/journals/[id]` -> "journals"; `/api/health` -> "health").
 * Path tanpa awalan `/api/` -> "root".
 */
export function apiGroupFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "api" && parts.length >= 2) return parts[1] ?? "root";
  return "root";
}

/** Bentuk bucket rate-limit API. */
export const apiBucket = (group: string, clientIp: string): string =>
  `api:${group || "root"}:${clientIp || "0"}`;
