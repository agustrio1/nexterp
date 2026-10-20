import { and, eq, sql } from "drizzle-orm";

import {
  branches,
  stockBatches,
  stockSerials,
  users,
} from "@/db/schema";
import {
  cancelStockDocument,
  createStockDocument,
  postStockDocument,
  reverseStockDocument,
} from "@/modules/inventory/document-service";
import { createProduct, updateProduct } from "@/modules/inventory/product-service";
import { getStockPosition } from "@/modules/inventory/stock-service";
import { createUnit } from "@/modules/inventory/unit-service";
import { createWarehouse } from "@/modules/inventory/warehouse-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 5E-batch (batch/serial/expiry di atas mesin
 * dokumen 5D). Seluruh operasi berjalan dalam SATU `db.transaction` dengan
 * `throw Rollback`, sehingga TIDAK ADA data tersimpan. BUTUH tabel 5E-batch
 * (migrasi 0017). Cabang disisipkan langsung (createBranch tak menerima externalTx).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
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

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  try {
    await db.transaction(async (tx) => {
      const grants = await loadGrants(u.id);
      const actor: AuthContext = {
        userId: u.id,
        name: "Uji",
        email: "uji@example.com",
        grants: [
          ...grants,
          { code: "inventory.units.manage", branchId: null },
          { code: "inventory.products.manage", branchId: null },
          { code: "inventory.warehouses.manage", branchId: null },
          { code: "inventory.stock.read", branchId: null },
          { code: "inventory.stock.manage", branchId: null },
          { code: "inventory.documents.read", branchId: null },
          { code: "inventory.documents.manage", branchId: null },
        ],
      };

      // ---- Prasyarat master ----
      const [br] = await tx
        .insert(branches)
        .values({ code: "BR-BS", name: "Cabang Batch/Serial", isActive: true, createdBy: u.id, updatedBy: u.id })
        .returning({ id: branches.id });
      if (!br) throw new Error("Gagal membuat cabang uji.");
      const branchId = br.id;

      const wh = await createWarehouse(actor, { code: "GUD-BS", name: "Gudang BS", branchId }, tx);
      const unit = await createUnit(actor, { code: "PCEBS", name: "Pieces BS", symbol: "pc" }, tx);

      const pos = async (productId: string, warehouseId: string) =>
        (await getStockPosition(actor, { productId, warehouseId }, tx))[0];

      // Terima + post satu dokumen GR sekali jalan (helper).
      const gr = async (
        productId: string,
        date: string,
        line: {
          quantity: string;
          unitCost: string;
          batchNo?: string;
          batchExpiryDate?: string;
          serialNumbers?: string[];
        },
      ) => {
        const doc = await createStockDocument(
          actor,
          { type: "receipt", documentDate: date, branchId, toWarehouseId: wh.id, lines: [{ productId, ...line }] },
          tx,
        );
        return postStockDocument(actor, doc.id, tx);
      };
      const gi = async (
        productId: string,
        date: string,
        line: { quantity: string; batchNo?: string; batchId?: string; serialNumbers?: string[] },
      ) => {
        const doc = await createStockDocument(
          actor,
          { type: "issue", documentDate: date, branchId, fromWarehouseId: wh.id, lines: [{ productId, ...line }] },
          tx,
        );
        return postStockDocument(actor, doc.id, tx);
      };

      /* ======================= Produk BATCH + expiry ======================= */
      const P = await createProduct(
        actor,
        { sku: "BS-P", name: "Produk Batch", baseUnitId: unit.id, tracking: "batch", needsExpiry: true },
        tx,
      );

      // needsExpiry: GR tanpa tanggal expiry -> VALIDATION_FAILED (kaidah bentuk saat create).
      await expectError("batch butuh expiry tanpa tanggal", tx, "VALIDATION_FAILED", () =>
        createStockDocument(
          actor,
          { type: "receipt", documentDate: "2026-03-01", branchId, toWarehouseId: wh.id, lines: [{ productId: P.id, quantity: "1", unitCost: "10", batchNo: "X" }] },
          tx,
        ),
      );

      // Terima batch yang SUDAH kedaluwarsa terhadap tanggal dokumen -> BUSINESS_RULE.
      await expectError("GR batch sudah expired", tx, "BUSINESS_RULE", () =>
        gr(P.id, "2026-03-01", { quantity: "5", unitCost: "100", batchNo: "B-Z", batchExpiryDate: "2026-02-01" }),
      );

      // Dua batch valid: B-EARLY (exp 2026-03-20) & B-LATE (exp 2026-06-30).
      await gr(P.id, "2026-03-01", { quantity: "5", unitCost: "100", batchNo: "B-EARLY", batchExpiryDate: "2026-03-20" });
      await gr(P.id, "2026-03-01", { quantity: "5", unitCost: "200", batchNo: "B-LATE", batchExpiryDate: "2026-06-30" });
      const batchRows = await tx
        .select({ id: stockBatches.id, batchNo: stockBatches.batchNo, expiryDate: stockBatches.expiryDate })
        .from(stockBatches)
        .where(eq(stockBatches.productId, P.id));
      assert("batch: 2 batch terlahir inline dengan expiry", batchRows.length === 2 && batchRows.every((b) => !!b.expiryDate));
      let pPos = await pos(P.id, wh.id);
      assert("batch: onHand 10.000 val 1500.00", pPos?.onHand === "10.000" && pPos?.valuation === "1500.00");

      // FEFO normal (05-03, dua-duanya valid): konsumsi expiry paling dulu (B-EARLY).
      await gi(P.id, "2026-03-05", { quantity: "2" });
      pPos = await pos(P.id, wh.id);
      assert("FEFO normal: onHand 8.000 val 1300.00 (B-EARLY -2)", pPos?.onHand === "8.000" && pPos?.valuation === "1300.00");

      // Skip-expired (01-04, B-EARLY sudah lewat): mesin melewati B-EARLY, konsumsi B-LATE.
      await gi(P.id, "2026-04-01", { quantity: "2" });
      pPos = await pos(P.id, wh.id);
      assert("skip-expired: onHand 6.000 val 900.00 (B-LATE -2, B-EARLY utuh)", pPos?.onHand === "6.000" && pPos?.valuation === "900.00");

      // Ekspor eksplisit batch expired -> BUSINESS_RULE.
      await expectError("issue eksplisit batch expired", tx, "BUSINESS_RULE", () =>
        gi(P.id, "2026-04-01", { quantity: "1", batchNo: "B-EARLY" }),
      );

      // Opname per batch: hanya menghitung B-LATE (valid) turun ke 2 (loss 1).
      // B-EARLY tidak dihitung ulang karena sudah expired terhadap tanggal dokumen
      // (keputusan "blokir expired saat post": dokumen non-masuk tak boleh menyebut batch expired).
      const opDoc = await createStockDocument(
        actor,
        {
          type: "opname",
          documentDate: "2026-04-01",
          branchId,
          fromWarehouseId: wh.id,
          lines: [{ productId: P.id, quantity: "2", batchNo: "B-LATE" }],
        },
        tx,
      );
      await postStockDocument(actor, opDoc.id, tx);
      pPos = await pos(P.id, wh.id);
      assert("opname per batch: onHand 5.000 val 700.00", pPos?.onHand === "5.000" && pPos?.valuation === "700.00");

      // Guard ubah tracking setelah produk punya pergerakan -> BUSINESS_RULE.
      await expectError("ubah tracking setelah ada pergerakan", tx, "BUSINESS_RULE", () =>
        updateProduct(actor, P.id, { tracking: "none" }, tx),
      );

      /* ================== Produk BATCH untuk reversal expired ================= */
      const Q = await createProduct(
        actor,
        { sku: "BS-Q", name: "Produk Reverse", baseUnitId: unit.id, tracking: "batch", needsExpiry: true },
        tx,
      );
      const grQ = await gr(Q.id, "2026-03-01", { quantity: "4", unitCost: "150", batchNo: "R-EXP", batchExpiryDate: "2026-03-10" });
      assert("Q: onHand 4.000", (await pos(Q.id, wh.id))?.onHand === "4.000");
      // Reverse pada 01-04 saat batch sudah expired: bypass expiry => konsumsi layer expired sukses.
      const revQ = await reverseStockDocument(actor, grQ.id, { reason: "koreksi batch expired", documentDate: "2026-04-01" }, tx);
      assert("reverse batch expired (bypass): status reversed & onHand 0.000", revQ.status === "reversed" && (await pos(Q.id, wh.id))?.onHand === "0.000");

      /* ========================= Produk SERIAL ========================= */
      const S = await createProduct(
        actor,
        { sku: "BS-S", name: "Produk Serial", baseUnitId: unit.id, tracking: "serial" },
        tx,
      );
      // qty baris != jumlah serial -> VALIDATION_FAILED (saat create).
      await expectError("serial qty tidak sama dengan daftar", tx, "VALIDATION_FAILED", () =>
        createStockDocument(
          actor,
          { type: "receipt", documentDate: "2026-03-01", branchId, toWarehouseId: wh.id, lines: [{ productId: S.id, quantity: "3", unitCost: "50", serialNumbers: ["S-010"] }] },
          tx,
        ),
      );
      // Terima 2 unit -> terdaftar in_stock.
      await gr(S.id, "2026-03-01", { quantity: "2", unitCost: "50", serialNumbers: ["S-001", "S-002"] });
      const sRows = await tx
        .select({ serialNo: stockSerials.serialNo, status: stockSerials.status, warehouseId: stockSerials.warehouseId })
        .from(stockSerials)
        .where(eq(stockSerials.productId, S.id));
      assert(
        "serial GR: 2 unit in_stock di gudang",
        sRows.length === 2 && sRows.every((r) => r.status === "in_stock" && r.warehouseId === wh.id),
      );
      // Keluarkan S-001 -> issued.
      await gi(S.id, "2026-03-02", { quantity: "1", serialNumbers: ["S-001"] });
      const [s1now] = await tx
        .select({ status: stockSerials.status })
        .from(stockSerials)
        .where(and(eq(stockSerials.productId, S.id), eq(stockSerials.serialNo, "S-001")));
      assert("serial issue: S-001 issued", s1now?.status === "issued");

      // Keluarkan ulang S-001 (sudah issued) -> BUSINESS_RULE.
      await expectError("serial issue ulang unit issued", tx, "BUSINESS_RULE", () =>
        gi(S.id, "2026-03-02", { quantity: "1", serialNumbers: ["S-001"] }),
      );
      // Terima nomor serial yang sudah terdaftar -> VALIDATION_FAILED.
      await expectError("serial duplikat saat GR", tx, "VALIDATION_FAILED", () =>
        gr(S.id, "2026-03-02", { quantity: "1", unitCost: "50", serialNumbers: ["S-002"] }),
      );

      /* ==================== Produk TANPA tracking (none) ==================== */
      const N = await createProduct(actor, { sku: "BS-N", name: "Produk Plain", baseUnitId: unit.id }, tx);
      await expectError("produk none tolak input batch", tx, "VALIDATION_FAILED", () =>
        createStockDocument(
          actor,
          { type: "receipt", documentDate: "2026-03-01", branchId, toWarehouseId: wh.id, lines: [{ productId: N.id, quantity: "1", unitCost: "10", batchNo: "NOPE" }] },
          tx,
        ),
      );

      /* ==================== Guard cancel draf batch ==================== */
      const draft = await createStockDocument(
        actor,
        { type: "receipt", documentDate: "2026-05-01", branchId, toWarehouseId: wh.id, lines: [{ productId: P.id, quantity: "1", unitCost: "10", batchNo: "B-NEW", batchExpiryDate: "2026-12-31" }] },
        tx,
      );
      const cancelled = await cancelStockDocument(actor, draft.id, { reason: "batal uji batch" }, tx);
      assert("cancel draf batch: status cancelled", cancelled.status === "cancelled");

      console.log(`\n[test-batch-serial] semua jalur lolos sebelum rollback — ${passed} asersi PASS.`);

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-batch-serial] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-batch-serial] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
