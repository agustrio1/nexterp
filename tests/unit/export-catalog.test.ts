import { describe, expect, it } from "vitest";

import {
  EXPORT_ENTRIES,
  findExportEntry,
  listExportCatalog,
} from "@/modules/reporting/export-catalog";

/**
 * Unit test katalog ekspor CSV (Tahap 8D -> diuji 10A).
 * Modul ini murni registrasi: tidak query DB saat import (pg Pool lazy,
 * `build()` hanya dipanggil worker saat job berjalan). Fokus uji:
 *   - integritas katalog (key unik, label & permission terisi),
 *   - `findExportEntry` lookup + fallback undefined,
 *   - `listExportCatalog` hanya mengekspos { key, label, permission }
 *     (tidak membocorkan `build`/`parseQuery` ke API).
 */

const EXPECTED_KEYS = [
  "trial-balance",
  "general-ledger",
  "income-statement",
  "balance-sheet",
  "cost-center",
  "cash-book",
  "budget-realization",
  "cash-flow",
  "ar-aging",
  "sales",
  "ar-reconciliation",
  "ap-aging",
  "purchase",
  "ap-reconciliation",
  "stock-card",
  "inventory-valuation",
  "reorder",
  "expiry-schedule",
  "hr-headcount",
  "hr-attendance",
  "hr-leave-balances",
  "payroll-by-department",
  "payslip-register",
  "payroll-reconciliation",
  "asset-register",
  "asset-reconciliation",
  "project-profitability",
];

describe("EXPORT_ENTRIES — integritas katalog", () => {
  it("mencakup tepat 27 laporan yang terdaftar di doc.md (Tahap 8D)", () => {
    expect(EXPORT_ENTRIES.length).toBe(27);
    expect(EXPORT_ENTRIES.length).toBe(EXPECTED_KEYS.length);
  });

  it("setiap entri punya key/label/permission + fungsi parseQuery/build", () => {
    for (const entry of EXPORT_ENTRIES) {
      expect(typeof entry.key).toBe("string");
      expect(entry.key.length).toBeGreaterThan(0);
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      // PermissionCode: format `<module>.<resource>.<action>` (titik, non-kosong).
      expect(entry.permission).toMatch(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/i);
      expect(typeof entry.parseQuery).toBe("function");
      expect(typeof entry.build).toBe("function");
    }
  });

  it("key unik (tidak ada duplikat) — prasyarat Map BY_KEY", () => {
    const keys = EXPORT_ENTRIES.map((e) => e.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("label unik secara visual (tidak ada 2 laporan dengan label identik)", () => {
    const labels = EXPORT_ENTRIES.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("setiap key yang diharapkan hadir, tanpa extra", () => {
    const keys = new Set(EXPORT_ENTRIES.map((e) => e.key));
    for (const k of EXPECTED_KEYS) expect(keys.has(k)).toBe(true);
    // Tidak ada entri tak terduga (guard bila entri baru ditambahkan tanpa update uji).
    for (const k of keys) expect(EXPECTED_KEYS).toContain(k);
  });
});

describe("findExportEntry — lookup", () => {
  it("mengembalikan entri lengkap untuk key yang dikenal", () => {
    const entry = findExportEntry("trial-balance");
    expect(entry).toBeDefined();
    expect(entry?.key).toBe("trial-balance");
    expect(entry?.label).toBe("Neraca Saldo");
    expect(entry?.permission).toBe("accounting.reports.read");
  });

  it("mengembalikan undefined untuk key tak dikenal (bukan throw)", () => {
    expect(findExportEntry("tidak-ada")).toBeUndefined();
    expect(findExportEntry("")).toBeUndefined();
  });

  it("lookup konsisten dengan iterasi EXPORT_ENTRIES", () => {
    for (const entry of EXPORT_ENTRIES) {
      expect(findExportEntry(entry.key)).toBe(entry);
    }
  });
});

describe("listExportCatalog — proyeksi aman untuk API/UI", () => {
  it("memiliki jumlah yang sama dengan EXPORT_ENTRIES", () => {
    expect(listExportCatalog().length).toBe(EXPORT_ENTRIES.length);
  });

  it("hanya mengekspos { key, label, permission } — tanpa build/parseQuery", () => {
    for (const view of listExportCatalog()) {
      expect(Object.keys(view).sort()).toEqual(["key", "label", "permission"]);
      // Guard: fungsi sensitif tidak ikut ter-ekspor ke JSON response.
      expect(view).not.toHaveProperty("build");
      expect(view).not.toHaveProperty("parseQuery");
    }
  });

  it("menjaga urutan katalog (stabil untuk UI)", () => {
    const view = listExportCatalog();
    for (let i = 0; i < view.length; i += 1) {
      expect(view[i]?.key).toBe(EXPORT_ENTRIES[i]?.key);
      expect(view[i]?.label).toBe(EXPORT_ENTRIES[i]?.label);
      expect(view[i]?.permission).toBe(EXPORT_ENTRIES[i]?.permission);
    }
  });
});

describe("Permission mapping — guard cross-module", () => {
  const PERM_BY_KEY: Record<string, string> = {
    "trial-balance": "accounting.reports.read",
    "general-ledger": "accounting.reports.read",
    "income-statement": "accounting.reports.read",
    "balance-sheet": "accounting.reports.read",
    "cost-center": "accounting.reports.read",
    "cash-book": "accounting.reports.read",
    "budget-realization": "accounting.reports.read",
    "cash-flow": "accounting.reports.read",
    "ar-aging": "sales.ar.read",
    sales: "sales.reports.read",
    "ar-reconciliation": "sales.reports.read",
    "ap-aging": "purchasing.ap.read",
    purchase: "purchasing.reports.read",
    "ap-reconciliation": "purchasing.reports.read",
    "stock-card": "inventory.stock.read",
    "inventory-valuation": "inventory.stock.read",
    reorder: "inventory.stock.read",
    "expiry-schedule": "inventory.stock.read",
    "hr-headcount": "hr.reports.read",
    "hr-attendance": "hr.reports.read",
    "hr-leave-balances": "hr.reports.read",
    "payroll-by-department": "payroll.reports.read",
    "payslip-register": "payroll.reports.read",
    "payroll-reconciliation": "payroll.reports.read",
    "asset-register": "assets.reports.read",
    "asset-reconciliation": "assets.reports.read",
    "project-profitability": "projects.reports.read",
  };

  it("setiap laporan memakai permission read modul sumber (bukan manage/write)", () => {
    for (const entry of EXPORT_ENTRIES) {
      expect(entry.permission).toBe(PERM_BY_KEY[entry.key]);
      expect(entry.permission).toMatch(/\.read$/);
    }
  });
});
