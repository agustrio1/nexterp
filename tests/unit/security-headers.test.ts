import { describe, expect, it } from "vitest";

import {
  apiSecurityHeaders,
  globalSecurityHeaders,
  securityHeaders,
} from "@/server/security-headers";

/**
 * Unit test factory header keamanan HTTP (Tahap 10B -> diuji 10A).
 * Memastikan isi & jumlah matcher sesuai kontrak untuk `next.config.ts.headers()`.
 */

describe("globalSecurityHeaders", () => {
  it("selalu memuat nosniff + Referrer-Policy + Permissions-Policy", () => {
    const prod = globalSecurityHeaders(true);
    const dev = globalSecurityHeaders(false);
    for (const list of [prod, dev]) {
      expect(list).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
      expect(list).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
      expect(list).toContainEqual({
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      });
    }
  });

  it("HSTS hanya produksi", () => {
    expect(globalSecurityHeaders(true)).toContainEqual({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
    expect(globalSecurityHeaders(false).some((h) => h.key === "Strict-Transport-Security")).toBe(
      false,
    );
  });

  it("prod = dev + 1 (hanya HSTS yang membedakan)", () => {
    expect(globalSecurityHeaders(true).length).toBe(globalSecurityHeaders(false).length + 1);
  });
});

describe("apiSecurityHeaders", () => {
  it("CSP memuat default-src 'none', frame-ancestors 'none', base-uri 'none'", () => {
    const csp = apiSecurityHeaders().find((h) => h.key === "Content-Security-Policy");
    expect(csp?.value).toContain("default-src 'none'");
    expect(csp?.value).toContain("frame-ancestors 'none'");
    expect(csp?.value).toContain("base-uri 'none'");
  });

  it("X-Frame-Options DENY", () => {
    expect(apiSecurityHeaders()).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
  });

  it("Cache-Control no-store (fallback; rute pengunduh berkas override eksplisit)", () => {
    expect(apiSecurityHeaders()).toContainEqual({ key: "Cache-Control", value: "no-store" });
  });

  it("tepat 3 header (tidak menambah global di sini — digabung di securityHeaders)", () => {
    expect(apiSecurityHeaders()).toHaveLength(3);
  });
});

describe("securityHeaders (bentuk akhir untuk next.config.ts)", () => {
  it("2 matcher: global + API", () => {
    const prod = securityHeaders(true);
    expect(prod).toHaveLength(2);
    expect(prod[0]?.source).toBe("/:path*");
    expect(prod[1]?.source).toBe("/api/:path*");
  });

  it("matcher global HANYA memakai header global", () => {
    const bundle = securityHeaders(true);
    const globalKeys = new Set(bundle[0]?.headers.map((h) => h.key));
    expect(globalKeys.has("Content-Security-Policy")).toBe(false);
    expect(globalKeys.has("X-Frame-Options")).toBe(false);
  });

  it("matcher API = global + CSP + XFO + Cache-Control", () => {
    const bundle = securityHeaders(true);
    const apiKeys = bundle[1]?.headers.map((h) => h.key) ?? [];
    for (const k of [
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
      "Content-Security-Policy",
      "X-Frame-Options",
      "Cache-Control",
    ]) {
      expect(apiKeys).toContain(k);
    }
  });

  it("dev: matcher API tidak memuat HSTS", () => {
    const bundle = securityHeaders(false);
    const apiKeys = bundle[1]?.headers.map((h) => h.key) ?? [];
    expect(apiKeys).not.toContain("Strict-Transport-Security");
    expect(apiKeys).toContain("Content-Security-Policy");
  });

  it("urutan stabil & tidak ada duplikat key dalam satu matcher", () => {
    for (const isProd of [true, false]) {
      for (const m of securityHeaders(isProd)) {
        const keys = m.headers.map((h) => h.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });
});
