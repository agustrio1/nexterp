import { eq, sql } from "drizzle-orm";
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
import { createCustomer } from "@/modules/crm/customer-service";
import { actOnApproval, createApprovalWorkflow } from "@/modules/core/approval-service";
import { postStockMovement } from "@/modules/inventory/stock-service";
import { createCreditNote, postCreditNote } from "@/modules/sales/credit-note-service";
import { createDelivery, postDelivery } from "@/modules/sales/delivery-service";
import { createInvoice, postInvoice } from "@/modules/sales/invoice-service";
import { createPayment, postPayment } from "@/modules/sales/payment-service";
import { arAging, arGlReconciliation, salesReport } from "@/modules/sales/report-service";
import {
  approveSalesOrder,
  createSalesOrder,
  postSalesOrder,
  submitSalesOrder,
} from "@/modules/sales/so-service";
import type { AuthContext, Grant } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 6F: laporan Sales/AR + rekonsiliasi subledger↔GL.
 * SATU db.transaction + throw Rollback — TIDAK ADA data tersimpan di DB.
 * Menjaga invariant AR: `Σ invoice posted − Σ pembayaran posted − Σ nota kredit
 * posted == GL net akun AR (debit − kredit)` pada jurnal posted+reversed.
 * Aging & salesReport diverifikasi pada titik yang sama. Baris Inventory TIDAK
 * di-assert (stok opening synthetic tanpa jurnal GL — di luar cakupan Alur 6F).
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

let ACTOR_ID = "00000000-0000-4000-8000-000000000000";

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

