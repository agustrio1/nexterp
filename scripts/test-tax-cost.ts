import { eq, sql } from "drizzle-orm";

import { chartAccounts, users } from "@/db/schema";
import {
  createCostCenter,
  updateCostCenter,
} from "@/modules/accounting/cost-center-service";
import { createDraftJournal, postJournal } from "@/modules/accounting/journal-service";
import { costCenterReport } from "@/modules/accounting/report-service";
import {
  createTaxRate,
  createTax,
  resolveEffectiveRate,
} from "@/modules/accounting/tax-service";
import { createTaxTransaction } from "@/modules/accounting/tax-transaction-service";
import { db } from "@/server/db";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import type { JournalLineInput } from "@/modules/accounting/schemas";
import type { AuthContext } from "@/server/authz";
import { loadGrants } from "@/server/authz";

/**
 * Skrip uji sementara untuk Tahap 4G (Pajak dan pusat biaya).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data yang tersimpan. Skrip ini tetap BUTUH
 * tabel 4G sudah ada (migrasi 0009 di-apply) karena memakai relasi baru.
 *
 * Catatan:
 *  - Enam permission 4G belum di-seed; actor uji dibangun menambahkan keenam
 *    kode itu manual ke hasil `loadGrants` (super_admin sudah punya journals,
 *    reports, fiscal, dsb.).
 *  - Tahun fiskal dibuat terisolasi (FY2041) lewat `createFiscalYear(..., tx)`
 *    agar posting jurnal memakai periode terbuka tanpa menabrak data komit.
 *
 * Prasyarat: COA demo (`db:seed-coa`) — akun 1111/2130/4100/5220 tersedia.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

/** Menjalankan `fn` yang SEHARUSNYA gagal dengan kode error tertentu. */
async function expectError(
  label: string,
  tx: Tx,
  expectedCode: string,
  fn: () => Promise<unknown>,
) {
  await tx.execute(sql`savepoint sp_err`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_err`);
    assert(`${label} (seharusnya ${expectedCode})`, false);
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_err`);
    const e = error as { code?: string; message?: string };
    console.log(`  ${label} -> ${e.code ?? "-"} | ${e.message ?? String(error)}`);
    assert(`${label} = ${expectedCode}`, e.code === expectedCode);
  }
}

