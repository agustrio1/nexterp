import { eq } from "drizzle-orm";

import {
  accounts,
  accountingPeriods,
  approvalRequests,
  approvalWorkflowSteps,
  approvalWorkflows,
  assetCategories,
  bankAccounts,
  branches,
  budgetLines,
  budgets,
  chartAccounts,
  companyProfile,
  costCenters,
  crmAccounts,
  crmPipelineStages,
  customers,
  departments,
  employees,
  exchangeRates,
  fiscalYears,
  leaveTypes,
  paymentTerms,
  permissions as dbPermissions,
  positions,
  productCategories,
  products,
  rolePermissions,
  roles,
  salaryComponents,
  shifts,
  suppliers,
  taxRates,
  taxes,
  unitConversions,
  unitsOfMeasure,
  userRoles,
  users,
  warehouseLocations,
  warehouses,
} from "@/db/schema";
import { allPermissions } from "@/modules/permissions";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";

/**
 * Seed master data demo — mengisi SELURUH data master/referensi agar setiap
 * halaman UI punya isi tanpa perlu mengetik manual.
 *
 * SIFAT:
 *  - DE_MO. Kolom description/notes/source yang ada diberi awalan "[DEMO]"
 *    agar mudah dibedakan dari data produksi.
 *  - IDEMPOTEN. Semua insert memakai ON CONFLICT DO NOTHING pada kunci kode;
 *    baris yang sudah ada DILEWATI, tidak ditimpa. Aman dijalankan berulang.
 *  - SATU TRANSAKSI. Gagal di titik mana pun = rollback total.
 *  - HANYA MASTER/REFERENSI. Tidak menulis transaksi finansial/stok (jurnal,
 *    PO, pergerakan stok, run payroll) — itu domain engine. Pengecualian sadar
 *    dan tetap berstatus draf/pending: 1 anggaran draft + barisnya dan 2
 *    pengajuan persetujuan pending.
 *
 * PRASYARAT (berurutan):
 *   bun run db:seed                # permission, super_admin, currencies, settings
 *   bun run db:seed-coa            # bagan akun (kode 1000..5300)
 *   bun run db:seed-cost-centers   # hierarki pusat biaya
 *   bun run db:seed:demo           # skrip ini
 *
 * Password pengguna demo dibaca dari env DEMO_PASSWORD (default "Password321!"
 * — password demo publik, BUKAN untuk produksi).
 */

const DEMO = "[DEMO]";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Password321!";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function note(base: string): string {
  return `${DEMO} ${base}`;
}

/** Ambil id akun COA berdasar kode; error jelas bila seed-coa belum jalan. */
async function requireAccountId(tx: Tx, code: string): Promise<string> {
  const [row] = await tx
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(eq(chartAccounts.code, code))
    .limit(1);
  if (!row) {
    throw new Error(`Akun COA ${code} tidak ditemukan. Jalankan \`bun run db:seed-coa\` dulu.`);
  }
  return row.id;
}

/** UUID deterministik (bukan acak) dari kunci, agar pengajuan demo idempoten. */
function stableUuid(key: string): string {
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < key.length; i++) bytes[i % 16] = (bytes[i % 16] ?? 0) ^ key.charCodeAt(i);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ------------------------------------------------------------------ */
/* Data master demo                                                   */
/* ------------------------------------------------------------------ */

const seedBranches = [
  { code: "HQ", name: "Kantor Pusat Jakarta", address: "Jl. Jend. Sudirman No. 1, Jakarta Selatan", phone: "021-5550001" },
  { code: "BR-002", name: "Cabang Bandung", address: "Jl. Asia Afrika No. 88, Bandung", phone: "022-5550002" },
  { code: "BR-003", name: "Cabang Surabaya", address: "Jl. Basuki Rahmat No. 21, Surabaya", phone: "031-5550003" },
];

/** Induk selalu sebelum anak (dipetakan bertahap saat insert). */
const seedDepartments = [
  { code: "DEP-ADM", name: "Administrasi & Keuangan", parentCode: null, branchCode: null },
  { code: "DEP-FIN", name: "Keuangan & Akuntansi", parentCode: "DEP-ADM", branchCode: null },
  { code: "DEP-HR", name: "SDM & Umum", parentCode: "DEP-ADM", branchCode: null },
  { code: "DEP-IT", name: "Teknologi Informasi", parentCode: "DEP-ADM", branchCode: null },
  { code: "DEP-OPS", name: "Operasi", parentCode: null, branchCode: null },
  { code: "DEP-PROD", name: "Produksi", parentCode: "DEP-OPS", branchCode: null },
  { code: "DEP-QC", name: "Pengendalian Mutu", parentCode: "DEP-OPS", branchCode: null },
  { code: "DEP-PROC", name: "Pengadaan", parentCode: "DEP-OPS", branchCode: null },
  { code: "DEP-WH", name: "Gudang Bandung", parentCode: "DEP-OPS", branchCode: "BR-002" },
  { code: "DEP-SALES", name: "Penjualan", parentCode: null, branchCode: "HQ" },
  { code: "DEP-MKT", name: "Pemasaran", parentCode: "DEP-SALES", branchCode: "HQ" },
];

