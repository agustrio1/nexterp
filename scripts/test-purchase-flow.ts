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
import {
  expirySchedule,
  inventoryValuation,
  reorderReport,
  stockCard,
} from "@/modules/inventory/report-service";
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
import { createApPayment, postApPayment } from "@/modules/purchasing/ap-payment-service";
import {
  apAging,
  apGlReconciliation,
  purchaseReport,
} from "@/modules/purchasing/report-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 5H — laporan & rekonsiliasi (e2e, rollback penuh).
 * Alur: PO -> GR (Dr Inv/Cr GR-IR) -> invoice match (Dr GR-IR/Cr AP) -> pembayaran
 * (Dr AP/Cr Bank). Lalu memverifikasi kartu stok, valuasi, reorder, aging AP,
 * laporan pembelian, dan rekonsiliasi subledger↔GL (AP/GR-IR/Inventory == 0 selisih).
 * Skenario kedua menguji jadwal kedaluwarsa (batch/expiry).
 *
 * BUTUH migrasi 0021 (products.reorder_point) + COA 2115 (db:seed-coa).
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

/** Setujui pengajuan PO dengan mem-flip approval_request ke 'approved' (simulasi 3J). */
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

  try {
    await db.transaction(async (tx) => {
      const grants = await loadGrants(u.id);
      const actor: AuthContext = {
        userId: u.id,
        name: "Uji 5H",
        email: "reports@uji.example",
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
          { code: "purchasing.ap.read", branchId: null },
          { code: "purchasing.reports.read", branchId: null },
          { code: "inventory.units.manage", branchId: null },
          { code: "inventory.products.manage", branchId: null },
          { code: "inventory.warehouses.manage", branchId: null },
          { code: "inventory.documents.manage", branchId: null },
          { code: "inventory.stock.read", branchId: null },
        ],
      };

      // ---- Prasyarat master + buku besar ----
      const [br] = await tx
        .insert(branches)
        .values({ code: "BR-RPT", name: "Cabang Laporan", isActive: true, createdBy: u.id, updatedBy: u.id })
        .returning({ id: branches.id });
      if (!br) throw new Error("Gagal membuat cabang uji.");
      const branchId = br.id;

      await createFiscalYear(
        actor,
        { code: "FY2046", startDate: "2046-01-01", endDate: "2046-12-31", includeAdjustmentPeriod: false },
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

      const wh = await createWarehouse(actor, { code: "GUD-RPT", name: "Gudang Laporan", branchId }, tx);
      const unit = await createUnit(actor, { code: "RPC", name: "Pieces Laporan", symbol: "pc" }, tx);
      // Produk dengan reorder point terisi (untuk laporan reorder).
      const plain = await createProduct(
        actor,
        { sku: "RPT-A", name: "Barang Laporan A", baseUnitId: unit.id, canPurchase: true, reorderPoint: "20" },
        tx,
      );
      const term = await createPaymentTerm(actor, { code: "RPT-30", name: "Net 30", dueInDays: 30 }, tx);
      const supplier = await createSupplier(
        actor,
        { code: "SUP-RPT", name: "Pemasok Laporan", currency: "IDR", paymentTermsId: term.id },
        tx,
      );
      const bank = await createBankAccount(
        actor,
        { code: "BANK-RPT", name: "Bank Laporan", accountId: bankGlId, kind: "bank", branchId },
        tx,
      );
      await createApprovalWorkflow(
        actor,
        { docType: "purchase_order", name: "Alur PO Laporan", isActive: true, steps: [{ approverUserId: u.id }] },
        tx,
      );

      interface PoOpts {
        productId: string;
        ordered: string;
        received: string;
        unitPrice: string;
        batchNo?: string;
        batchExpiryDate?: string;
      }
      /** PO -> submit -> approve -> post -> GR; kembalikan po/baris/gr. */
      async function poWithReceipt(opts: PoOpts) {
        const po = await createPurchaseOrder(
          actor,
          {
            supplierId: supplier.id,
            branchId,
            orderDate: "2046-03-01",
            lines: [{ productId: opts.productId, quantity: opts.ordered, unitPrice: opts.unitPrice }],
          },
          tx,
        );
        await submitPurchaseOrder(actor, po.id, tx);
        await simulateApproval(tx, po.id);
        await approvePurchaseOrder(actor, po.id, tx);
        const postedPo = await postPurchaseOrder(actor, po.id, tx);
        const line = postedPo.lines[0]!;
        const gr = await createReceiptFromPo(
          actor,
          po.id,
          {
            warehouseId: wh.id,
            documentDate: "2046-03-05",
            lines: [
              {
                poLineId: line.id,
                quantity: opts.received,
                batchNo: opts.batchNo,
                batchExpiryDate: opts.batchExpiryDate,
              },
            ],
          },
          tx,
        );
        return { po: postedPo, poLine: line, gr };
      }

      // ============ Skenario A: siklus penuh AP-nya berimbang ============
      const main1 = await poWithReceipt({ productId: plain.id, ordered: "10", received: "6", unitPrice: "1000" });
      const invoice1 = await createSupplierInvoice(
        actor,
        { poId: main1.po.id, invoiceDate: "2046-04-01", dueDate: "2046-04-30", lines: [{ poLineId: main1.poLine.id, quantity: "6", unitPrice: "1000" }] },
        tx,
      );
      await postSupplierInvoice(actor, invoice1.id, tx);
      const payment = await createApPayment(
        actor,
        { supplierId: supplier.id, branchId, paymentDate: "2046-05-01", currency: "IDR", amountForeign: "6000", bankAccountId: bank.id },
        tx,
      );
      await postApPayment(actor, payment.id, tx);

      // PO kedua: diterima & ditagih tapi BELUM dibayar (utang terbuka 5000, jatuh tempo 2046-04-30).
      const main2 = await poWithReceipt({ productId: plain.id, ordered: "8", received: "5", unitPrice: "1000" });
      const invoice2 = await createSupplierInvoice(
        actor,
        { poId: main2.po.id, invoiceDate: "2046-04-05", dueDate: "2046-04-30", lines: [{ poLineId: main2.poLine.id, quantity: "5", unitPrice: "1000" }] },
        tx,
      );
      await postSupplierInvoice(actor, invoice2.id, tx);

      // ---- Kartu stok (produk A): 2 pergerakan masuk, saldo 11 / 11000 ----
      const card = await stockCard(actor, { productId: plain.id, warehouseId: wh.id }, tx);
      assert("Kartu stok: 2 pergerakan", card.rows.length === 2);
      assert("Kartu stok: saldo akhir 11.000 / 11000.00", card.closingQuantity === "11.000" && card.closingValue === "11000.00");

      // ---- Valuasi persediaan (produk A) ----
      const val = await inventoryValuation(actor, { productId: plain.id }, tx);
      const valRow = val.rows.find((r) => r.productId === plain.id);
      assert("Valuasi: sisa 11.000 nilai 11000.00", valRow?.remaining === "11.000" && valRow?.value === "11000.00");
      assert("Valuasi: 2 lapisan", valRow?.layerCount === 2);

      // ---- Reorder: A punya reorderPoint 20, onHand 11 -> di bawah titik pesan ----
      const reorder = await reorderReport(actor, {}, tx);
      const reorderRow = reorder.rows.find((r) => r.productId === plain.id);
      assert("Reorder: produk A tercatat", !!reorderRow);
      assert(
        "Reorder: reorderPoint 20.000 onHand 11.000 saran 9.000",
        reorderRow?.reorderPoint === "20.000" && reorderRow?.onHand === "11.000" && reorderRow?.suggestedQuantity === "9.000",
      );

      // ---- Aging AP (asOf 2046-06-15): hanya invoice2 tersisa 5000, umur 46 hari (31-60) ----
      const aging = await apAging(actor, { asOf: "2046-06-15" }, tx);
      assert("Aging: total outstanding 5000.00", aging.totalOutstandingBase === "5000.00");
      const bucket3160 = aging.buckets.find((b) => b.key === "31-60");
      assert("Aging: ember 31-60 = 1 invoice / 5000.00", bucket3160?.count === 1 && bucket3160?.amount === "5000.00");

      // ---- Laporan pembelian per supplier ----
      const purchase = await purchaseReport(actor, { from: "2046-01-01", to: "2046-12-31", supplierId: supplier.id }, tx);
      const prow = purchase.rows.find((r) => r.supplierId === supplier.id);
      assert(
        "Laporan pembelian: PO 2 / 18000, terima 11 / 11000, invoice 2 / 11000, bayar 1 / 6000, outstanding 5000",
        prow?.poCount === 2 &&
          prow?.poValue === "18000.00" &&
          prow?.receivedValue === "11000.00" &&
          prow?.invoiceValue === "11000.00" &&
          prow?.paymentValue === "6000.00" &&
          prow?.outstanding === "5000.00",
      );

      // ---- Rekonsiliasi subledger <-> GL: AP, GR/IR, Inventory semuanya == 0 selisih ----
      const recon = await apGlReconciliation(actor, {}, tx);
      assert("Rekonsiliasi: selisih AP 0 & cocok", recon.lines[0]?.difference === "0.00" && recon.lines[0]?.matched === true);
      assert("Rekonsiliasi: selisih GR/IR 0 & cocok", recon.lines[1]?.difference === "0.00" && recon.lines[1]?.matched === true);
      assert("Rekonsiliasi: selisih Inventory 0 & cocok", recon.lines[2]?.difference === "0.00" && recon.lines[2]?.matched === true);
      assert("Rekonsiliasi: semuanya seimbang", recon.balanced === true);
      // AP subledger = invoice(11000) - payment(6000) = 5000; Inventory subledger = valuasi 11000.
      assert("Rekonsiliasi: AP subledger 5000.00", recon.lines[0]?.subledger === "5000.00");
      assert("Rekonsiliasi: Inventory subledger 11000.00", recon.lines[2]?.subledger === "11000.00");

      // ============ Skenario B: jadwal kedaluwarsa (batch/expiry) ============
      const perishable = await createProduct(
        actor,
        { sku: "RPT-B", name: "Barang Laporan B", baseUnitId: unit.id, canPurchase: true, tracking: "batch", needsExpiry: true },
        tx,
      );
      await poWithReceipt({
        productId: perishable.id,
        ordered: "4",
        received: "4",
        unitPrice: "500",
        batchNo: "B-EXP-46",
        batchExpiryDate: "2046-06-30",
      });

      const soonExpiry = await expirySchedule(actor, { asOf: "2046-06-01", withinDays: 90, productId: perishable.id }, tx);
      const expRow = soonExpiry.rows.find((r) => r.productId === perishable.id);
      assert(
        "Expiry: lapisan B dekat (29 hari, active)",
        expRow?.expiryDate === "2046-06-30" && expRow?.status === "active" && expRow?.daysToExpiry === 29,
      );

      const pastExpiry = await expirySchedule(actor, { asOf: "2046-07-15", withinDays: 90, includeExpired: false, productId: perishable.id }, tx);
      assert("Expiry: sudah kedaluwarsa tersaring keluar", !pastExpiry.rows.some((r) => r.productId === perishable.id));

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-purchase-flow] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-purchase-flow] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
