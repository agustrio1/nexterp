import { and, eq } from "drizzle-orm";

import {
  approvalRequests,
  branches,
  chartAccounts,
  companySettings,
  users,
} from "@/db/schema";
import { createUnit } from "@/modules/inventory/unit-service";
import { createProduct } from "@/modules/inventory/product-service";
import { createWarehouse } from "@/modules/inventory/warehouse-service";
import { createApprovalWorkflow } from "@/modules/core/approval-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { createBankAccount } from "@/modules/accounting/bank-account-service";
import { createPaymentTerm } from "@/modules/purchasing/payment-terms-service";
import { createSupplier } from "@/modules/purchasing/supplier-service";
import {
  approvePurchaseOrder,
  createPurchaseOrder,
  postPurchaseOrder,
  submitPurchaseOrder,
} from "@/modules/purchasing/po-service";
import { createReceiptFromPo } from "@/modules/purchasing/gr-from-po-service";
import { createSupplierInvoice, postSupplierInvoice } from "@/modules/purchasing/invoice-service";
import { createApPayment, postApPayment, reverseApPayment } from "@/modules/purchasing/ap-payment-service";
import { apGlReconciliation } from "@/modules/purchasing/report-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 5H — INVARIAN rekonsiliasi subledger↔GL (rollback penuh).
 * Membuktikan bahwa pada tiap tahap (terima sebagian, tagih sebagian, bayar
 * sebagian, lalu reversal pembayaran) selisih AP / GR-IR / Inventory terhadap GL
 * tetap NOL. Ini menjaga aturan 5H: subledger == GL (jurnal posted+reversed).
 *
 * BUTUH migrasi 0021 + COA 2115 (db:seed-coa).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

