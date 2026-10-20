import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 Proxy (sebelumnya bernama Middleware) — lihat
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
 *
 * Tugas proxy di sini SANGAT TERBATAS: hanya menyuntikkan / meneruskan
 * `x-request-id` agar route handler Node (`apiHandler`) bisa membaca satu
 * nilai requestId kanonis dari `request.headers` tanpa harus membuat ulang.
 *
 * Kenapa bukan ALS di sini:
 * - Proxy jalan di Edge runtime (Vercel edge / CDN) — TIDAK berbagi proses
 *   Node.js dengan route handler. AsyncLocalStorage tidak bisa menyeberang.
 * - Proxy bukan tempat cocok untuk logika berat (auth/session/DB) sesuai
 *   catatan resmi Next 16.
 *
 * Sanitasi nilai klien (max 128 char + charset aman) tetap DILAKUKAN
 * di apiHandler (Node) agar kontrak sanitasi terpusat dan tidak berubah
 * saat edge runtime berganti versi.
 *
 * Matcher: khusus `/api/*` — halaman statis dan `_next/*` tidak perlu.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Bila upstream (Vercel/Cloudflare/ALB) sudah memasang x-request-id,
  // nilai itu diteruskan apa adanya; kalau belum, generate UUID di edge.
  if (!headers.get("x-request-id")) {
    headers.set("x-request-id", crypto.randomUUID());
  }
  const response = NextResponse.next({ request: { headers } });
  // Echo di response header supaya klien / CDN log bisa korelasi tanpa
  // harus mengintip body.
  response.headers.set("x-request-id", headers.get("x-request-id") ?? "");
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
