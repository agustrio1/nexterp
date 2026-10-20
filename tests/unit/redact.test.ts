import { describe, expect, it } from "vitest";

import {
  buildSummaryData,
  redactAnalysis,
  redactRow,
  TOP_N_ROWS,
} from "@/modules/ai/redact";

/**
 * Unit test minimisasi data untuk prompt AI (Tahap 9C/9D -> diuji 10A).
 * Fungsi SENGAJA murni tanpa DB/jaringan — yang dikirim ke provider harus:
 *   - kolom identitas (id/uuid) dibuang,
 *   - PII (email/telepon/npwp/nik/rekening/password/token/api_key/memo/notes/contact) dibuang,
 *   - untuk laporan PERSONAL (hr-xxx / payroll-xxx) kolom nama orang juga dibuang,
 *   - baris dipotong ke TOP_N_ROWS,
 *   - nilai string/object di-clamp ke 120 karakter.
 */

describe("redactRow — identitas & PII", () => {
  it("membuang kolom id/uuid/pk/fk", () => {
    const out = redactRow(
      { id: "u-1", journal_id: "j-1", uuid: "x", amount: "1000.00" },
      false,
    );
    expect(out).toEqual({ amount: "1000.00" });
  });

  it("membuang PII (email/phone/npwp/nik/rekening/account_number/password/token/api_key/memo/notes/contact)", () => {
    const row = {
      email: "a@b.c",
      phone: "081",
      mobile: "081",
      telepon: "081",
      alamat: "Jl. X",
      address: "X",
      npwp: "11.111.111.1-111.000",
      nik: "3201010101010101",
      rekening: "123",
      account_number: "123",
      accountNumber: "123",
      password: "secret",
      secret: "s",
      token: "t",
      api_key: "k",
      apiKey: "k",
      memo: "internal",
      catatan: "internal",
      notes: "n",
      note: "n",
      contact: "c",
      amount: "1.00",
      account_name: "Kas",
    };
    const out = redactRow(row, false);
    expect(out).toEqual({ amount: "1.00", account_name: "Kas" });
  });

  it("untuk laporan personal, kolom 'nama'/'name'/'employee'/'karyawan'/'candidate'/'pelamar' dibuang", () => {
    const row = {
      name: "Budi",
      nama: "Budi",
      employee: "E-1",
      karyawan: "K-1",
      pegawai: "P-1",
      candidate: "C-1",
      pelamar: "L-1",
      department_name: "Keuangan",
      amount: "1000.00",
    };
    // personalData=true
    expect(redactRow(row, true)).toEqual({ amount: "1000.00" });
    // personalData=false (mis. laporan bisnis) -> nama akun/produk tetap dipertahankan.
    expect(redactRow(row, false)).toEqual({
      name: "Budi",
      nama: "Budi",
      employee: "E-1",
      karyawan: "K-1",
      pegawai: "P-1",
      candidate: "C-1",
      pelamar: "L-1",
      department_name: "Keuangan",
      amount: "1000.00",
    });
  });

  it("clamp string panjang ke 120 char + elipsis", () => {
    const long = "A".repeat(200);
    const out = redactRow({ description: long }, false);
    const value = out.description as string;
    expect(value.length).toBe(121); // 120 + '…'
    expect(value.startsWith("A".repeat(120))).toBe(true);
    expect(value.endsWith("…")).toBe(true);
  });

  it("clamp object besar menjadi string JSON terpotong 120 char + elipsis", () => {
    const big = { arr: Array.from({ length: 100 }, (_, i) => "item-" + i) };
    const out = redactRow({ payload: big }, false);
    // Kontrak clampValue: JSON > 120 char -> string terpotong + '…'.
    expect(typeof out.payload).toBe("string");
    const value = out.payload as string;
    expect(value.length).toBe(121);
    expect(value.endsWith("…")).toBe(true);
  });

  it("object kecil (JSON <= 120 char) tetap dipertahankan sebagai object", () => {
    const small = { a: 1, b: "x" };
    const out = redactRow({ payload: small }, false);
    expect(out.payload).toEqual(small);
  });

  it("undefined/null/primitive tetap lolos", () => {
    expect(redactRow({ x: null, y: 0, z: false, w: undefined }, false)).toEqual({
      x: null,
      y: 0,
      z: false,
      w: undefined,
    });
  });
});