async function simulateApproval(tx: Tx, poId: string) {
  const [req] = await tx
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.docType, "purchase_order"), eq(approvalRequests.docId, poId)))
    .limit(1);
  if (!req) throw new Error("approval_request PO tidak ditemukan.");
  await tx
    .update(approvalRequests)
    .set({ status: "approved", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(approvalRequests.id, req.id));
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  try {
    await db.transaction(async (tx) => {
      const grants = await loadGrants(u.id);
      const actor: AuthContext = {
        userId: u.id,
        name: "Uji Rekonsiliasi",
        email: "recon@uji.example",
        grants: [
          ...grants,
          { code: "core.approval_workflows.manage", branchId: null },
          { code: "core.approvals.request", branchId: null },
          { code: "core.fiscal_years.manage", branchId: null },
          { code: "accounting.journals.post", branchId: null },
          { code: "accounting.bank_accounts.manage", branchId: null },
          { code: "purchasing.payment_terms.manage", branchId: null },
          { code: "purchasing.suppliers.manage", branchId: null },
          { code: "purchasing.purchase_orders.manage", branchId: null },
          { code: "purchasing.purchase_orders.post", branchId: null },
          { code: "purchasing.receipts.manage", branchId: null },
          { code: "purchasing.invoices.manage", branchId: null },
          { code: "purchasing.invoices.post", branchId: null },
          { code: "purchasing.payments.manage", branchId: null },
          { code: "purchasing.payments.post", branchId: null },
          { code: "purchasing.reports.read", branchId: null },
          { code: "inventory.units.manage", branchId: null },
          { code: "inventory.products.manage", branchId: null },
          { code: "inventory.warehouses.manage", branchId: null },
          { code: "inventory.documents.manage", branchId: null },
        ],
      };

      const [br] = await tx
        .insert(branches)
        .values({ code: "BR-REC", name: "Cabang Rekonsiliasi", isActive: true, createdBy: u.id, updatedBy: u.id })
        .returning({ id: branches.id });
      if (!br) throw new Error("Gagal membuat cabang uji.");
      const branchId = br.id;

      await createFiscalYear(
        actor,
        { code: "FY2047", startDate: "2047-01-01", endDate: "2047-12-31", includeAdjustmentPeriod: false },
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
      for (const [key, value] of [
        ["inventory_account_id", await accountId("1300")],
        ["grir_account_id", await accountId("2115")],
        ["ap_account_id", await accountId("2110")],
      ] as readonly [string, string][]) {
        await tx
          .insert(companySettings)
          .values({ key, value, updatedBy: u.id })
          .onConflictDoUpdate({ target: companySettings.key, set: { value, updatedBy: u.id } });
      }
      const bankGlId = await accountId("1111");

      const wh = await createWarehouse(actor, { code: "GUD-REC", name: "Gudang Rekonsiliasi", branchId }, tx);
      const unit = await createUnit(actor, { code: "RECU", name: "Pieces Recon", symbol: "pc" }, tx);
      const product = await createProduct(
        actor,
        { sku: "REC-A", name: "Barang Rekonsiliasi", baseUnitId: unit.id, canPurchase: true },
        tx,
      );
      const term = await createPaymentTerm(actor, { code: "REC-30", name: "Net 30", dueInDays: 30 }, tx);
      const supplier = await createSupplier(
        actor,
        { code: "SUP-REC", name: "Pemasok Recon", currency: "IDR", paymentTermsId: term.id },
        tx,
      );
      const bank = await createBankAccount(
        actor,
        { code: "BANK-REC", name: "Bank Recon", accountId: bankGlId, kind: "bank", branchId },
        tx,
      );
      await createApprovalWorkflow(
        actor,
        { docType: "purchase_order", name: "Alur PO Recon", isActive: true, steps: [{ approverUserId: u.id }] },
        tx,
      );

      /** Semua tiga baris rekonsiliasi harus berselisih nol. */
      async function assertBalanced(stage: string) {
        const recon = await apGlReconciliation(actor, {}, tx);
        for (const line of recon.lines) {
          assert(`${stage}: selisih ${line.label} = 0`, line.matched === true && line.difference === "0.00");
        }
        assert(`${stage}: balanced`, recon.balanced === true);
        return recon;
      }

      // PO 10 unit @1000. Terima 6 (Inv+6000, GR/IR Cr 6000).
      const po = await createPurchaseOrder(
        actor,
        { supplierId: supplier.id, branchId, orderDate: "2047-03-01", lines: [{ productId: product.id, quantity: "10", unitPrice: "1000" }] },
        tx,
      );
      await submitPurchaseOrder(actor, po.id, tx);
      await simulateApproval(tx, po.id);
      await approvePurchaseOrder(actor, po.id, tx);
      const postedPo = await postPurchaseOrder(actor, po.id, tx);
      const poLine = postedPo.lines[0]!;
      await createReceiptFromPo(
        actor,
        po.id,
        { warehouseId: wh.id, documentDate: "2047-03-05", lines: [{ poLineId: poLine.id, quantity: "6" }] },
        tx,
      );

      // Tahap 1: baru diterima, belum ditagih -> AP 0, GR/IR = persediaan 6000.
      const r1 = await assertBalanced("Tahap 1 (terima, belum tagih)");
      assert("Tahap 1: AP subledger 0.00", r1.lines[0]?.subledger === "0.00");
      assert("Tahap 1: GR/IR subledger 6000.00", r1.lines[1]?.subledger === "6000.00");
      assert("Tahap 1: Inventory subledger 6000.00", r1.lines[2]?.subledger === "6000.00");

      // Tahap 2: tagih 4 unit (4000). GR/IR turun ke 2000, AP naik 4000.
      const invoice = await createSupplierInvoice(
        actor,
        { poId: po.id, invoiceDate: "2047-04-01", dueDate: "2047-04-30", lines: [{ poLineId: poLine.id, quantity: "4", unitPrice: "1000" }] },
        tx,
      );
      await postSupplierInvoice(actor, invoice.id, tx);
      const r2 = await assertBalanced("Tahap 2 (tagih 4000)");
      assert("Tahap 2: AP subledger 4000.00", r2.lines[0]?.subledger === "4000.00");
      assert("Tahap 2: GR/IR subledger 2000.00", r2.lines[1]?.subledger === "2000.00");
      assert("Tahap 2: Inventory subledger tetap 6000.00", r2.lines[2]?.subledger === "6000.00");

      // Tahap 3: bayar sebagian 2000. AP turun ke 2000.
      const payDraft = await createApPayment(
        actor,
        { supplierId: supplier.id, branchId, paymentDate: "2047-05-01", currency: "IDR", amountForeign: "2000", bankAccountId: bank.id },
        tx,
      );
      const paid = await postApPayment(actor, payDraft.id, tx);
      const r3 = await assertBalanced("Tahap 3 (bayar 2000)");
      assert("Tahap 3: AP subledger 2000.00", r3.lines[0]?.subledger === "2000.00");

      // Tahap 4: reversal pembayaran. AP kembali 4000.
      await reverseApPayment(actor, paid.id, { reason: "reversal uji rekonsiliasi" }, tx);
      const r4 = await assertBalanced("Tahap 4 (reversal pembayaran)");
      assert("Tahap 4: AP subledger kembali 4000.00", r4.lines[0]?.subledger === "4000.00");
      assert("Tahap 4: GR/IR tetap 2000.00", r4.lines[1]?.subledger === "2000.00");

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-ap-reconciliation] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-ap-reconciliation] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