async function accountIdByCode(code: string): Promise<string> {
  const [row] = await db
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(eq(chartAccounts.code, code))
    .limit(1);
  if (!row) throw new Error(`Akun ${code} tidak ada. Jalankan \`bun run db:seed-coa\`.`);
  return row.id;
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const acc = {
    kas: await accountIdByCode("1111"),
    utangPajak: await accountIdByCode("2130"),
    utangInduk: await accountIdByCode("2000"), // non-postable: penolakan akun
    pendapatan: await accountIdByCode("4100"),
    sewa: await accountIdByCode("5220"),
  };

  try {
    await db.transaction(async (tx) => {
      // Actor uji: grant asli + enam permission 4G (belum di-seed).
      const grants = await loadGrants(u.id);
      const actor: AuthContext = {
        userId: u.id,
        name: "Uji",
        email: "uji@example.com",
        grants: [
          ...grants,
          { code: "accounting.cost_centers.read", branchId: null },
          { code: "accounting.cost_centers.manage", branchId: null },
          { code: "accounting.taxes.read", branchId: null },
          { code: "accounting.taxes.manage", branchId: null },
          { code: "accounting.tax_transactions.read", branchId: null },
          { code: "accounting.tax_transactions.manage", branchId: null },
        ],
      };

      // ---- FY2041 terisolasi agar posting jurnal memakai periode terbuka ----
      const fy = await createFiscalYear(
        actor,
        { code: "FY2041", startDate: "2041-01-01", endDate: "2041-12-31", includeAdjustmentPeriod: false },
        tx,
      );
      assert("FY2041 dibuat dengan 12 periode", fy.periods.length === 12);

      // ===== CC: hirarki pusat biaya =====
      const root = await createCostCenter(
        actor,
        { code: "CC-TEST-ROOT", name: "Pusat Uji Induk" },
        tx,
      );
      const child = await createCostCenter(
        actor,
        { code: "CC-TEST-CHILD", name: "Pusat Uji Anak", parentId: root.id },
        tx,
      );
      assert("CC anak menunjuk induk yang benar", child.parentId === root.id);

      await expectError("CC kode ganda", tx, "CONFLICT", () =>
        createCostCenter(actor, { code: "CC-TEST-ROOT", name: "Duplikat" }, tx),
      );
      await expectError("CC tanpa izin", tx, "FORBIDDEN", () =>
        createCostCenter({ ...actor, grants: [] }, { code: "CC-NOPE", name: "Tak berhak" }, tx),
      );
      await expectError("CC nonaktif saat punya anak aktif", tx, "CONFLICT", () =>
        updateCostCenter(actor, root.id, { isActive: false }, tx),
      );

      // ===== TAX: master pajak =====
      const tax = await createTax(
        actor,
        { code: "PPN-TEST", name: "PPN Uji", kind: "output", taxAccountId: acc.utangPajak },
        tx,
      );
      assert("Tax dibuat dengan akun postable", tax.taxAccountId === acc.utangPajak);

      await expectError("Tax akun non-postable", tx, "BUSINESS_RULE", () =>
        createTax(actor, { code: "TAX-BAD", name: "Akun Salah", kind: "output", taxAccountId: acc.utangInduk }, tx),
      );
      await expectError("Tax kode ganda", tx, "CONFLICT", () =>
        createTax(actor, { code: "PPN-TEST", name: "Duplicator", kind: "input", taxAccountId: acc.utangPajak }, tx),
      );

      // ===== RATE: tarif bertanggal efektif =====
      const rate = await createTaxRate(
        actor,
        tax.id,
        { rate: "11.0000", effectiveFrom: "2041-01-01", source: "UU HPP No.7/2021" },
        tx,
      );
      assert("Rate tersimpan 11.0000", rate?.rate === "11.0000");

      const eff = await resolveEffectiveRate(tx, tax.id, "2041-06-15");
      assert("resolveEffectiveRate menemukan tarif berlaku", eff?.rate === "11.0000");
      const before = await resolveEffectiveRate(tx, tax.id, "2040-12-31");
      assert("resolveEffectiveRate null sebelum tanggal efektif", before === null);

      await expectError("Rate tanggal efektif ganda", tx, "CONFLICT", () =>
        createTaxRate(actor, tax.id, { rate: "12.0000", effectiveFrom: "2041-01-01", source: "Duplikat tarif" }, tx),
      );

      // ===== TXN: transaksi pajak (subledger + snapshot) =====
      const txn = await createTaxTransaction(
        actor,
        { taxId: tax.id, transactionDate: "2041-06-15", direction: "collect", baseAmount: "1000000.00", costCenterId: child.id },
        tx,
      );
      assert("TXN snapshot tarif 11.0000", txn.rate === "11.0000");
      assert("TXN pajak dihitung 110.000,00", txn.taxAmount === "110000.00");
      assert("TXN nomor dokumen diawali TX", txn.docNo.startsWith("TX"));
      assert("TXN menautkan pusat biaya", txn.costCenterId === child.id);

      await expectError("TXN tanpa tarif berlaku", tx, "BUSINESS_RULE", () =>
        createTaxTransaction(actor, { taxId: tax.id, transactionDate: "2040-12-31", direction: "collect", baseAmount: "100.00" }, tx),
      );
      await expectError("TXN tanpa izin", tx, "FORBIDDEN", () =>
        createTaxTransaction({ ...actor, grants: [] }, { taxId: tax.id, transactionDate: "2041-06-15", direction: "collect", baseAmount: "100.00" }, tx),
      );

      // ===== JURNAL: baris memakai cost center =====
      const mk = async (description: string, entryDate: string, lines: JournalLineInput[]) => {
        const d = await createDraftJournal(actor, { entryDate, description, lines }, tx);
        return postJournal(actor, d.id, tx);
      };
      await mk("Pendapatan jasa (CC anak)", "2041-03-01", [
        { accountId: acc.kas, side: "debit", amount: "5000000.00" },
        { accountId: acc.pendapatan, side: "credit", amount: "5000000.00", costCenterId: child.id },
      ]);
      await mk("Beban sewa (CC anak)", "2041-03-05", [
        { accountId: acc.sewa, side: "debit", amount: "1200000.00", costCenterId: child.id },
        { accountId: acc.kas, side: "credit", amount: "1200000.00" },
      ]);

      await expectError("Jurnal pusat biaya tak ditemukan", tx, "VALIDATION_FAILED", () =>
        createDraftJournal(
          actor,
          {
            entryDate: "2041-03-06",
            description: "CC salah",
            lines: [
              { accountId: acc.kas, side: "debit", amount: "10.00" },
              { accountId: acc.pendapatan, side: "credit", amount: "10.00", costCenterId: "00000000-0000-0000-0000-000000000000" },
            ],
          },
          tx,
        ),
      );

      // ===== REPORT: laporan per pusat biaya =====
      const report = await costCenterReport(
        actor,
        { from: "2041-01-01", to: "2041-12-31", costCenterId: child.id },
        tx,
      );
      const row = report.rows.find((r) => r.costCenterId === child.id);
      assert("Report punya baris CC anak", !!row);
      assert("Report pendapatan CC anak 5.000.000", row?.revenue === "5000000.00");
      assert("Report beban CC anak 1.200.000", row?.expense === "1200000.00");
      assert("Report net CC anak 3.800.000", row?.net === "3800000.00");

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-tax-cost] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-tax-cost] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
