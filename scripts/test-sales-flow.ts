import { and, eq, sql } from "drizzle-orm";
import type { AnyPgTable, PgColumn } from "drizzle-orm/pg-core";

import {
  accountingPeriods,
  approvalRequests,
  bankAccounts,
  branches,
  chartAccounts,
  companySettings,
  fiscalYears,
  permissions,
  products,
  taxes,
  taxRates,
  unitsOfMeasure,
  users,
  warehouses,
} from "@/db/schema";
import { createAccount } from "@/modules/crm/account-service";
import { createCustomer, updateCustomer } from "@/modules/crm/customer-service";
import { actOnApproval, createApprovalWorkflow } from "@/modules/core/approval-service";
import { postStockMovement } from "@/modules/inventory/stock-service";
import { createCreditNote, getCreditNote, postCreditNote } from "@/modules/sales/credit-note-service";
import {
  createDelivery,
  getDelivery,
  listDeliveries,
  postDelivery,
  reverseDelivery,
} from "@/modules/sales/delivery-service";
import { createInvoice, getInvoice, postInvoice } from "@/modules/sales/invoice-service";
import { createPayment, getPayment, postPayment, reversePayment } from "@/modules/sales/payment-service";
import { acceptQuotation, createQuotation, sendQuotation } from "@/modules/sales/quotation-service";
import { createReturn, getReturn, postReturn } from "@/modules/sales/return-service";
import {
  approveSalesOrder,
  createSalesOrder,
  getSalesOrder,
  postSalesOrder,
  submitSalesOrder,
} from "@/modules/sales/so-service";
import type { AuthContext, Grant } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji end-to-end Tahap 6E: alur Penjualan -> AR.
 * SATU db.transaction + throw Rollback — TIDAK ADA data tersimpan di DB.
 * Rantai: quotation -> SO (submit/approve/post) -> delivery (COGS) -> return ->
 * invoice (AR + PPN) -> payment (FIFO) -> credit note. Penjaga: over-delivery,
 * reversal diblokir faktur posted, limit kredit, FORBIDDEN, NOT_FOUND.
 * BUTUH migrasi 0023 + seed permission 6A/6C sudah jalan.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