describe("buildSummaryData — TOP_N_ROWS", () => {
  it("memotong sample ke TOP_N_ROWS (default)", () => {
    const rows = Array.from({ length: TOP_N_ROWS + 5 }, (_, i) => ({
      code: `A${i}`,
      amount: "1.00",
    }));
    const summary = buildSummaryData({
      reportKey: "trial-balance",
      reportLabel: "Neraca Saldo",
      filter: { from: "2026-01-01" },
      rows,
    });
    expect(summary.rowCount).toBe(TOP_N_ROWS + 5);
    expect(summary.sample.length).toBe(TOP_N_ROWS);
  });

  it("topN kustom dihormati", () => {
    const rows = Array.from({ length: 10 }, () => ({ amount: "1" }));
    const s = buildSummaryData({
      reportKey: "trial-balance",
      reportLabel: "x",
      filter: {},
      rows,
      topN: 3,
    });
    expect(s.sample.length).toBe(3);
  });

  it("reportKey personal (hr-attendance) -> kolom nama dibuang", () => {
    const s = buildSummaryData({
      reportKey: "hr-attendance",
      reportLabel: "Absensi",
      filter: {},
      rows: [{ nama: "Budi", check_in: "08:00", employee_id: "E-1" }],
    });
    expect(s.sample[0]).toEqual({ check_in: "08:00" });
  });

  it("reportKey bisnis (trial-balance) -> nama akun dipertahankan", () => {
    const s = buildSummaryData({
      reportKey: "trial-balance",
      reportLabel: "Neraca Saldo",
      filter: {},
      rows: [{ name: "Kas", amount: "1000.00" }],
    });
    expect(s.sample[0]).toEqual({ name: "Kas", amount: "1000.00" });
  });

  it("echo filter, bukan nilai baris", () => {
    const s = buildSummaryData({
      reportKey: "ar-aging",
      reportLabel: "Aging AR",
      filter: { from: "2026-01-01", to: "2026-12-31", branchId: "b-1" },
      rows: [],
    });
    expect(s.filter).toEqual({ from: "2026-01-01", to: "2026-12-31", branchId: "b-1" });
  });
});

describe("redactAnalysis (Tahap 9D)", () => {
  it("memotong series & flags ke topN; personalData=false (analisis non-personal)", () => {
    const outcome = {
      analysisKey: "income-trend",
      analysisLabel: "Tren Pendapatan",
      params: { from: "2026-01-01", to: "2026-12-31" },
      metrics: { totalNet: "3800000.00", periodCount: 12 },
      series: Array.from({ length: TOP_N_ROWS + 3 }, (_, i) => ({
        period: `P${i}`,
        nama_akun: "Pendapatan",
        id: "should-be-dropped",
        net: "1000",
      })),
      flags: Array.from({ length: TOP_N_ROWS + 3 }, () => ({
        name: "budget-overrun",
        email: "leak@example.com",
        severity: "high",
      })),
    };
    const s = redactAnalysis(outcome as never);
    expect(s.series.length).toBe(TOP_N_ROWS);
    expect(s.flags.length).toBe(TOP_N_ROWS);
    // Column `id` dibuang pada series (identifier).
    expect(s.series[0]).not.toHaveProperty("id");
    expect(s.series[0]).toHaveProperty("nama_akun", "Pendapatan");
    // Column `email` dibuang pada flags (PII).
    expect(s.flags[0]).not.toHaveProperty("email");
    // Karena personalData=false, `name` TETAP dipertahankan (label teknis).
    expect(s.flags[0]).toHaveProperty("name", "budget-overrun");
  });

  it("series/flags absen (analisis tanpa time-series) -> array kosong", () => {
    const s = redactAnalysis({
      analysisKey: "x",
      analysisLabel: "X",
      params: {},
      metrics: { n: 1 },
    } as never);
    expect(s.series).toEqual([]);
    expect(s.flags).toEqual([]);
  });
});