function arLine(recon: Awaited<ReturnType<typeof arGlReconciliation>>) {
  return recon.lines.find((l) => l.label.includes("Piutang"))!;
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna. Jalankan seed/create-admin dulu.");
  ACTOR_ID = u.id;

  const permRows = await db.select({ code: permissions.code }).from(permissions);
  const allGrants: Grant[] = permRows.map((p) => ({ code: p.code, branchId: null }));
  const actor: AuthContext = { userId: u.id, name: "Uji Recon", email: "uji-recon@example.com", grants: allGrants };

  try {
    await db.transaction(async (tx) => {
      /* =================== Prasyarat master =================== */
      const bankGlAccountId = await insertOne(tx, chartAccounts, { code: "TSTR-1100", name: "Bank Recon", type: "asset", isPostable: true, isActive: true });
      const arAccountId = await insertOne(tx, chartAccounts, { code: "TSTR-1200", name: "Piutang Recon", type: "asset", isPostable: true, isActive: true });
      const inventoryAccountId = await insertOne(tx, chartAccounts, { code: "TSTR-1300", name: "Persediaan Recon", type: "asset", isPostable: true, isActive: true });
      const taxAccountId = await insertOne(tx, chartAccounts, { code: "TSTR-2130", name: "UTang Pajak Recon", type: "liability", isPostable: true, isActive: true });
      const revenueAccountId = await insertOne(tx, chartAccounts, { code: "TSTR-4100", name: "Pendapatan Recon", type: "revenue", isPostable: true, isActive: true });
      const cogsAccountId = await insertOne(tx, chartAccounts, { code: "TSTR-5100", name: "HPP Recon", type: "expense", isPostable: true, isActive: true });

      const settings: [string, unknown][] = [
        ["base_currency", "IDR"],
        ["ar_account_id", arAccountId],
        ["revenue_account_id", revenueAccountId],
        ["cogs_account_id", cogsAccountId],
        ["tax_payable_account_id", taxAccountId],
        ["inventory_account_id", inventoryAccountId],
      ];
      for (const [key, value] of settings) {
        await tx.insert(companySettings).values({ key, value, updatedBy: actor.userId })
          .onConflictDoUpdate({ target: companySettings.key, set: { value, updatedBy: actor.userId } });
      }

      const fyId = await insertOne(tx, fiscalYears, { code: "TSTR-FY", startDate: "2040-01-01", endDate: "2040-12-31", status: "open" });
      await insertOne(tx, accountingPeriods, { fiscalYearId: fyId, periodNo: 1, startDate: "2040-01-01", endDate: "2040-12-31", status: "open" });

      const branchId = await insertOne(tx, branches, { code: "TSTR-BR", name: "Cabang Recon", isActive: true });
      const warehouseId = await insertOne(tx, warehouses, { code: "TSTR-WH", name: "Gudang Recon", branchId, isActive: true });
      const bankAccountId = await insertOne(tx, bankAccounts, { code: "TSTR-BANK", name: "Rekening Recon", accountId: bankGlAccountId, kind: "bank", isActive: true });

      const taxId = await insertOne(tx, taxes, { code: "TSTR-PPN", name: "PPN Recon", kind: "output", taxAccountId: taxAccountId, isActive: true });
      await insertOne(tx, taxRates, { taxId, rate: "11.0000", effectiveFrom: "2040-01-01", source: "UU HPP" });

      const unitId = await insertOne(tx, unitsOfMeasure, { code: "TSTR-PCS", name: "Pieces Recon", isActive: true });
      const productId = await insertOne(tx, products, { sku: "TSTR-P1", name: "Produk Recon", baseUnitId: unitId, canSell: true, canPurchase: true, tracking: "none", isActive: true });

      const acctId = (await createAccount(actor, { code: "TSTR-ACC", name: "Akun Recon", type: "customer" }, tx)).id;
      const customerId = (await createCustomer(actor, { crmAccountId: acctId, code: "TSTR-CUST", currency: "IDR", creditLimit: "1000000000.00" }, tx)).id;

      const rand = crypto.randomUUID().slice(0, 8);
      const [approver] = await tx.insert(users).values({ name: "Approver Recon", email: `tstr-approver-${rand}@example.com`, status: "active" }).returning({ id: users.id });
      const approverId = approver!.id;
      const approverActor: AuthContext = { userId: approverId, name: "Approver", email: `tstr-approver-${rand}@example.com`, grants: allGrants };
      await createApprovalWorkflow(actor, { docType: "sales_order", name: "Alur SO Recon", steps: [{ approverUserId: approverId }], isActive: true }, tx);

      /* =================== Rekonsiliasi awal (nol) =================== */
      const recon0 = await arGlReconciliation(actor, {}, tx);
      assert("recon awal balanced", recon0.balanced);
      assert("recon awal AR subledger 0.00", arLine(recon0).subledger === "0.00");

      /* =================== Alur SO -> delivery -> invoice =================== */
      const so = await createSalesOrder(actor, {
        customerId, branchId, orderDate: "2040-03-05",
        lines: [{ productId, quantity: "10.000", unitPrice: "20000.00" }],
      }, tx);
      const soLineId = so.lines[0]!.id;
      await submitSalesOrder(actor, so.id, tx);
      const [req] = await tx.select({ id: approvalRequests.id }).from(approvalRequests)
        .where(eq(approvalRequests.docId, so.id)).limit(1);
      await actOnApproval(approverActor, req!.id, { action: "approve" }, tx);
      await approveSalesOrder(actor, so.id, tx);
      await postSalesOrder(actor, so.id, tx);

      await postStockMovement(actor, { productId, warehouseId, direction: "in", quantity: "100.000", unitCost: "5000.00", movementDate: "2040-01-05", sourceType: "opening" }, tx);
      const dlv = await createDelivery(actor, {
        soId: so.id, branchId, warehouseId, deliveryDate: "2040-03-10",
        lines: [{ soLineId, productId, quantity: "10.000" }],
      }, tx);
      const dlvLineId = dlv.lines[0]!.id;
      await postDelivery(actor, dlv.id, tx);

      const inv = await createInvoice(actor, {
        deliveryId: dlv.id, branchId, invoiceDate: "2040-03-15", dueDate: "2040-04-15", taxId,
        lines: [{ deliveryLineId: dlvLineId, productId, quantity: "10.000", unitPrice: "20000.00" }],
      }, tx);
      await postInvoice(actor, inv.id, taxId, tx);

      /* =================== Recon + aging setelah invoice =================== */
      const recon1 = await arGlReconciliation(actor, {}, tx);
      const ar1 = arLine(recon1);
      assert("recon AR invoice matched", ar1.matched);
      assert("recon AR subledger 222000.00", ar1.subledger === "222000.00");
      assert("recon AR == GL net", ar1.subledger === ar1.gl);

      const aging1 = await arAging(actor, { asOf: "2040-03-20", customerId }, tx);
      assert("aging 1 baris piutang", aging1.rows.length === 1);
      assert("aging outstanding 222000.00", aging1.totalOutstandingBase === "222000.00");
      assert("aging bucket current", aging1.rows[0]!.bucket === "current");

      /* =================== Pembayaran penuh =================== */
      const pay = await createPayment(actor, {
        customerId, branchId, paymentDate: "2040-03-20", bankAccountId, amountForeign: "222000.00",
      }, tx);
      await postPayment(actor, pay.id, tx);

      const recon2 = await arGlReconciliation(actor, {}, tx);
      const ar2 = arLine(recon2);
      assert("recon AR setelah bayar matched", ar2.matched);
      assert("recon AR subledger kembali 0.00", ar2.subledger === "0.00");

      const aging2 = await arAging(actor, { asOf: "2040-03-25", customerId }, tx);
      assert("aging 0 baris setelah lunas", aging2.rows.length === 0);
      assert("aging outstanding 0.00", aging2.totalOutstandingBase === "0.00");

      /* =================== Nota kredit =================== */
      const cn = await createCreditNote(actor, {
        invoiceId: inv.id, branchId, creditNoteDate: "2040-03-28", reason: "Potensi retur",
        lines: [{ productId, quantity: "1.000", unitPrice: "20000.00" }],
      }, tx);
      await postCreditNote(actor, cn.id, tx);

      const recon3 = await arGlReconciliation(actor, {}, tx);
      const ar3 = arLine(recon3);
      assert("recon AR setelah nota kredit matched", ar3.matched);
      assert("recon AR subledger -20000.00", ar3.subledger === "-20000.00");

      /* =================== Sales report =================== */
      const rep = await salesReport(actor, { customerId }, tx);
      const row = rep.rows.find((r) => r.customerId === customerId)!;
      assert("report invoiceValue 222000.00", row.invoiceValue === "222000.00");
      assert("report paymentValue 222000.00", row.paymentValue === "222000.00");
      assert("report creditValue 20000.00", row.creditValue === "20000.00");
      assert("report outstanding -20000.00", row.outstanding === "-20000.00");
      assert("report totals outstanding -20000.00", rep.totals.outstanding === "-20000.00");

      // Sanity GL AR memakai akun fresh uji (tidak terpolusi data lain).
      const glAr = await tx.execute(sql`
        SELECT (coalesce(sum(debit), 0) - coalesce(sum(credit), 0))::text AS net
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.account_id = ${arAccountId} AND je.status IN ('posted', 'reversed')
      `) as unknown as { rows: { net: string }[] };
      assert("GL AR net == subledger (-20000.00)", Number(glAr.rows[0]!.net) === -20000);

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-sales-reconciliation] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-sales-reconciliation] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
