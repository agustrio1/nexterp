import { and, eq, sql } from "drizzle-orm";

import {
  apPaymentAllocations,
  approvalRequests,
  branches,
  chartAccounts,
  companySettings,
  journalEntries,
  supplierInvoices,
  users,
} from "@/db/schema";
import { createUnit } from "@/modules/inventory/unit-service";
import { createProduct } from "@/modules/inventory/product-service";
import { createWarehouse } from "@/modules/inventory/warehouse-service";
import { createApprovalWorkflow } from "@/modules/core/approval-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { createBankAccount } from "@/modules/accounting/bank-account-service";
import { getJournal } from "@/modules/accounting/journal-service";
import { createPaymentTerm } from "@/modules/purchasing/payment-terms-service";
import { createSupplier } from "@/modules/purchasing/supplier-service";
import {
  approvePurchaseOrder,
  createPurchaseOrder,
  postPurchaseOrder,
  submitPurchaseOrder,
} from "@/modules/purchasing/po-service";
import { createReceiptFromPo } from "@/modules/purchasing/gr-from-po-service";
import {
  cancelSupplierInvoice,
  createSupplierInvoice,
  getSupplierInvoice,
  listOpenInvoices,
  postSupplierInvoice,
  reverseSupplierInvoice,
} from "@/modules/purchasing/invoice-service";
import {
  createApPayment,
  getApPayment,
  postApPayment,
  reverseApPayment,
} from "@/modules/purchasing/ap-payment-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 5G (AP + jurnal GR/IR perpetual + FX). Alur e2e:
 *   PO -> GR (Dr Inventory / Cr GR/IR) -> invoice three-way match (Dr GR/IR / Cr AP)
 *   -> pembayaran FIFO (Dr AP / Cr Bank) -> reversal membersihkan alokasi & membuka
 *   invoice kembali. Juga menguji mismatch harga/qty (BUSINESS_RULE), over-payment,
 *   invarian debit=kredit, dan guard imutabilitas subledger.
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`,
 * sehingga TIDAK ADA data tersimpan. BUTUH migrasi 0019 + akun COA 2115 (db:seed-coa).
 * Tahun fiskal & pengaturan akun dibuat terisolasi dalam transaksi (ikut di-rollback).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = error;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (cur instanceof Error) parts.push(cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

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

async function expectThrows(
  label: string,
  tx: Tx,
  substr: string,
  fn: () => Promise<unknown>,
) {
  await tx.execute(sql`savepoint sp_th`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_th`);
    assert(`${label} (seharusnya gagal)`, false);
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_th`);
    const message = errorText(error);
    console.log(`  ${label} -> ${message}`);
    assert(`${label} memuat "${substr}"`, message.includes(substr));
  }
}

/** Setujui pengajuan PO dengan mem-flip approval_request ke 'approved' (simulasi langkah 3J). */
async function simulateApproval(tx: Tx, poId: string) {
  const [req] = await tx
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.docType, "purchase_order"), eq(approvalRequests.docId, poId)))
    .limit(1);
  if (!req) throw new Error("approval_request PO tidak ditemukan saat simulasi persetujuan.");
  await tx
    .update(approvalRequests)
    .set({ status: "approved", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(approvalRequests.id, req.id));
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const fake = "00000000-0000-4000-8000-000000000000";

  try {
    await db.transaction(async (tx) => {
      const grants = await loadGrants(u.id);
      const actor: AuthContext = {
        userId: u.id,
        name: "Uji AP/GR-IR",
        email: "ap@uji.example",
        grants: [
          ...grants,
          { code: "core.approval_workflows.manage", branchId: null },
          { code: "core.approvals.request", branchId: null },
          { code: "core.fiscal_years.manage", branchId: null },
          { code: "accounting.journals.post", branchId: null },
          { code: "accounting.journals.read", branchId: null },
          { code: "accounting.bank_accounts.manage", branchId: null },
          { code: "purchasing.payment_terms.manage", branchId: null },
          { code: "purchasing.suppliers.manage", branchId: null },
          { code: "purchasing.purchase_orders.manage", branchId: null },
          { code: "purchasing.purchase_orders.post", branchId: null },
          { code: "purchasing.receipts.manage", branchId: null },
          { code: "purchasing.invoices.manage", branchId: null },
          { code: "purchasing.invoices.post", branchId: null },
          { code: "purchasing.invoices.read", branchId: null },
          { code: "purchasing.payments.manage", branchId: null },
          { code: "purchasing.payments.post", branchId: null },
          { code: "purchasing.payments.read", branchId: null },
          { code: "purchasing.ap.read", branchId: null },
          { code: "inventory.units.manage", branchId: null },
          { code: "inventory.products.manage", branchId: null },
          { code: "inventory.warehouses.manage", branchId: null },
          { code: "inventory.documents.manage", branchId: null },
        ],
      };

      // ---- Prasyarat master + buku besar ----
      const [br] = await tx
        .insert(branches)
        .values({ code: "BR-AP", name: "Cabang AP", isActive: true, createdBy: u.id, updatedBy: u.id })
        .returning({ id: branches.id });
      if (!br) throw new Error("Gagal membuat cabang uji.");
      const branchId = br.id;

      // Tahun fiskal terisolasi 2041 (tanggal dokumen uji) + akun konfigurasi GR/IR.
      await createFiscalYear(
        actor,
        { code: "FY2041", startDate: "2041-01-01", endDate: "2041-12-31", includeAdjustmentPeriod: false },
        tx,
      );
      const accountId = async (code: string) => {
        const [r] = await tx
          .select({ id: chartAccounts.id })
          .from(chartAccounts)
          .where(eq(chartAccounts.code, code))
          .limit(1);
        if (!r) throw new Error(`Akun ${code} tidak ada. Jalankan \`bun run db:seed-coa\`.`);
        return r.id;
      };
      const invId = await accountId("1300");
      const grirId = await accountId("2115");
      const apId = await accountId("2110");
      const bankGlId = await accountId("1111");
      const settings: readonly [string, string][] = [
        ["inventory_account_id", invId],
        ["grir_account_id", grirId],
        ["ap_account_id", apId],
      ];
      for (const [key, value] of settings) {
        await tx
          .insert(companySettings)
          .values({ key, value, updatedBy: u.id })
          .onConflictDoUpdate({ target: companySettings.key, set: { value, updatedBy: u.id } });
      }

      const wh = await createWarehouse(actor, { code: "GUD-AP", name: "Gudang AP", branchId }, tx);
      const unit = await createUnit(actor, { code: "APC", name: "Pieces AP", symbol: "pc" }, tx);
      const plain = await createProduct(
        actor,
        { sku: "AP-A", name: "Barang AP-A", baseUnitId: unit.id, canPurchase: true },
        tx,
      );
      const term = await createPaymentTerm(actor, { code: "AP-30", name: "Net 30", dueInDays: 30 }, tx);
      const supplier = await createSupplier(
        actor,
        { code: "SUP-AP", name: "Pemasok AP", currency: "IDR", paymentTermsId: term.id },
        tx,
      );
      const bank = await createBankAccount(
        actor,
        { code: "BANK-AP", name: "Bank AP", accountId: bankGlId, kind: "bank", branchId },
        tx,
      );
      await createApprovalWorkflow(
        actor,
        { docType: "purchase_order", name: "Alur PO AP", isActive: true, steps: [{ approverUserId: u.id }] },
        tx,
      );

      /** Jalankan PO sampai posted + GR sejumlah qty; kembalikan { po, poLine, grDocId }. */
      async function poWithReceipt(qtyOrdered: string, qtyReceived: string, unitPrice: string) {
        const po = await createPurchaseOrder(
          actor,
          {
            supplierId: supplier.id,
            branchId,
            orderDate: "2041-03-01",
            lines: [{ productId: plain.id, quantity: qtyOrdered, unitPrice }],
          },
          tx,
        );
        await submitPurchaseOrder(actor, po.id, tx);
        await simulateApproval(tx, po.id);
        await approvePurchaseOrder(actor, po.id, tx);
        const postedPo = await postPurchaseOrder(actor, po.id, tx);
        const gr = await createReceiptFromPo(
          actor,
          po.id,
          { warehouseId: wh.id, documentDate: "2041-03-05", lines: [{ poLineId: postedPo.lines[0]!.id, quantity: qtyReceived }] },
          tx,
        );
        return { po: postedPo, poLine: postedPo.lines[0]!, grDocId: gr.stockDocument.id };
      }

      /** Ambil id jurnal sistem dari sumber (sourceType, sourceId, event). */
      async function journalIdBySource(sourceType: string, sourceId: string): Promise<string> {
        const [row] = await tx
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(and(eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId)))
          .limit(1);
        if (!row) throw new Error(`Jurnal ${sourceType} tidak ditemukan untuk sumber ${sourceId}.`);
        return row.id;
      }

      /** Cek jurnal dua baris: satu debit akun X, satu kredit akun Y, nominal amount. */
      async function assertTwoSidedJournal(label: string, journalId: string, debitAcc: string, creditAcc: string, amount: string) {
        const j = await getJournal(actor, journalId, tx);
        assert(`${label}: status posted & seimbang ${amount}`, j.status === "posted" && j.totalDebit === amount && j.totalCredit === amount);
        const debit = j.lines.find((l) => l.debit === amount);
        const credit = j.lines.find((l) => l.credit === amount);
        assert(`${label}: debit di akun yang diharapkan`, !!debit && debit.accountId === debitAcc);
        assert(`${label}: kredit di akun yang diharapkan`, !!credit && credit.accountId === creditAcc);
        return j;
      }

      // =================== Alur utama: PO -> GR -> invoice -> payment ===================
      const main = await poWithReceipt("10", "6", "1000");

      // GR menerbitkan jurnal Dr Inventory / Cr GR/IR senilai 6 x 1000 = 6000.00.
      const grJournalId = await journalIdBySource("purchase_receipt", main.grDocId);
      await assertTwoSidedJournal("Jurnal GR", grJournalId, invId, grirId, "6000.00");

      // Invoice three-way match penuh (qty 6, harga 1000).
      const invoice = await createSupplierInvoice(
        actor,
        {
          poId: main.po.id,
          invoiceDate: "2041-04-01",
          dueDate: "2041-04-30",
          lines: [{ poLineId: main.poLine.id, quantity: "6", unitPrice: "1000" }],
        },
        tx,
      );
      assert("Invoice: draf totalForeign 6000.00", invoice.status === "draft" && invoice.totalForeign === "6000.00");
      const postedInvoice = await postSupplierInvoice(actor, invoice.id, tx);
      assert(
        "Invoice post: posted, docNo SIV-, kurs 1.000000, totalBase 6000.00",
        postedInvoice.status === "posted" &&
          !!postedInvoice.docNo?.startsWith("SIV-") &&
          postedInvoice.exchangeRate === "1.000000" &&
          postedInvoice.totalBase === "6000.00",
      );
      // Invoice menerbitkan jurnal Dr GR/IR / Cr AP 6000.00.
      assert("Invoice: journalEntryId terisi", !!postedInvoice.journalEntryId);
      await assertTwoSidedJournal("Jurnal Invoice", postedInvoice.journalEntryId!, grirId, apId, "6000.00");

      // Invoice terbuka = 1 (belum dibayar), sisa 6000.
      let open = await listOpenInvoices(actor, supplier.id, tx);
      assert("AP terbuka sebelum bayar: 1 invoice sisa 6000.00", open.length === 1 && open[0]?.remainingBase === "6000.00");

      // Pembayaran FIFO penuh.
      const payment = await createApPayment(
        actor,
        { supplierId: supplier.id, branchId, paymentDate: "2041-05-01", currency: "IDR", amountForeign: "6000", bankAccountId: bank.id },
        tx,
      );
      assert("Pembayaran: draf tanpa docNo", payment.status === "draft" && payment.docNo === null);
      const postedPayment = await postApPayment(actor, payment.id, tx);
      assert(
        "Pembayaran post: posted, docNo PBY-, amountBase 6000.00",
        postedPayment.status === "posted" &&
          !!postedPayment.docNo?.startsWith("PBY-") &&
          postedPayment.exchangeRate === "1.000000" &&
          postedPayment.amountBase === "6000.00",
      );
      assert("Pembayaran: 1 alokasi 6000.00 ke invoice", postedPayment.allocations.length === 1 && postedPayment.allocations[0]?.amountBase === "6000.00");
      await assertTwoSidedJournal("Jurnal Pembayaran", postedPayment.journalEntryId!, apId, bankGlId, "6000.00");

      // Setelah lunas: tidak ada invoice terbuka.
      open = await listOpenInvoices(actor, supplier.id, tx);
      assert("AP terbuka sesudah bayar: kosong", open.length === 0);

      // =================== Guard imutabilitas (sebelum reversal) ===================
      await expectThrows("invoice posted tak boleh ubah supplier", tx, "non-draf", () =>
        tx.update(supplierInvoices).set({ supplierId: fake }).where(eq(supplierInvoices.id, invoice.id)),
      );
      await expectThrows("alokasi tak boleh diedit langsung", tx, "tidak dapat diubah", () =>
        tx.update(apPaymentAllocations).set({ amountBase: "1" }).where(eq(apPaymentAllocations.paymentId, payment.id)),
      );

      // =================== Reversal: pembayaran lalu invoice ===================
      const reversedPayment = await reverseApPayment(actor, payment.id, { reason: "reversal uji AP" }, tx);
      assert("Reversal pembayaran: status reversed + alokasi kosong", reversedPayment.status === "reversed" && reversedPayment.allocations.length === 0);
      open = await listOpenInvoices(actor, supplier.id, tx);
      assert("Reversal pembayaran: invoice terbuka kembali 6000.00", open.length === 1 && open[0]?.remainingBase === "6000.00");

      const reversedInvoice = await reverseSupplierInvoice(actor, invoice.id, { reason: "reversal uji invoice" }, tx);
      assert("Reversal invoice: status reversed", reversedInvoice.status === "reversed");

      // =================== Negative: mismatch harga & qty ===================
      const po2 = await poWithReceipt("8", "5", "1000");
      await expectError("invoice harga 1100 != PO 1000 -> BUSINESS_RULE", tx, "BUSINESS_RULE", () =>
        createSupplierInvoice(
          actor,
          { poId: po2.po.id, invoiceDate: "2041-04-10", dueDate: "2041-05-10", lines: [{ poLineId: po2.poLine.id, quantity: "5", unitPrice: "1100" }] },
          tx,
        ),
      );
      await expectError("invoice qty 6 > diterima 5 -> BUSINESS_RULE", tx, "BUSINESS_RULE", () =>
        createSupplierInvoice(
          actor,
          { poId: po2.po.id, invoiceDate: "2041-04-10", dueDate: "2041-05-10", lines: [{ poLineId: po2.poLine.id, quantity: "6", unitPrice: "1000" }] },
          tx,
        ),
      );

      // =================== Over-payment (tanpa invoice terbuka) ===================
      const lonelyPayment = await createApPayment(
        actor,
        { supplierId: supplier.id, branchId, paymentDate: "2041-05-05", currency: "IDR", amountForeign: "5000", bankAccountId: bank.id },
        tx,
      );
      await expectError("pembayaran tanpa utang terbuka -> BUSINESS_RULE", tx, "BUSINESS_RULE", async () =>
        postApPayment(actor, lonelyPayment.id, tx),
      );

      // =================== Cancel ===================
      const draftInvoice = await createSupplierInvoice(
        actor,
        { poId: po2.po.id, invoiceDate: "2041-04-12", dueDate: "2041-05-12", lines: [{ poLineId: po2.poLine.id, quantity: "2", unitPrice: "1000" }] },
        tx,
      );
      const cancelled = await cancelSupplierInvoice(actor, draftInvoice.id, { reason: "batal uji invoice" }, tx);
      assert("Cancel invoice draf: cancelled + reason", cancelled.status === "cancelled" && cancelled.reason === "batal uji invoice");
      await expectError("cancel invoice posted ditolak", tx, "BUSINESS_RULE", () =>
        cancelSupplierInvoice(actor, invoice.id, { reason: "coba batal posted" }, tx),
      );

      // =================== Izin & NotFound ===================
      await expectError("get invoice tanpa izin read", tx, "FORBIDDEN", () => getSupplierInvoice({ ...actor, grants: [] }, invoice.id, tx));
      await expectError("create pembayaran tanpa izin manage", tx, "FORBIDDEN", () =>
        createApPayment({ ...actor, grants: [] }, { supplierId: supplier.id, branchId, paymentDate: "2041-05-06", currency: "IDR", amountForeign: "1", bankAccountId: bank.id }, tx),
      );
      await expectError("get pembayaran tidak ada", tx, "NOT_FOUND", () => getApPayment(actor, fake, tx));

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-ap-grir] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-ap-grir] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
