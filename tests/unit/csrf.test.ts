import { describe, expect, it } from "vitest";

import {
  apiBucket,
  apiGroupFromPath,
  appOriginFrom,
  clientIpFrom,
  isUnsafeMethod,
  sameOriginViolation,
  UNSAFE_METHODS,
} from "@/server/csrf";

/**
 * Unit test guard CSRF murni (Tahap 10B -> diuji 10A).
 * Semua fungsi TIDAK menyentuh DB/jaringan dan bisa diafirmasi 1:1.
 */

function headers(map: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

describe("appOriginFrom", () => {
  it("mengembalikan origin URL valid (scheme + host + port)", () => {
    expect(appOriginFrom("https://erp.example.com")).toBe("https://erp.example.com");
    expect(appOriginFrom("https://erp.example.com/app")).toBe("https://erp.example.com");
    expect(appOriginFrom("https://erp.example.com:8443/x")).toBe("https://erp.example.com:8443");
  });

  it("menormalkan trailing slash", () => {
    expect(appOriginFrom("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("fallback ke strip-slash saat bukan URL valid", () => {
    // Bukan absolute URL -> `new URL` gagal -> fallback replace(/\/+$/, "").
    expect(appOriginFrom("not-a-url///")).toBe("not-a-url");
  });
});

describe("sameOriginViolation", () => {
  const APP = "https://erp.example.com";

  it("lolos bila Origin == APP", () => {
    expect(sameOriginViolation(headers({ origin: APP }), APP)).toBeUndefined();
  });

  it("tolak Origin beda", () => {
    const v = sameOriginViolation(headers({ origin: "https://evil.test" }), APP);
    expect(typeof v).toBe("string");
    expect(v).toContain("origin=https://evil.test");
  });

  it("Origin kosong lebih diprioritaskan daripada Referer", () => {
    // Origin ada & salah -> tetap tolak meski referer benar.
    const v = sameOriginViolation(
      headers({ origin: "https://evil.test", referer: APP + "/journals" }),
      APP,
    );
    expect(v).toContain("origin=");
  });

  it("lolos bila Referer == APP (root exact)", () => {
    expect(sameOriginViolation(headers({ referer: APP }), APP)).toBeUndefined();
  });

  it("lolos bila Referer adalah sub-path APP", () => {
    expect(
      sameOriginViolation(headers({ referer: APP + "/journals/123" }), APP),
    ).toBeUndefined();
  });

  it("tolak Referer beda-origin", () => {
    const v = sameOriginViolation(headers({ referer: "https://evil.test/x" }), APP);
    expect(v).toContain("referer=");
  });

  it("tolak Referer dengan prefix samar (bukan boundary '/')", () => {
    // `https://erp.example.com.evil.test` bukan subdomain APP -> harus tolak.
    const v = sameOriginViolation(headers({ referer: "https://erp.example.com.evil.test" }), APP);
    expect(v).toContain("referer=");
  });

  it("lolos bila Origin & Referer absen (klien non-browser)", () => {
    expect(sameOriginViolation(headers({}), APP)).toBeUndefined();
  });

  it("memotong alasan panjang hingga <=200 char", () => {
    const long = "https://evil.test/" + "a".repeat(300);
    const v = sameOriginViolation(headers({ referer: long }), APP);
    expect(v).toBeDefined();
    // Format "referer=<slice 200>" -> panjang <= 208.
    expect((v ?? "").length).toBeLessThanOrEqual("referer=".length + 200);
  });
});

describe("isUnsafeMethod", () => {
  it("POST/PUT/PATCH/DELETE = true", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect(isUnsafeMethod(m)).toBe(true);
  });

  it("GET/HEAD/OPTIONS = false (metode aman)", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(isUnsafeMethod(m)).toBe(false);
  });

  it("case-insensitive (header bisa variasi)", () => {
    expect(isUnsafeMethod("post")).toBe(true);
    expect(isUnsafeMethod("get")).toBe(false);
  });

  it("UNSAFE_METHODS berisi tepat 4 metode", () => {
    expect([...UNSAFE_METHODS].sort()).toEqual(["DELETE", "PATCH", "POST", "PUT"]);
  });
});

describe("clientIpFrom", () => {
  it("memakai nilai pertama dari x-forwarded-for", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("trim whitespace", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "  203.0.113.7  ,  10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("fallback '0' bila x-forwarded-for absen", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "10.0.0.2" }))).toBe("0");
  });

  it("fallback '0' bila x-forwarded-for kosong total", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "" }))).toBe("0");
    expect(clientIpFrom(headers({ "x-forwarded-for": "  " }))).toBe("0");
  });

  it("fallback '0' bila x-forwarded-for hanya koma", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": ",,," }))).toBe("0");
  });
});

describe("apiGroupFromPath", () => {
  it("mengambil segmen level-1 setelah /api/", () => {
    expect(apiGroupFromPath("/api/journals")).toBe("journals");
    expect(apiGroupFromPath("/api/journals/123")).toBe("journals");
    expect(apiGroupFromPath("/api/ai/assistant/analyze")).toBe("ai");
  });

  it("fallback 'root' untuk path non-api atau hanya /api", () => {
    expect(apiGroupFromPath("/")).toBe("root");
    expect(apiGroupFromPath("/dashboard")).toBe("root");
    expect(apiGroupFromPath("/api")).toBe("root");
  });

  it("health -> 'health' (handler telanjang tidak melalui apiHandler, tetap teruji)", () => {
    expect(apiGroupFromPath("/api/health")).toBe("health");
  });
});

describe("apiBucket", () => {
  it("bentuk stabil api:<grup>:<ip>", () => {
    expect(apiBucket("journals", "1.2.3.4")).toBe("api:journals:1.2.3.4");
  });

  it("grup/IP kosong dinormalisasi", () => {
    expect(apiBucket("", "1.2.3.4")).toBe("api:root:1.2.3.4");
    expect(apiBucket("journals", "")).toBe("api:journals:0");
    expect(apiBucket("", "")).toBe("api:root:0");
  });
});
