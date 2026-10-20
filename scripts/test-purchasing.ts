import { and, eq, sql } from "drizzle-orm";

import { approvalRequests, branches, chartAccounts, companySettings, purchaseOrderLines, purchaseOrders, users } from "@/db/schema";
import { createProduct } from "@/modules/inventory/product-service";
import { getStockPosition } from "@/modules/inventory/stock-service";
import { createUnit } from "@/modules/inventory/unit-service";
import { createWarehouse } from "@/modules/inventory/warehouse-service";
import { createApprovalWorkflow } from "@/modules/core/approval-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { createPaymentTerm } from "@/modules/purchasing/payment-terms-service";
import { createSupplier } from "@/modules/purchasing/supplier-service";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  postPurchaseOrder,
  submitPurchaseOrder,
} from "@/modules/purchasing/po-service";
import { createReceiptFromPo } from "@/modules/purchasing/gr-from-po-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 5F (procurement berpusat PO): master termin/supplier, lifecycle
 * PO draf->pending_approval->approved->posted->cancel, penerimaan dari PO (GR) lewat
 * mesin stok 5D/5E, over-receipt, kurs hilang, batch inline, dan guard imutabilitas.
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`,
 * sehingga TIDAK ADA data tersimpan. BUTUH migrasi 0018 (tabel purchasing + guard).
 * Cabang disisipkan langsung (createBranch tak menerima externalTx); persetujuan
 * 3J di-flip manual ke 'approved' karena mesin approval diuji terpisah — fokus di
 * sini adalah orkestrasi purchasing.
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
        name: "Uji Purchasing",
        email: "purchasing@uji.example",
        grants: [
          ...grants,
          { code: "core.approval_workflows.manage", branchId: null },
          { code: "core.approvals.request", branchId: null },
          { code: "core.fiscal_years.manage", branchId: null },
          { code: "accounting.journals.post", branchId: null },
          { code: "purchasing.payment_terms.manage", branchId: null },
          { code: "purchasing.suppliers.manage", branchId: null },
          { code: "purchasing.purchase_orders.manage", branchId: null },
          { code: "purchasing.purchase_orders.post", branchId: null },
          { code: "purchasing.receipts.manage", branchId: null },
          { code: "inventory.units.manage", branchId: null },
          { code: "inventory.products.manage", branchId: null },
          { code: "inventory.warehouses.manage", branchId: null },
          { code: "inventory.documents.manage", branchId: null },
          { code: "inventory.stock.read", branchId: null },
        ],
      };

      // ---- Prasyarat master ----
      const [br] = await tx
        .insert(branches)
        .values({ code: "BR-PUR", name: "Cabang Purchasing", isActive: true, createdBy: u.id, updatedBy: u.id })
        .returning({ id: branches.id });
      if (!br) throw new Error("Gagal membuat cabang uji.");
      const branchId = br.id;

      // ---- Prasyarat buku besar (GR kini menerbitkan jurnal GR/IR sejak 5G) ----
      // Periode fiskal terisolasi 2026 agar dokumen penerimaan (Maret 2026) punya periode open.
      await createFiscalYear(
        actor,
        { code: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31", includeAdjustmentPeriod: false },
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
      // inventory=1300, grir=2120 (stand-in liabilitas), ap=2110; 5G test pakai 2115 sesungguhnya.
      const accountSettings: readonly [string, string][] = [
        ["inventory_account_id", await accountId("1300")],
        ["grir_account_id", await accountId("2120")],
        ["ap_account_id", await accountId("2110")],
      ];
      for (const [key, value] of accountSettings) {
        await tx
          .insert(companySettings)
          .values({ key, value, updatedBy: u.id })
          .onConflictDoUpdate({ target: companySettings.key, set: { value, updatedBy: u.id } });
      }

      const wh = await createWarehouse(actor, { code: "GUD-PUR", name: "Gudang PUR", branchId }, tx);
      const unit = await createUnit(actor, { code: "PCE", name: "Pieces Pur", symbol: "pc" }, tx);
      const plain = await createProduct(
        actor,
        { sku: "PUR-A", name: "Barang PUR-A", baseUnitId: unit.id, canPurchase: true },
        tx,
      );
      const batch = await createProduct(
        actor,
        { sku: "PUR-B", name: "Barang PUR-B", baseUnitId: unit.id, canPurchase: true, tracking: "batch", needsExpiry: true },
        tx,
      );

      const term = await createPaymentTerm(
        actor,
        { code: "TERM-30", name: "Net 30", dueInDays: 30 },
        tx,
      );
      assert("Term: dibuat aktif dueInDays 30", term.isActive === true && term.dueInDays === 30);

      const supplier = await createSupplier(
        actor,
        { code: "SUP-01", name: "Pemasok Uji", currency: "IDR", paymentTermsId: term.id },
        tx,
      );
      assert("Supplier: IDR + paymentTermsId terpasang", supplier.currency === "IDR" && supplier.paymentTermsId === term.id);

      // Alur persetujuan untuk purchase_order (satu langkah, approver = pengguna uji).
      await createApprovalWorkflow(
        actor,
        {
          docType: "purchase_order",
          name: "Alur PO Uji",
          isActive: true,
          steps: [{ approverUserId: u.id }],
        },
        tx,
      );

      const pos = async (productId: string) =>
        (await getStockPosition(actor, { productId, warehouseId: wh.id }, tx))[0];

      // ------------------ Lifecycle draf -> posted (IDR) -------------------
      const po = await createPurchaseOrder(
        actor,
        {
          supplierId: supplier.id,
          branchId,
          orderDate: "2026-03-01",
          lines: [{ productId: plain.id, quantity: "10", unitPrice: "1000" }],
        },
        tx,
      );
      assert("PO: status draf & tanpa docNo", po.status === "draft" && po.docNo === null);
      assert("PO: amountForeign baris 10000.00 (10 x 1000)", po.lines[0]?.amountForeign === "10000.00");

      // Hanya draf yang boleh diedit; edit setelah posted akan ditolak (diuji nanti).
      const submitted = await submitPurchaseOrder(actor, po.id, tx);
      assert("PO submit: pending_approval", submitted.status === "pending_approval");

      await simulateApproval(tx, po.id);

      const approved = await approvePurchaseOrder(actor, po.id, tx);
      assert("PO approve: approved", approved.status === "approved" && approved.approvedAt != null);

      const posted = await postPurchaseOrder(actor, po.id, tx);
      assert(
        "PO post: posted, docNo PO-, kurs 1.000000, totalBase 10000.00",
        posted.status === "posted" &&
          !!posted.docNo?.startsWith("PO-") &&
          posted.exchangeRate === "1.000000" &&
          posted.totalBase === "10000.00",
      );
      assert("PO post: baseAmount baris 10000.00", (await getPurchaseOrder(actor, po.id, tx)).lines[0]?.baseAmount === "10000.00");

      // ------------------------- GR dari PO --------------------------------
      assert("Sebelum GR: PUR-A onHand kosong", (await pos(plain.id)) === undefined);
      const poLine = posted.lines[0]!;
      const gr = await createReceiptFromPo(
        actor,
        po.id,
        {
          warehouseId: wh.id,
          documentDate: "2026-03-02",
          lines: [{ poLineId: poLine.id, quantity: "4" }],
        },
        tx,
      );
      assert("GR: dokumen posted dengan nomor GR-", gr.stockDocument.status === "posted" && !!gr.stockDocument.docNo?.startsWith("GR-"));
      const after = await pos(plain.id);
      assert("GR: PUR-A onHand 4.000 valuasi 4000.00 (biaya PO 1000/unit)", after?.onHand === "4.000" && after?.valuation === "4000.00");
      const poAfter = await getPurchaseOrder(actor, po.id, tx);
      assert("GR: quantityReceived baris jadi 4.000", poAfter.lines[0]?.quantityReceived === "4.000");

      // --------------------- Over-receipt ditolak --------------------------
      await expectError("GR melebihi sisa (7 > 6) -> BUSINESS_RULE", tx, "BUSINESS_RULE", () =>
        createReceiptFromPo(actor, po.id, { warehouseId: wh.id, documentDate: "2026-03-02", lines: [{ poLineId: poLine.id, quantity: "7" }] }, tx),
      );

      // -------------------- Kurs hilang (USD) -> BUSINESS_RULE -------------
      const usdSupplier = await createSupplier(actor, { code: "SUP-USD", name: "Pemasok USD", currency: "USD" }, tx);
      const usdPo = await createPurchaseOrder(
        actor,
        { supplierId: usdSupplier.id, branchId, orderDate: "2026-03-01", lines: [{ productId: plain.id, quantity: "5", unitPrice: "10" }] },
        tx,
      );
      assert("PO USD: mata uang terserap dari supplier", usdPo.currency === "USD");
      // Submit menghitung taksiran total dasar -> resolusi kurs USD gagal (tak ada rate).
      await expectError("PO USD submit tanpa kurs -> BUSINESS_RULE", tx, "BUSINESS_RULE", () =>
        submitPurchaseOrder(actor, usdPo.id, tx),
      );

      // ---------------------- Batch inline di GR ---------------------------
      const bpo = await createPurchaseOrder(
        actor,
        { supplierId: supplier.id, branchId, orderDate: "2026-03-01", lines: [{ productId: batch.id, quantity: "5", unitPrice: "2000" }] },
        tx,
      );
      await submitPurchaseOrder(actor, bpo.id, tx);
      await simulateApproval(tx, bpo.id);
      await approvePurchaseOrder(actor, bpo.id, tx);
      const bposted = await postPurchaseOrder(actor, bpo.id, tx);
      const bLine = bposted.lines[0]!;
      const grB = await createReceiptFromPo(
        actor,
        bpo.id,
        {
          warehouseId: wh.id,
          documentDate: "2026-03-03",
          lines: [{ poLineId: bLine.id, quantity: "5", batchNo: "B-2026", batchExpiryDate: "2027-01-01" }],
        },
        tx,
      );
      const posB = await pos(batch.id);
      assert(
        "GR batch: posted & PUR-B onHand 5.000 valuasi 10000.00",
        grB.stockDocument.status === "posted" && posB?.onHand === "5.000" && posB?.valuation === "10000.00",
      );

      // -------------------- Guard imutabilitas PO posted -------------------
      await expectThrows("baris PO posted tak boleh ubah komposisi", tx, "non-draf", () =>
        tx.update(purchaseOrderLines).set({ quantity: "999" }).where(eq(purchaseOrderLines.id, poLine.id)),
      );
      await expectThrows("header PO posted tak boleh ubah supplier", tx, "non-draf", () =>
        tx.update(purchaseOrders).set({ supplierId: usdSupplier.id }).where(eq(purchaseOrders.id, po.id)),
      );

      // -------------------------- Cancel -----------------------------------
      const draftPo = await createPurchaseOrder(
        actor,
        { supplierId: supplier.id, branchId, orderDate: "2026-03-05", lines: [{ productId: plain.id, quantity: "1", unitPrice: "10" }] },
        tx,
      );
      const cancelled = await cancelPurchaseOrder(actor, draftPo.id, { reason: "batal uji purchasing" }, tx);
      assert("Cancel draf: status cancelled + reason", cancelled.status === "cancelled" && cancelled.reason === "batal uji purchasing");
      await expectError("cancel PO posted ditolak", tx, "BUSINESS_RULE", () =>
        cancelPurchaseOrder(actor, po.id, { reason: "coba batal posted" }, tx),
      );

      // --------------------------- Izin ------------------------------------
      await expectError("get PO tanpa izin read", tx, "FORBIDDEN", () => getPurchaseOrder({ ...actor, grants: [] }, po.id, tx));
      await expectError("create PO tanpa izin manage", tx, "FORBIDDEN", () =>
        createPurchaseOrder({ ...actor, grants: [] }, { supplierId: supplier.id, branchId, orderDate: "2026-03-06", lines: [{ productId: plain.id, quantity: "1", unitPrice: "10" }] }, tx),
      );
      await expectError("get PO tidak ada", tx, "NOT_FOUND", () => getPurchaseOrder(actor, fake, tx));

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-purchasing] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-purchasing] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
