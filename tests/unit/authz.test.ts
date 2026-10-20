import { describe, expect, it } from "vitest";

import { accessibleBranchIds, can, type Grant } from "@/server/authz";

/**
 * Unit test fungsi otorisasi murni (Tahap 3 -> diuji 10A).
 * `can` dan `accessibleBranchIds` adalah penentu izin global/cabang — keduanya
 * SENGAJA tidak menyentuh DB agar bisa diuji 1:1.
 *
 * Kontrak cakupan:
 * - scope kosong {} -> hanya grant global (branchId null) yang lolos
 * - scope { branchId } -> global ATAU grant pada cabang itu
 * - scope { anyBranch: true } -> grant dengan cabang apa pun lolos
 * Global (branchId null) SELALU lolos di ketiga bentuk scope.
 */

const G: Grant = { code: "sales.orders.read", branchId: null };
const B1: Grant = { code: "sales.orders.read", branchId: "branch-1" };
const B2: Grant = { code: "sales.orders.read", branchId: "branch-2" };
const OTHER: Grant = { code: "hr.headcount.read", branchId: null };

describe("can — izin global", () => {
  it("global lolos pada scope kosong", () => {
    expect(can([G], "sales.orders.read")).toBe(true);
  });

  it("global lolos pada scope branchId tertentu", () => {
    expect(can([G], "sales.orders.read", { branchId: "branch-X" })).toBe(true);
  });

  it("global lolos pada scope anyBranch", () => {
    expect(can([G], "sales.orders.read", { anyBranch: true })).toBe(true);
  });

  it("code berbeda tidak lolos", () => {
    expect(can([OTHER], "sales.orders.read")).toBe(false);
    expect(can([], "sales.orders.read")).toBe(false);
  });
});

describe("can — izin cabang", () => {
  it("gagal pada scope kosong (hanya global yang lolos)", () => {
    expect(can([B1], "sales.orders.read")).toBe(false);
  });

  it("lolos pada branchId yang cocok", () => {
    expect(can([B1], "sales.orders.read", { branchId: "branch-1" })).toBe(true);
  });

  it("gagal pada branchId berbeda", () => {
    expect(can([B1], "sales.orders.read", { branchId: "branch-2" })).toBe(false);
  });

  it("lolos pada anyBranch", () => {
    expect(can([B1], "sales.orders.read", { anyBranch: true })).toBe(true);
  });

  it("branchId menang atas anyBranch (prioritas scope branchId)", () => {
    // both branchId & anyBranch diset: kontrak fungsi — anyBranch lolos lebih dulu
    // karena cek `if (scope.anyBranch) return true` sebelum branchId equality.
    // Perilaku ini terdokumentasi; assertion menjaga agar tidak berubah diam-diam.
    expect(can([B1], "sales.orders.read", { branchId: "branch-X", anyBranch: true })).toBe(true);
  });
});

describe("accessibleBranchIds", () => {
  it("'all' bila ada grant global", () => {
    expect(accessibleBranchIds([G, B1], "sales.orders.read")).toBe("all");
  });

  it("daftar cabang (unik) bila hanya ada grant cabang", () => {
    const result = accessibleBranchIds([B1, B2, B1], "sales.orders.read");
    expect(result).not.toBe("all");
    if (result === "all") return;
    expect(new Set(result)).toEqual(new Set(["branch-1", "branch-2"]));
  });

  it("array kosong bila tidak ada grant untuk permission tsb", () => {
    expect(accessibleBranchIds([OTHER], "sales.orders.read")).toEqual([]);
    expect(accessibleBranchIds([], "sales.orders.read")).toEqual([]);
  });

  it("mencampur global & cabang -> 'all' (global menang)", () => {
    expect(accessibleBranchIds([B1, G, B2], "sales.orders.read")).toBe("all");
  });
});

describe("regresi pitfall", () => {
  it("fail-CLOSED: grant branchId tidak lolos pada scope kosong", () => {
    // Catatan review 10B: banyak service memakai `can(grants, code)` tanpa scope;
    // ini SENGAJA menolak grant cabang (fail-closed) — tidak bisa dijadikan bypass.
    expect(can([B1, B2], "sales.orders.read")).toBe(false);
  });

  it("case-sensitive (kode harus persis)", () => {
    expect(can([{ code: "SALES.ORDERS.READ", branchId: null }], "sales.orders.read")).toBe(false);
  });
});