/** Tambahan COA yang dibutuhkan relasi master dan belum ada di seed-coa. */
const extraAccounts: { code: string; name: string; type: "asset" | "liability"; parentCode: string }[] = [
  { code: "1113", name: "Bank Mandiri IDR", type: "asset", parentCode: "1110" },
  { code: "1115", name: "PPN Masukan", type: "asset", parentCode: "1100" },
  { code: "2131", name: "PPN Keluaran", type: "liability", parentCode: "2100" },
  { code: "2132", name: "Utang PPh 21", type: "liability", parentCode: "2100" },
  { code: "2133", name: "Utang PPh 23", type: "liability", parentCode: "2100" },
  { code: "2140", name: "Utang BPJS", type: "liability", parentCode: "2100" },
];

const seedTaxes = [
  { code: "PPN-OUT", name: "PPN Keluaran 11%", kind: "output", account: "2131", rate: "11", source: "UU HPP / PMK terkait (demo)" },
  { code: "PPN-IN", name: "PPN Masukan 11%", kind: "input", account: "1115", rate: "11", source: "UU HPP / PMK terkait (demo)" },
  { code: "PPH21", name: "PPh 21 Potongan Karyawan", kind: "withholding", account: "2132", rate: "5", source: "Tarif demo flat; progresif dihitung di modul payroll/statutory" },
  { code: "PPH23", name: "PPh 23 Jasa", kind: "withholding", account: "2133", rate: "2", source: "PP 50/2022 (demo)" },
] as const;

const seedUnits = [
  { code: "PCS", name: "Pieces", symbol: "pcs" },
  { code: "BOX", name: "Kotak", symbol: "box" },
  { code: "KRT", name: "Karton", symbol: "krt" },
  { code: "DSN", name: "Lusin", symbol: "dsn" },
  { code: "KG", name: "Kilogram", symbol: "kg" },
  { code: "LTR", name: "Liter", symbol: "L" },
  { code: "MTR", name: "Meter", symbol: "m" },
  { code: "SET", name: "Set", symbol: "set" },
  { code: "SRV", name: "Jasa/Service", symbol: "svc" },
];

const seedCategories = [
  { code: "BAHAN", name: "Bahan Baku", parentCode: null },
  { code: "BAHAN-UTAMA", name: "Bahan Utama", parentCode: "BAHAN" },
  { code: "KEMAS", name: "Bahan Kemas", parentCode: "BAHAN" },
  { code: "DAGANGAN", name: "Barang Dagangan", parentCode: null },
  { code: "JASA", name: "Jasa", parentCode: null },
];

const seedProducts = [
  { sku: "RM-001", name: "Tepung Terigu Protein Tinggi", unit: "KG", cat: "BAHAN-UTAMA", canPurchase: true, canSell: false, reorder: "100" },
  { sku: "RM-002", name: "Gula Pasir", unit: "KG", cat: "BAHAN-UTAMA", canPurchase: true, canSell: false, reorder: "50" },
  { sku: "RM-003", name: "Minyak Goreng Sawit", unit: "LTR", cat: "BAHAN-UTAMA", canPurchase: true, canSell: false, reorder: "80" },
  { sku: "PKG-001", name: "Standing Pouch Aluminium 250g", unit: "PCS", cat: "KEMAS", canPurchase: true, canSell: false, reorder: "500" },
  { sku: "FG-001", name: "Kue Kering Premium 200g", unit: "BOX", cat: "DAGANGAN", canPurchase: false, canSell: true, reorder: null },
  { sku: "FG-002", name: "Kopi Bubuk Arabika 150g", unit: "BOX", cat: "DAGANGAN", canPurchase: false, canSell: true, reorder: "20" },
  { sku: "TRD-001", name: "Mug Keramik 300ml", unit: "SET", cat: "DAGANGAN", canPurchase: true, canSell: true, reorder: "30" },
  { sku: "SRV-001", name: "Jasa Konsultasi Kemasan", unit: "SRV", cat: "JASA", canPurchase: false, canSell: true, reorder: null },
];

const seedPositions = [
  { code: "POS-MGR", name: "Manajer Operasional", dept: "DEP-ADM", grade: 8 },
  { code: "POS-FINM", name: "Manajer Keuangan", dept: "DEP-FIN", grade: 7 },
  { code: "POS-ACC", name: "Akuntan", dept: "DEP-FIN", grade: 5 },
  { code: "POS-CASH", name: "Kasir", dept: "DEP-FIN", grade: 3 },
  { code: "POS-HR", name: "Staf SDM", dept: "DEP-HR", grade: 4 },
  { code: "POS-WH", name: "Staf Gudang", dept: "DEP-WH", grade: 3 },
  { code: "POS-SLS", name: "Sales Executive", dept: "DEP-SALES", grade: 3 },
  { code: "POS-PROD", name: "Supervisor Produksi", dept: "DEP-PROD", grade: 5 },
  { code: "POS-PUR", name: "Staf Pengadaan", dept: "DEP-PROC", grade: 4 },
];