/** Jalankan fn di savepoint; harapkan error dengan code tertentu; rollback savepoint. */
async function expectError(label: string, tx: Tx, expectedCode: string, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint sp_err`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_err`);
    assert(`${label} (seharusnya ${expectedCode})`, false);
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_err`);
    const e = error as { code?: string };
    assert(`${label} = ${expectedCode}`, e.code === expectedCode);
  }
}

/** Sisip satu baris dan kembalikan id. */
async function insertOne(
  tx: Tx,
  table: AnyPgTable & { id: PgColumn },
  values: Record<string, unknown>,
): Promise<string> {
  const [row] = await tx
    .insert(table)
    .values({ ...values, createdBy: ACTOR_ID, updatedBy: ACTOR_ID })
    .returning({ id: table.id });
  return row!.id as string;
}

// Pengisi id aktor; diisi di main() sebelum dipakai oleh helper insertOne.
let ACTOR_ID = "00000000-0000-4000-8000-000000000000";

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna. Jalankan seed/create-admin dulu.");
  ACTOR_ID = u.id;

  // Bangun grant penuh dari registri permission (simulasi super-user).
  const permRows = await db.select({ code: permissions.code }).from(permissions);
  const allGrants: Grant[] = permRows.map((p) => ({ code: p.code, branchId: null }));
  const actor: AuthContext = { userId: u.id, name: "Uji Sales", email: "uji-sales@example.com", grants: allGrants };
  const fake = "00000000-0000-4000-8000-000000000000";

  try {
    await db.transaction(async (tx) => {
      /* =================== Prasyarat master =================== */
      const bankGlAccountId = await insertOne(tx, chartAccounts, { code: "TST6-1100", name: "Bank Uji 6", type: "asset", isPostable: true, isActive: true });
      const arAccountId = await insertOne(tx, chartAccounts, { code: "TST6-1200", name: "Piutang Uji 6", type: "asset", isPostable: true, isActive: true });
      const inventoryAccountId = await insertOne(tx, chartAccounts, { code: "TST6-1300", name: "Persediaan Uji 6", type: "asset", isPostable: true, isActive: true });
      const taxAccountId = await insertOne(tx, chartAccounts, { code: "TST6-2130", name: "UTang Pajak Uji 6", type: "liability", isPostable: true, isActive: true });
      const revenueAccountId = await insertOne(tx, chartAccounts, { code: "TST6-4100", name: "Pendapatan Uji 6", type: "revenue", isPostable: true, isActive: true });
      const cogsAccountId = await insertOne(tx, chartAccounts, { code: "TST6-5100", name: "HPP Uji 6", type: "expense", isPostable: true, isActive: true });

      // Kunci konfigurasi AR + mata uang dasar.
      const settings: [string, unknown][] = [
        ["base_currency", "IDR"],
        ["ar_account_id", arAccountId],
        ["revenue_account_id", revenueAccountId],
        ["cogs_account_id", cogsAccountId],
        ["tax_payable_account_id", taxAccountId],
        ["inventory_account_id", inventoryAccountId],
      ];
      for (const [key, value] of settings) {
        await tx
          .insert(companySettings)
          .values({ key, value, updatedBy: actor.userId })
          .onConflictDoUpdate({ target: companySettings.key, set: { value, updatedBy: actor.userId } });
      }

      // Tahun fiskal + periode OPEN yang memuat seluruh tanggal uji (2040).
      const fyId = await insertOne(tx, fiscalYears, { code: "TST6-FY", startDate: "2040-01-01", endDate: "2040-12-31", status: "open" });
      await insertOne(tx, accountingPeriods, { fiscalYearId: fyId, periodNo: 1, startDate: "2040-01-01", endDate: "2040-12-31", status: "open" });

      const branchId = await insertOne(tx, branches, { code: "TST6-BR", name: "Cabang Uji 6", isActive: true });
      const warehouseId = await insertOne(tx, warehouses, { code: "TST6-WH", name: "Gudang Uji 6", branchId, isActive: true });
      const bankAccountId = await insertOne(tx, bankAccounts, { code: "TST6-BANK", name: "Rekening Uji 6", accountId: bankGlAccountId, kind: "bank", isActive: true });

      const taxId = await insertOne(tx, taxes, { code: "TST6-PPN", name: "PPN Uji 6", kind: "output", taxAccountId: taxAccountId, isActive: true });
      await insertOne(tx, taxRates, { taxId, rate: "11.0000", effectiveFrom: "2040-01-01", source: "UU HPP" });

      const unitId = await insertOne(tx, unitsOfMeasure, { code: "TST6-PCS", name: "Pieces Uji 6", isActive: true });
      const productId = await insertOne(tx, products, { sku: "TST6-P1", name: "Produk Uji 6", baseUnitId: unitId, canSell: true, canPurchase: true, tracking: "none", isActive: true });

      // Pelanggan: account CRM -> customer dengan limit kredit besar.
      const acctId = (await createAccount(actor, { code: "TST6-ACC", name: "Akun Uji 6", type: "customer" }, tx)).id;
      const customerId = (await createCustomer(actor, { crmAccountId: acctId, code: "TST6-CUST", currency: "IDR", creditLimit: "1000000000.00" }, tx)).id;

      // Approver kedua (SoD) + alur persetujuan untuk sales_order.
      const rand = crypto.randomUUID().slice(0, 8);
      const [approver] = await tx
        .insert(users)
        .values({ name: "Approver Uji 6", email: `tst6-approver-${rand}@example.com`, status: "active" })
        .returning({ id: users.id });
      const approverId = approver!.id;
      const approverActor: AuthContext = { userId: approverId, name: "Approver", email: `tst6-approver-${rand}@example.com`, grants: allGrants };
      await createApprovalWorkflow(
        actor,
        { docType: "sales_order", name: "Alur SO Uji 6", steps: [{ approverUserId: approverId }], isActive: true },
        tx,
      );

      /* =================== Quotation =================== */
      const quote = await createQuotation(actor, {
        customerId, branchId, quotationDate: "2040-03-01",
        lines: [{ productId, quantity: "10.000", unitPrice: "20000.00" }],
      }, tx);
      await sendQuotation(actor, quote.id, tx);
      const quoteAcc = await acceptQuotation(actor, quote.id, tx);
      assert("quotation accepted", quoteAcc.status === "accepted");

      /* =================== Sales Order =================== */
      const so = await createSalesOrder(actor, {
        customerId, branchId, quotationId: quote.id, orderDate: "2040-03-05",
        lines: [{ productId, quantity: "10.000", unitPrice: "20000.00" }],
      }, tx);
      const soLineId = so.lines[0]!.id;
      await submitSalesOrder(actor, so.id, tx);
      const [req] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.docType, "sales_order"), eq(approvalRequests.docId, so.id), eq(approvalRequests.status, "pending")))
        .limit(1);
      assert("approval request dibuat", !!req);
      await actOnApproval(approverActor, req!.id, { action: "approve" }, tx);
      await approveSalesOrder(actor, so.id, tx);
      const soPosted = await postSalesOrder(actor, so.id, tx);
      assert("SO posted", soPosted.status === "posted");
      assert("SO docNo terbit", !!soPosted.docNo);
      assert("SO totalBase 200000.00", soPosted.totalBase === "200000.00");

      /* =================== Stok awal (opening in) =================== */
      const stk = await postStockMovement(
        actor,
        { productId, warehouseId, direction: "in", quantity: "100.000", unitCost: "5000.00", movementDate: "2040-01-05", sourceType: "opening" },
        tx,
      );
      assert("stok masuk tercatat", stk.id.length > 0);

      /* =================== Delivery: guard over-qty =================== */
      await expectError("over-delivery", tx, "BUSINESS_RULE", () =>
        createDelivery(actor, {
          soId: so.id, branchId, warehouseId, deliveryDate: "2040-03-10",
          lines: [{ soLineId, productId, quantity: "20.000" }],
        }, tx),
      );

      const dlv = await createDelivery(actor, {
        soId: so.id, branchId, warehouseId, deliveryDate: "2040-03-10",
        lines: [{ soLineId, productId, quantity: "10.000" }],
      }, tx);
      const dlvLineId = dlv.lines[0]!.id;
      const dlvPosted = await postDelivery(actor, dlv.id, tx);
      assert("delivery posted", dlvPosted.status === "posted" && !!dlvPosted.docNo);
      assert("delivery jurnal COGS terbit", !!dlvPosted.journalEntryId);
      assert("delivery unitCost 5000.0000", dlvPosted.lines[0]!.unitCost === "5000.0000");
      assert("delivery cogsAmount 50000.00", dlvPosted.lines[0]!.cogsAmount === "50000.00");

      /* =================== Return (sebagian) =================== */
      const ret = await createReturn(actor, {
        deliveryId: dlv.id, branchId, warehouseId, returnDate: "2040-03-16",
        lines: [{ deliveryLineId: dlvLineId, productId, quantity: "2.000" }],
      }, tx);
      const retPosted = await postReturn(actor, ret.id, tx);
      assert("return posted", retPosted.status === "posted" && !!retPosted.journalEntryId);

      /* =================== Invoice (AR + PPN) =================== */
      const inv = await createInvoice(actor, {
        deliveryId: dlv.id, branchId, invoiceDate: "2040-03-15", dueDate: "2040-04-15", taxId,
        lines: [{ deliveryLineId: dlvLineId, productId, quantity: "10.000", unitPrice: "20000.00" }],
      }, tx);
      const invPosted = await postInvoice(actor, inv.id, taxId, tx);
      assert("invoice posted + docNo", invPosted.status === "posted" && !!invPosted.docNo);
      assert("invoice subtotalBase 200000.00", invPosted.subtotalBase === "200000.00");
      assert("invoice taxBase 22000.00", invPosted.taxBase === "22000.00");
      assert("invoice totalBase 222000.00", invPosted.totalBase === "222000.00");
      assert("invoice jurnal AR terbit", !!invPosted.journalEntryId);
      assert("invoice transaksi pajak terbit", !!invPosted.taxTransactionId);

      /* =================== Payment (FIFO full) =================== */
      const pay = await createPayment(actor, {
        customerId, branchId, paymentDate: "2040-03-20", bankAccountId, amountForeign: "222000.00",
      }, tx);
      const payPosted = await postPayment(actor, pay.id, tx);
      assert("payment posted + docNo", payPosted.status === "posted" && !!payPosted.docNo);
      assert("payment amountBase 222000.00", payPosted.amountBase === "222000.00");
      assert("payment alokasi 1 invoice", payPosted.allocations.length === 1);
      assert("payment alokasi penuh", payPosted.allocations[0]!.amountBase === "222000.00");
      const invAfterPay = await getInvoice(actor, inv.id, tx);
      assert("invoice amountPaid 222000.00", invAfterPay.amountPaid === "222000.00");

      /* =================== Credit Note =================== */
      const cn = await createCreditNote(actor, {
        invoiceId: inv.id, branchId, creditNoteDate: "2040-03-25", reason: "Potensi retur",
        lines: [{ productId, quantity: "1.000", unitPrice: "20000.00" }],
      }, tx);
      const cnPosted = await postCreditNote(actor, cn.id, tx);
      assert("credit note posted", cnPosted.status === "posted" && !!cnPosted.journalEntryId);
      assert("credit note totalBase 20000.00", cnPosted.totalBase === "20000.00");

      /* =================== Reverse: blokir & sukses =================== */
      await expectError("reverse delivery diblokir faktur posted", tx, "BUSINESS_RULE", () =>
        reverseDelivery(actor, dlv.id, "coba balik", tx),
      );

      const payRev = await reversePayment(actor, pay.id, "salah input", tx);
      assert("payment reversed", payRev.status === "reversed");
      const invBack = await getInvoice(actor, inv.id, tx);
      assert("invoice amountPaid kembali 0.00", invBack.amountPaid === "0.00");

      /* =================== Limit kredit terlampaui =================== */
      await updateCustomer(actor, customerId, { creditLimit: "100000.00" }, tx);
      const so2 = await createSalesOrder(actor, {
        customerId, branchId, orderDate: "2040-03-28",
        lines: [{ productId, quantity: "100.000", unitPrice: "20000.00" }],
      }, tx);
      await submitSalesOrder(actor, so2.id, tx);
      const [req2] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.docType, "sales_order"), eq(approvalRequests.docId, so2.id), eq(approvalRequests.status, "pending")))
        .limit(1);
      await actOnApproval(approverActor, req2!.id, { action: "approve" }, tx);
      await approveSalesOrder(actor, so2.id, tx);
      await expectError("SO melebihi limit kredit", tx, "BUSINESS_RULE", () => postSalesOrder(actor, so2.id, tx));

      /* =================== Guard izin & not-found =================== */
      await expectError("createSO tanpa izin", tx, "FORBIDDEN", () =>
        createSalesOrder({ ...actor, grants: [] }, {
          customerId, branchId, orderDate: "2040-03-05",
          lines: [{ productId, quantity: "1.000", unitPrice: "10.00" }],
        }, tx),
      );
      await expectError("getDelivery tidak ada", tx, "NOT_FOUND", () => getDelivery(actor, fake, tx));
      await expectError("getReturn tanpa data", tx, "NOT_FOUND", () => getReturn(actor, fake, tx));
      await expectError("getCreditNote tidak ada", tx, "NOT_FOUND", () => getCreditNote(actor, fake, tx));
      await expectError("getPayment tidak ada", tx, "NOT_FOUND", () => getPayment(actor, fake, tx));

      // Daftar (baca) tidak boleh error dan mengembalikan array.
      assert("listDeliveries mengembalikan array", Array.isArray(await listDeliveries(actor, { customerId }, tx)));
      void getSalesOrder;

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-sales-flow] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-sales-flow] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
