/**
 * Konfigurasi header keamanan HTTP (Tahap 10B).
 * Dipakai `next.config.ts.headers()` dan diafirmasi di `scripts/test-security.ts`.
 *
 * Desain:
 * - Global (semua respons): nosniff, Referrer-Policy, Permissions-Policy.
 * - HSTS hanya produksi — dev tidak perlu dan kadang merepotkan localhost.
 * - API (path /api/*): CSP ketat (default-src 'none') + X-Frame-Options DENY +
 *   Cache-Control no-store sebagai fallback (rute pengunduh file boleh override eksplisit).
 */

export type SecurityHeader = { key: string; value: string };

/** Header global untuk SEMUA respons (halaman + API). */
export function globalSecurityHeaders(isProd: boolean): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];
  if (isProd) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  }
  return headers;
}

/** Header tambahan KHUSUS /api/* — ditumpuk di atas global. */
export function apiSecurityHeaders(): SecurityHeader[] {
  return [
    {
      key: "Content-Security-Policy",
      value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cache-Control", value: "no-store" },
  ];
}

/**
 * Konfigurasi headers() Next.js — dikembalikan sebagai fungsi agar bisa dipanggil
 * dari `next.config.ts` (yang tidak punya akses `env` runtime aplikasi).
 */
export function securityHeaders(isProd: boolean) {
  const global = globalSecurityHeaders(isProd);
  const api = apiSecurityHeaders();
  return [
    {
      source: "/:path*",
      headers: global,
    },
    {
      source: "/api/:path*",
      headers: [...global, ...api],
    },
  ];
}
