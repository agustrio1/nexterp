import { describe, expect, it } from "vitest";

import {
  JOB_STATUSES,
  JOB_TYPES,
  enqueueExportSchema,
  enqueuePayrollRunSchema,
  exportPayloadSchema,
  listJobsQuerySchema,
  payrollRunPayloadSchema,
} from "@/modules/jobs/schemas";

/**
 * Unit test skema Zod job latar belakang (Tahap 8D -> diuji 10A).
 * Menjamin:
 * - enum nilai literal cocok dengan `job_type`/`job_status` di skema DB,
 * - guard panjang/limit idempotensi & maxAttempts (safety rails),
 * - payload export/payroll strictObject (tidak menerima kunci asing),
 * - query daftar (listJobsQuerySchema) punya default paginasi & filter enum.
 */

describe("konstanta enum literal", () => {
  it("JOB_TYPES mencakup tepat export.report + payroll.run", () => {
    expect([...JOB_TYPES].sort()).toEqual(["export.report", "payroll.run"]);
  });

  it("JOB_STATUSES mencakup lima state antrean (queued/running/succeeded/failed/cancelled)", () => {
    expect([...JOB_STATUSES].sort()).toEqual(
      ["cancelled", "failed", "queued", "running", "succeeded"].sort(),
    );
  });
});

describe("enqueueExportSchema (POST /api/reports/export)", () => {
  it("bentuk minimum valid", () => {
    const ok = enqueueExportSchema.parse({ reportKey: "trial-balance" });
    expect(ok.reportKey).toBe("trial-balance");
    expect(ok.query).toBeUndefined();
  });

  it("reportKey max 64, min 1", () => {
    expect(() => enqueueExportSchema.parse({ reportKey: "" })).toThrow();
    expect(() => enqueueExportSchema.parse({ reportKey: "x".repeat(65) })).toThrow();
  });

  it("idempotencyKey max 120", () => {
    expect(() =>
      enqueueExportSchema.parse({ reportKey: "x", idempotencyKey: "K".repeat(121) }),
    ).toThrow();
    expect(() => enqueueExportSchema.parse({ reportKey: "x", idempotencyKey: "" })).toThrow();
  });

  it("runAt menerima ISO date, menolak format lain", () => {
    expect(
      enqueueExportSchema.parse({ reportKey: "x", runAt: "2026-10-20" }).runAt,
    ).toBe("2026-10-20");
    expect(() => enqueueExportSchema.parse({ reportKey: "x", runAt: "20-10-2026" })).toThrow();
  });

  it("maxAttempts integer 1..10", () => {
    expect(enqueueExportSchema.parse({ reportKey: "x", maxAttempts: 1 }).maxAttempts).toBe(1);
    expect(enqueueExportSchema.parse({ reportKey: "x", maxAttempts: 10 }).maxAttempts).toBe(10);
    expect(() => enqueueExportSchema.parse({ reportKey: "x", maxAttempts: 0 })).toThrow();
    expect(() => enqueueExportSchema.parse({ reportKey: "x", maxAttempts: 11 })).toThrow();
    expect(() => enqueueExportSchema.parse({ reportKey: "x", maxAttempts: 1.5 })).toThrow();
  });

  it("strict: kunci asing ditolak", () => {
    expect(() =>
      enqueueExportSchema.parse({ reportKey: "x", unexpected: 1 } as never),
    ).toThrow();
  });
});

describe("exportPayloadSchema (isi jsonb payload)", () => {
  it("query boleh object kosong dan nested record", () => {
    const p = exportPayloadSchema.parse({
      reportKey: "trial-balance",
      query: { from: "2026-01-01", to: "2026-12-31" },
    });
    expect(p.reportKey).toBe("trial-balance");
    expect(p.query).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("strict: tanpa query ditolak", () => {
    expect(() => exportPayloadSchema.parse({ reportKey: "x" } as never)).toThrow();
  });
});

describe("enqueuePayrollRunSchema + payrollRunPayloadSchema", () => {
  const UUID_A = "00000000-0000-4000-8000-000000000001";

  it("runId wajib UUID", () => {
    expect(enqueuePayrollRunSchema.parse({ runId: UUID_A }).runId).toBe(UUID_A);
    expect(() => enqueuePayrollRunSchema.parse({ runId: "abc" })).toThrow();
  });

  it("payrollRunPayloadSchema strict { runId: uuid }", () => {
    expect(payrollRunPayloadSchema.parse({ runId: UUID_A })).toEqual({ runId: UUID_A });
    expect(() => payrollRunPayloadSchema.parse({ runId: UUID_A, extra: 1 } as never)).toThrow();
  });
});

describe("listJobsQuerySchema (query daftar job)", () => {
  it("default limit=20, tanpa cursor, tanpa filter", () => {
    const q = listJobsQuerySchema.parse({});
    expect(q).toEqual({ limit: 20 });
  });

  it("filter status harus salah satu JOB_STATUSES", () => {
    expect(listJobsQuerySchema.parse({ status: "queued" }).status).toBe("queued");
    expect(() => listJobsQuerySchema.parse({ status: "not-a-status" })).toThrow();
  });

  it("filter type harus salah satu JOB_TYPES", () => {
    expect(listJobsQuerySchema.parse({ type: "export.report" }).type).toBe("export.report");
    expect(() => listJobsQuerySchema.parse({ type: "unknown" })).toThrow();
  });

  it("createdBy wajib UUID", () => {
    const uuid = "00000000-0000-4000-8000-000000000001";
    expect(listJobsQuerySchema.parse({ createdBy: uuid }).createdBy).toBe(uuid);
    expect(() => listJobsQuerySchema.parse({ createdBy: "bukan-uuid" })).toThrow();
  });

  it("limit > 100 ditolak (paginasi keyset proteksi DB)", () => {
    expect(() => listJobsQuerySchema.parse({ limit: "101" })).toThrow();
  });

  it("cursor string opaque diterima (keyset 10C)", () => {
    const q = listJobsQuerySchema.parse({ cursor: "eyJ0IjoieSJ9" });
    expect(q.cursor).toBe("eyJ0IjoieSJ9");
  });
});