/** `link` = email pengguna demo yang ditautkan sebagai login karyawan. */
const seedEmployees = [
  { code: "EMP-0001", first: "Budi", last: "Hartono", pos: "POS-MGR", dept: "DEP-ADM", branch: "HQ", joined: "2020-01-06", email: "budi@erp.com", link: "manager@erp.com" },
  { code: "EMP-0002", first: "Sari", last: "Melati", pos: "POS-ACC", dept: "DEP-FIN", branch: "HQ", joined: "2021-03-01", email: "sari@erp.com", link: "akuntan@erp.com" },
  { code: "EMP-0003", first: "Andi", last: "Wijaya", pos: "POS-HR", dept: "DEP-HR", branch: "HQ", joined: "2021-07-12", email: "andi@erp.com", link: "hr@erp.com" },
  { code: "EMP-0004", first: "Rina", last: "Kusuma", pos: "POS-WH", dept: "DEP-WH", branch: "BR-002", joined: "2022-02-07", email: "rina@erp.com", link: "gudang@erp.com" },
  { code: "EMP-0005", first: "Joko", last: "Susilo", pos: "POS-SLS", dept: "DEP-SALES", branch: "HQ", joined: "2022-05-16", email: "joko@erp.com", link: "sales@erp.com" },
  { code: "EMP-0006", first: "Dewi", last: "Lestari", pos: "POS-PROD", dept: "DEP-PROD", branch: "BR-002", joined: "2020-09-01", email: "dewi@erp.com", link: null },
  { code: "EMP-0007", first: "Agus", last: "Santoso", pos: "POS-PUR", dept: "DEP-PROC", branch: "HQ", joined: "2023-01-09", email: "agus@erp.com", link: "purchasing@erp.com" },
  { code: "EMP-0008", first: "Endah", last: "Puspita", pos: "POS-FINM", dept: "DEP-FIN", branch: "HQ", joined: "2019-04-15", email: "endah@erp.com", link: null },
  { code: "EMP-0009", first: "Lia", last: "Apriyani", pos: "POS-CASH", dept: "DEP-FIN", branch: "HQ", joined: "2023-06-12", email: "lia@erp.com", link: "kasir@erp.com" },
];

const seedUsers = [
  { email: "akuntan@erp.com", name: "Sari Melati", role: "finance_staff" },
  { email: "kasir@erp.com", name: "Lia Apriyani", role: "cashier" },
  { email: "gudang@erp.com", name: "Rina Kusuma", role: "warehouse_staff" },
  { email: "purchasing@erp.com", name: "Agus Santoso", role: "purchasing_staff" },
  { email: "sales@erp.com", name: "Joko Susilo", role: "sales_staff" },
  { email: "hr@erp.com", name: "Andi Wijaya", role: "hr_staff" },
  { email: "manager@erp.com", name: "Budi Hartono", role: "manager_demo" },
];

const roleDefs: { code: string; name: string; pick: (code: string) => boolean }[] = [
  { code: "finance_staff", name: "Staf Keuangan", pick: (c) => c.startsWith("accounting.") && !c.endsWith("post_closed_period") },
  { code: "cashier", name: "Kasir", pick: (c) => ["accounting.cash_transactions.read", "accounting.cash_transactions.manage", "accounting.bank_accounts.read", "accounting.bank_reconciliations.read", "accounting.bank_reconciliations.manage", "accounting.journals.read", "core.approvals.read", "core.approvals.request", "reporting.dashboards.read"].includes(c) },
  { code: "warehouse_staff", name: "Staf Gudang", pick: (c) => c.startsWith("inventory.") || ["purchasing.receipts.read", "purchasing.receipts.manage", "purchasing.purchase_orders.read", "core.approvals.read", "core.approvals.request"].includes(c) },
  { code: "purchasing_staff", name: "Staf Pengadaan", pick: (c) => c.startsWith("purchasing.") || ["inventory.products.read", "inventory.stock.read", "core.approvals.read", "core.approvals.request", "core.approvals.act"].includes(c) },
  { code: "sales_staff", name: "Staf Penjualan", pick: (c) => c.startsWith("sales.") || c.startsWith("crm.") || ["inventory.products.read", "core.approvals.read", "core.approvals.request"].includes(c) },
  { code: "hr_staff", name: "Staf SDM", pick: (c) => c.startsWith("hr.") || (c.startsWith("payroll.") && c !== "payroll.runs.post") },
  { code: "manager_demo", name: "Manajer (approver demo)", pick: (c) => c.endsWith(".read") || ["core.approvals.act", "reporting.dashboards.read", "ai.assistant.use"].includes(c) },
];

/* ------------------------------------------------------------------ */
/* Utama                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  // Hash dihitung di luar transaksi (operasi CPU), dipakai semua pengguna demo.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await db.transaction(async (tx) => {
    /* 0. Prasyarat */
    const [superAdmin] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, "super_admin")).limit(1);
    if (!superAdmin) throw new Error("Role super_admin belum ada. Jalankan `bun run db:seed` dulu.");
    const permRows = await tx.select({ id: dbPermissions.id, code: dbPermissions.code }).from(dbPermissions);
    if (permRows.length === 0) throw new Error("Permission belum terisi. Jalankan `bun run db:seed` dulu.");
    const permIdByCode = new Map(permRows.map((p) => [p.code, p.id]));
    await requireAccountId(tx, "1111"); // gagal cepat bila seed-coa belum jalan

    /* 1. Profil perusahaan (singleton id=1) */
    await tx
      .insert(companyProfile)
      .values({
        legalName: "PT Demo Nusantara Perkasa",
        tradeName: "Demo ERP",
        taxId: "01.234.567.8-901.000",
        address: "Jl. Jend. Sudirman No. 1",
        city: "Jakarta Selatan",
        province: "DKI Jakarta",
        postalCode: "12190",
        phone: "021-5550001",
        email: "info@demo-erp.test",
        website: "https://demo-erp.test",
      })
      .onConflictDoNothing();

    /* 2. Cabang */
    await tx.insert(branches).values(seedBranches.map((b) => ({ ...b, isActive: true }))).onConflictDoNothing({ target: branches.code });
    const branchRows = await tx.select({ id: branches.id, code: branches.code }).from(branches);
    const branchId = new Map(branchRows.map((r) => [r.code, r.id]));

    /* 3. Departemen (induk dipetakan lebih dulu) */
    const deptId = new Map<string, string>();
    for (const d of seedDepartments) {
      await tx
        .insert(departments)
        .values({
          code: d.code,
          name: d.name,
          parentId: d.parentCode ? (deptId.get(d.parentCode) ?? null) : null,
          branchId: d.branchCode ? (branchId.get(d.branchCode) ?? null) : null,
          isActive: true,
        })
        .onConflictDoNothing({ target: departments.code });
      const [row] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.code, d.code)).limit(1);
      if (row) deptId.set(d.code, row.id);
    }

    /* 4. Tahun fiskal 2026 + 12 periode reguler + periode 13 penyesuaian */
    await tx
      .insert(fiscalYears)
      .values({ code: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open" })
      .onConflictDoNothing({ target: fiscalYears.code });
    const [fy] = await tx.select({ id: fiscalYears.id }).from(fiscalYears).where(eq(fiscalYears.code, "FY2026")).limit(1);
    if (!fy) throw new Error("FY2026 gagal dibuat.");
    const monthRanges: [string, string][] = [
      ["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-31"],
      ["2026-04-01", "2026-04-30"], ["2026-05-01", "2026-05-31"], ["2026-06-01", "2026-06-30"],
      ["2026-07-01", "2026-07-31"], ["2026-08-01", "2026-08-31"], ["2026-09-01", "2026-09-30"],
      ["2026-10-01", "2026-10-31"], ["2026-11-01", "2026-11-30"], ["2026-12-01", "2026-12-31"],
    ];
    await tx
      .insert(accountingPeriods)
      .values([
        ...monthRanges.map(([start, end], i) => ({ fiscalYearId: fy.id, periodNo: i + 1, startDate: start, endDate: end, status: "open" as const })),
        { fiscalYearId: fy.id, periodNo: 13, startDate: "2026-12-01", endDate: "2026-12-31", status: "open" as const },
      ])
      .onConflictDoNothing({ target: [accountingPeriods.fiscalYearId, accountingPeriods.periodNo] });
    const periodRows = await tx
      .select({ id: accountingPeriods.id, periodNo: accountingPeriods.periodNo })
      .from(accountingPeriods)
      .where(eq(accountingPeriods.fiscalYearId, fy.id));
    const periodByNo = new Map(periodRows.map((p) => [p.periodNo, p.id]));

    /* 5. COA tambahan + peta id akun yang dirujuk master lain */
    for (const a of extraAccounts) {
      const parentId = await requireAccountId(tx, a.parentCode);
      await tx
        .insert(chartAccounts)
        .values({ code: a.code, name: a.name, type: a.type, parentId, isPostable: true, isActive: true, description: note("akun pelengkap demo") })
        .onConflictDoNothing({ target: chartAccounts.code });
    }
    const acctId = new Map<string, string>();
    for (const code of ["1111", "1112", "1113", "1115", "1200", "1300", "1520", "1525", "1530", "1535", "1540", "1545", "2110", "2131", "2132", "2133", "2140", "4100", "5210", "5230"]) {
      acctId.set(code, await requireAccountId(tx, code));
    }

    /* 6. Kurs — satu titik waktu; riwayat bersifat append-only */
    await tx
      .insert(exchangeRates)
      .values([
        { fromCurrency: "USD", toCurrency: "IDR", rateDate: "2026-01-02", rate: "16500", source: note("kurs demo") },
        { fromCurrency: "EUR", toCurrency: "IDR", rateDate: "2026-01-02", rate: "17800", source: note("kurs demo") },
        { fromCurrency: "SGD", toCurrency: "IDR", rateDate: "2026-01-02", rate: "12200", source: note("kurs demo") },
      ])
      .onConflictDoNothing({ target: [exchangeRates.fromCurrency, exchangeRates.toCurrency, exchangeRates.rateDate] });

    /* 7. Pajak + tarif efektif */
    for (const t of seedTaxes) {
      const [existing] = await tx.select({ id: taxes.id }).from(taxes).where(eq(taxes.code, t.code)).limit(1);
      if (existing) continue;
      const [created] = await tx
        .insert(taxes)
        .values({ code: t.code, name: t.name, kind: t.kind, taxAccountId: acctId.get(t.account)!, isActive: true, description: note("pajak demo") })
        .returning({ id: taxes.id });
      if (created) {
        await tx
          .insert(taxRates)
          .values({ taxId: created.id, rate: t.rate, effectiveFrom: "2026-01-01", source: t.source })
          .onConflictDoNothing({ target: [taxRates.taxId, taxRates.effectiveFrom] });
      }
    }

    /* 8. Rekening kas/bank */
    await tx
      .insert(bankAccounts)
      .values([
        { code: "KAS-001", name: "Kas Kecil Kantor Pusat", accountId: acctId.get("1111")!, kind: "cash" as const, branchId: branchId.get("HQ") ?? null, isActive: true, description: note("rekening demo") },
        { code: "BCA-001", name: "Bank BCA — Giro Operasional", accountId: acctId.get("1112")!, kind: "bank" as const, bankName: "BCA", accountNumber: "123-000111-222", branchId: branchId.get("HQ") ?? null, isActive: true, description: note("rekening demo") },
        { code: "MDR-001", name: "Bank Mandiri — Giro Cabang", accountId: acctId.get("1113")!, kind: "bank" as const, bankName: "Mandiri", accountNumber: "900-0011-2233", branchId: branchId.get("BR-002") ?? null, isActive: true, description: note("rekening demo") },
      ])
      .onConflictDoNothing({ target: bankAccounts.code });

    /* 9. Satuan + konversi */
    await tx.insert(unitsOfMeasure).values(seedUnits.map((u) => ({ ...u, isActive: true }))).onConflictDoNothing({ target: unitsOfMeasure.code });
    const unitRows = await tx.select({ id: unitsOfMeasure.id, code: unitsOfMeasure.code }).from(unitsOfMeasure);
    const unitId = new Map(unitRows.map((r) => [r.code, r.id]));
    await tx
      .insert(unitConversions)
      .values([
        { fromUnitId: unitId.get("BOX")!, toUnitId: unitId.get("PCS")!, ratio: "12", note: note("1 kotak isi 12 pcs") },
        { fromUnitId: unitId.get("KRT")!, toUnitId: unitId.get("PCS")!, ratio: "24", note: note("1 karton isi 24 pcs") },
        { fromUnitId: unitId.get("DSN")!, toUnitId: unitId.get("PCS")!, ratio: "12", note: note("1 lusin isi 12 pcs") },
      ])
      .onConflictDoNothing({ target: [unitConversions.fromUnitId, unitConversions.toUnitId] });

    /* 10. Kategori produk (hierarki) + produk */
    for (const c of seedCategories) {
      await tx
        .insert(productCategories)
        .values({ code: c.code, name: c.name, parentId: null, isActive: true, description: note("kategori demo") })
        .onConflictDoNothing({ target: productCategories.code });
    }
    const catId = new Map<string, string>();
    {
      const rows = await tx.select({ id: productCategories.id, code: productCategories.code }).from(productCategories);
      for (const r of rows) catId.set(r.code, r.id);
    }
    // pasang induk setelah semua kategori terpetakan
    for (const c of seedCategories) {
      if (!c.parentCode) continue;
      const id = catId.get(c.code);
      const parent = c.parentCode ? catId.get(c.parentCode) : undefined;
      if (id && parent) {
        await tx.update(productCategories).set({ parentId: parent }).where(eq(productCategories.id, id));
      }
    }
    await tx
      .insert(products)
      .values(seedProducts.map((p) => ({
        sku: p.sku,
        name: p.name,
        categoryId: catId.get(p.cat) ?? null,
        baseUnitId: unitId.get(p.unit)!,
        canPurchase: p.canPurchase,
        canSell: p.canSell,
        isActive: true,
        reorderPoint: p.reorder,
        description: note("produk demo"),
      })))
      .onConflictDoNothing({ target: products.sku });

    /* 11. Gudang (terikat cabang — keputusan 5B) + lokasi */
    await tx
      .insert(warehouses)
      .values([
        { code: "WH-JKT", name: "Gudang Jakarta", branchId: branchId.get("HQ")!, isActive: true, description: note("gudang demo") },
        { code: "WH-BDG", name: "Gudang Bandung", branchId: branchId.get("BR-002")!, isActive: true, description: note("gudang demo") },
        { code: "WH-SBY", name: "Gudang Surabaya", branchId: branchId.get("BR-003")!, isActive: true, description: note("gudang demo") },
      ])
      .onConflictDoNothing({ target: warehouses.code });
    const whRows = await tx.select({ id: warehouses.id, code: warehouses.code }).from(warehouses);
    const whId = new Map(whRows.map((r) => [r.code, r.id]));
    await tx
      .insert(warehouseLocations)
      .values([
        { warehouseId: whId.get("WH-JKT")!, code: "A-01", name: "Rak A-01 Bahan", isActive: true, description: note("lokasi demo") },
        { warehouseId: whId.get("WH-JKT")!, code: "A-02", name: "Rak A-02 Bahan", isActive: true, description: note("lokasi demo") },
        { warehouseId: whId.get("WH-JKT")!, code: "B-01", name: "Zona B-01 Barang Jadi", isActive: true, description: note("lokasi demo") },
        { warehouseId: whId.get("WH-BDG")!, code: "R-01", name: "Rak Utama Bandung", isActive: true, description: note("lokasi demo") },
      ])
      .onConflictDoNothing({ target: [warehouseLocations.warehouseId, warehouseLocations.code] });

    /* 12. Role demo + grant permission (dari registri, bukan ketik manual) */
    for (const r of roleDefs) {
      const [role] = await tx
        .insert(roles)
        .values({ code: r.code, name: r.name, description: note("role demo untuk seed lengkap"), isSystem: false })
        .onConflictDoUpdate({ target: roles.code, set: { name: r.name } })
        .returning({ id: roles.id });
      if (!role) continue;
      const grants = allPermissions
        .map((p) => p.code)
        .filter(r.pick)
        .map((c) => permIdByCode.get(c))
        .filter((x): x is string => typeof x === "string");
      await tx
        .insert(rolePermissions)
        .values(grants.map((permissionId) => ({ roleId: role.id, permissionId })))
        .onConflictDoNothing();
    }

    /* 13. Pengguna demo + kredensial + role */
    const userIdByEmail = new Map<string, string>();
    for (const u of seedUsers) {
      let id: string;
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, u.email)).limit(1);
      if (existing) {
        id = existing.id;
      } else {
        const [created] = await tx
          .insert(users)
          .values({ name: u.name, email: u.email, emailVerified: true, status: "active" })
          .returning({ id: users.id });
        if (!created) throw new Error(`Gagal membuat pengguna ${u.email}.`);
        id = created.id;
        await tx.insert(accounts).values({ userId: id, accountId: id, providerId: "credential", password: passwordHash });
      }
      userIdByEmail.set(u.email, id);
      const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, u.role)).limit(1);
      if (role) {
        await tx.insert(userRoles).values({ userId: id, roleId: role.id }).onConflictDoNothing();
      }
    }

    /* 14. Jabatan + karyawan (tautan login dua arah) */
    for (const p of seedPositions) {
      await tx
        .insert(positions)
        .values({ code: p.code, name: p.name, departmentId: deptId.get(p.dept) ?? null, jobGrade: p.grade, isActive: true })
        .onConflictDoNothing({ target: positions.code });
    }
    const posRows = await tx.select({ id: positions.id, code: positions.code }).from(positions);
    const posId = new Map(posRows.map((r) => [r.code, r.id]));
    await tx
      .insert(employees)
      .values(seedEmployees.map((e) => ({
        code: e.code,
        firstName: e.first,
        lastName: e.last,
        email: e.email,
        dateJoined: e.joined,
        status: "active" as const,
        isActive: true,
        positionId: posId.get(e.pos) ?? null,
        departmentId: deptId.get(e.dept) ?? null,
        branchId: branchId.get(e.branch) ?? null,
        userId: e.link ? (userIdByEmail.get(e.link) ?? null) : null,
      })))
      .onConflictDoNothing({ target: employees.code });
    const empRows = await tx.select({ id: employees.id, code: employees.code, userId: employees.userId }).from(employees);
    const empByCode = new Map(empRows.map((e) => [e.code, e]));
    for (const e of seedEmployees) {
      const row = empByCode.get(e.code);
      if (row?.userId) {
        await tx.update(users).set({ employeeId: row.id }).where(eq(users.id, row.userId));
      }
    }

    /* 15. Jenis cuti + shift */
    await tx
      .insert(leaveTypes)
      .values([
        { code: "ANNUAL", name: "Cuti Tahunan", paid: true, defaultQuotaDays: "12", requiresApproval: true, isActive: true },
        { code: "SICK", name: "Cuti Sakit", paid: true, defaultQuotaDays: "60", requiresApproval: true, isActive: true },
        { code: "OTHER", name: "Cuti Alasan Penting", paid: true, defaultQuotaDays: "3", requiresApproval: true, isActive: true },
        { code: "UNPAID", name: "Cuti Tanpa Upah", paid: false, defaultQuotaDays: null, requiresApproval: true, isActive: true },
      ])
      .onConflictDoNothing({ target: leaveTypes.code });
    await tx
      .insert(shifts)
      .values([
        { code: "SHIFT-REG", name: "Shift Reguler", workStart: "08:00:00", workEnd: "16:00:00", isActive: true },
        { code: "SHIFT-SORE", name: "Shift Sore", workStart: "14:00:00", workEnd: "22:00:00", isActive: true },
      ])
      .onConflictDoNothing({ target: shifts.code });

    /* 16. Kategori aset tetap (garis lurus, akun per kolom) */
    await tx
      .insert(assetCategories)
      .values([
        { code: "AC-KEND", name: "Kendaraan", depreciationMethod: "straight_line" as const, usefulLifeMonths: 48, residualPercent: "10", assetCostAccountId: acctId.get("1530")!, accumulatedDepreciationAccountId: acctId.get("1535")!, depreciationExpenseAccountId: acctId.get("5230")!, isActive: true },
        { code: "AC-PERAL", name: "Peralatan & Mesin", depreciationMethod: "straight_line" as const, usefulLifeMonths: 60, residualPercent: "0", assetCostAccountId: acctId.get("1540")!, accumulatedDepreciationAccountId: acctId.get("1545")!, depreciationExpenseAccountId: acctId.get("5230")!, isActive: true },
        { code: "AC-GEDUNG", name: "Bangunan", depreciationMethod: "straight_line" as const, usefulLifeMonths: 120, residualPercent: "20", assetCostAccountId: acctId.get("1520")!, accumulatedDepreciationAccountId: acctId.get("1525")!, depreciationExpenseAccountId: acctId.get("5230")!, isActive: true },
      ])
      .onConflictDoNothing({ target: assetCategories.code });

    /* 17. Termin pembayaran + pemasok */
    await tx
      .insert(paymentTerms)
      .values([
        { code: "COD", name: "Bayar Tunai (COD)", dueInDays: 1, description: note("termin demo") },
        { code: "NET15", name: "Net 15 Hari", dueInDays: 15, description: note("termin demo") },
        { code: "NET30", name: "Net 30 Hari", dueInDays: 30, description: note("termin demo") },
        { code: "NET60", name: "Net 60 Hari", dueInDays: 60, description: note("termin demo") },
      ])
      .onConflictDoNothing({ target: paymentTerms.code });
    const termRows = await tx.select({ id: paymentTerms.id, code: paymentTerms.code }).from(paymentTerms);
    const termId = new Map(termRows.map((r) => [r.code, r.id]));
    await tx
      .insert(suppliers)
      .values([
        { code: "SUP-001", name: "PT Boga Mitra Sejahtera", currency: "IDR", paymentTermsId: termId.get("NET30") ?? null, email: "sales@bogamitra.test", phone: "021-5551001", isActive: true, notes: note("pemasok demo") },
        { code: "SUP-002", name: "CV Kemas Jaya", currency: "IDR", paymentTermsId: termId.get("NET30") ?? null, email: "marketing@kemasjaya.test", phone: "022-5551002", isActive: true, notes: note("pemasok demo") },
        { code: "SUP-003", name: "PT Sinar Minyak Nusantara", currency: "IDR", paymentTermsId: termId.get("NET30") ?? null, email: "order@sinarminyak.test", phone: "031-5551003", isActive: true, notes: note("pemasok demo") },
        { code: "SUP-004", name: "PT Kopi Rakyat Indonesia", currency: "IDR", paymentTermsId: termId.get("COD") ?? null, email: "cs@kopirakyat.test", phone: "021-5551004", isActive: true, notes: note("pemasok demo") },
        { code: "SUP-005", name: "CV Perlengkapan Kantor Kita", currency: "IDR", paymentTermsId: termId.get("NET15") ?? null, email: "info@perkakaskita.test", phone: "021-5551005", isActive: true, notes: note("pemasok demo") },
      ])
      .onConflictDoNothing({ target: suppliers.code });

    /* 18. CRM akun + pelanggan + tahap pipeline */
    await tx
      .insert(crmAccounts)
      .values([
        { code: "ACC-001", name: "PT Toko Makmur Retail", type: "customer" as const, city: "Jakarta", isActive: true, notes: note("akun crm demo") },
        { code: "ACC-002", name: "CV Berkah Grosir", type: "customer" as const, city: "Bandung", isActive: true, notes: note("akun crm demo") },
        { code: "ACC-003", name: "Toko Sentosa", type: "customer" as const, city: "Surabaya", isActive: true, notes: note("akun crm demo") },
        { code: "ACC-004", name: "PT Harmoni Sejahtera", type: "prospect" as const, city: "Medan", isActive: true, notes: note("akun crm demo") },
        { code: "ACC-005", name: "Kopi Senja Roastery", type: "prospect" as const, city: "Yogyakarta", isActive: true, notes: note("akun crm demo") },
      ])
      .onConflictDoNothing({ target: crmAccounts.code });
    const accRows = await tx.select({ id: crmAccounts.id, code: crmAccounts.code }).from(crmAccounts);
    const crmAccId = new Map(accRows.map((r) => [r.code, r.id]));
    await tx
      .insert(customers)
      .values([
        { code: "CSL-001", crmAccountId: crmAccId.get("ACC-001")!, currency: "IDR", creditLimit: "50000000", paymentTermsId: termId.get("NET30") ?? null, isActive: true },
        { code: "CSL-002", crmAccountId: crmAccId.get("ACC-002")!, currency: "IDR", creditLimit: "25000000", paymentTermsId: termId.get("NET30") ?? null, isActive: true },
        { code: "CSL-003", crmAccountId: crmAccId.get("ACC-003")!, currency: "IDR", creditLimit: "10000000", paymentTermsId: termId.get("COD") ?? null, isActive: true },
      ])
      .onConflictDoNothing({ target: customers.code });
    const stageSeed = [
      { position: 1, name: "Lead Baru", probability: "10" },
      { position: 2, name: "Kualifikasi", probability: "25" },
      { position: 3, name: "Penawaran", probability: "50" },
      { position: 4, name: "Negosiasi", probability: "75" },
      { position: 5, name: "Won", probability: "100" },
    ];
    for (const s of stageSeed) {
      const [exists] = await tx
        .select({ id: crmPipelineStages.id })
        .from(crmPipelineStages)
        .where(eq(crmPipelineStages.position, s.position))
        .limit(1);
      if (exists) continue;
      await tx.insert(crmPipelineStages).values({ name: s.name, position: s.position, probability: s.probability, isActive: true });
    }

    /* 19. Komponen gaji (master; struktur per karyawan dibuat lewat UI) */
    await tx
      .insert(salaryComponents)
      .values([
        { code: "BASE", name: "Gaji Pokok", kind: "earning" as const, basis: "fixed" as const, orderNo: 1, includeInTaxBase: true, includeInBpjsBase: true, isActive: true },
        { code: "TPJ", name: "Tunjangan Jabatan", kind: "earning" as const, basis: "fixed" as const, orderNo: 2, includeInTaxBase: true, includeInBpjsBase: true, isActive: true },
        { code: "TMB", name: "Tunjangan Makan", kind: "earning" as const, basis: "fixed" as const, orderNo: 3, includeInTaxBase: true, includeInBpjsBase: false, isActive: true },
        { code: "OTR", name: "Uang Lembur", kind: "earning" as const, basis: "attendance" as const, orderNo: 4, includeInTaxBase: true, includeInBpjsBase: false, isActive: true },
        { code: "BPJS-KES-E", name: "BPJS Kesehatan (perusahaan)", kind: "earning" as const, basis: "statutory" as const, statutoryKind: "bpjs_kesehatan" as const, orderNo: 5, includeInTaxBase: false, includeInBpjsBase: false, isActive: true },
        { code: "JHT-E", name: "BPJS JHT (perusahaan)", kind: "earning" as const, basis: "statutory" as const, statutoryKind: "bpjs_jht" as const, orderNo: 6, includeInTaxBase: false, includeInBpjsBase: false, isActive: true },
        { code: "JHT-P", name: "BPJS JHT (karyawan)", kind: "deduction" as const, basis: "statutory" as const, statutoryKind: "bpjs_jht" as const, orderNo: 7, includeInTaxBase: false, includeInBpjsBase: false, isActive: true },
        { code: "PPH21-P", name: "PPh 21 Karyawan", kind: "deduction" as const, basis: "statutory" as const, statutoryKind: "pph21" as const, orderNo: 8, includeInTaxBase: false, includeInBpjsBase: false, isActive: true },
      ])
      .onConflictDoNothing({ target: salaryComponents.code });

    /* 20. Anggaran draft FY2026 + baris beban gaji semester 1 */
    const budgetName = `${DEMO} Anggaran Operasional 2026`;
    const [existingBudget] = await tx.select({ id: budgets.id }).from(budgets).where(eq(budgets.name, budgetName)).limit(1);
    if (!existingBudget) {
      const [budget] = await tx
        .insert(budgets)
        .values({ name: budgetName, fiscalYearId: fy.id, status: "draft", notes: note("anggaran demo; status draft, bebas diubah/dihapus") })
        .returning({ id: budgets.id });
      if (budget) {
        const ccRows = await tx.select({ id: costCenters.id, code: costCenters.code }).from(costCenters);
        const ccFinance = ccRows.find((c) => c.code === "CC-ADMIN-FIN")?.id ?? null;
        await tx
          .insert(budgetLines)
          .values([1, 2, 3, 4, 5, 6].map((n) => ({
            budgetId: budget.id,
            accountId: acctId.get("5210")!,
            periodId: periodByNo.get(n)!,
            costCenterId: ccFinance,
            amount: "120000000",
            note: note("anggaran gaji demo"),
          })));
      }
    }

    /* 21. Alur persetujuan + langkah + pengajuan pending (docId deterministik) */
    const wfSeed = [
      { docType: "po.approval", name: `${DEMO} Persetujuan Purchase Order`, approverRole: "manager_demo" },
      { docType: "so.approval", name: `${DEMO} Persetujuan Sales Order`, approverRole: "manager_demo" },
    ];
    const wfIdByDocType = new Map<string, string>();
    for (const w of wfSeed) {
      const [existing] = await tx
        .select({ id: approvalWorkflows.id })
        .from(approvalWorkflows)
        .where(eq(approvalWorkflows.docType, w.docType))
        .limit(1);
      if (existing) {
        wfIdByDocType.set(w.docType, existing.id);
        continue;
      }
      const [created] = await tx
        .insert(approvalWorkflows)
        .values({ docType: w.docType, name: w.name, isActive: true })
        .returning({ id: approvalWorkflows.id });
      if (!created) continue;
      wfIdByDocType.set(w.docType, created.id);
      const [approver] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, w.approverRole)).limit(1);
      if (approver) {
        await tx
          .insert(approvalWorkflowSteps)
          .values({ workflowId: created.id, stepNo: 1, approverRoleId: approver.id })
          .onConflictDoNothing({ target: [approvalWorkflowSteps.workflowId, approvalWorkflowSteps.stepNo] });
      }
    }
    const reqSeed = [
      { docType: "po.approval", docKey: "DEMO-PO-0001", amount: "15000000", by: "purchasing@erp.com" },
      { docType: "so.approval", docKey: "DEMO-SO-0001", amount: "30000000", by: "sales@erp.com" },
    ];
    for (const r of reqSeed) {
      const docId = stableUuid(r.docKey);
      const [existing] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(eq(approvalRequests.docId, docId))
        .limit(1);
      if (existing) continue;
      const workflowId = wfIdByDocType.get(r.docType);
      const requestedBy = userIdByEmail.get(r.by);
      if (workflowId && requestedBy) {
        await tx
          .insert(approvalRequests)
          .values({ docType: r.docType, docId, workflowId, status: "pending", currentStep: 1, amount: r.amount, requestedBy });
      }
    }
  });

  console.log(
    `[demo-seed] Selesai. ${seedUsers.length} pengguna demo (password: env DEMO_PASSWORD / default demo). ` +
      "Role: finance_staff, cashier, warehouse_staff, purchasing_staff, sales_staff, hr_staff, manager_demo.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[demo-seed] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
