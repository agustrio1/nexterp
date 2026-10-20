import { eq, sql } from "drizzle-orm";

import { branches, stockMovements, users } from "@/db/schema";
import {
  createProduct,
  updateProduct,
} from "@/modules/inventory/product-service";
import {
  getStockPosition,
  listStockMovements,
  postStockMovement,
} from "@/modules/inventory/stock-service";
import { createUnit } from "@/modules/inventory/unit-service";
import {
  createWarehouse,
  createWarehouseLocation,
  updateWarehouse,
} from "@/modules/inventory/warehouse-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 5C (stock ledger + biaya FIFO, mesin).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data tersimpan. BUTUH tabel 5C (migrasi 0015).
 * Cabang disisipkan langsung (bukan via createBranch) agar ikut ter-rollback.
 *
 * Cakupan: FIFO multi-lapis (konsumsi terlama + biaya tertimbang), posisi stok &
 * valuasi, guard stok negatif ditolak, imutabilitas ledger (append-only), validasi
 * gudang/produk/lokasi (aktif, milik gudang), dan penegakan izin.
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

/**
 * Menyusun teks error dari rantai `cause` (drizzle membungkus error trigger
 * PostgreSQL sebagai QueryFailedError "Failed query:"; teks RAISE EXCEPTION
 * berada pada cause di bawahnya).
 */
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

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const fake = "00000000-0000-4000-8000-000000000000";

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
        ],
      };

      // ---- Prasyarat master ----
      const [br] = await tx
        .insert(branches)
        .values({ code: "BR-STK", name: "Cabang Stok", isActive: true, createdBy: u.id, updatedBy: u.id })
        .returning({ id: branches.id });
      if (!br) throw new Error("Gagal membuat cabang uji.");
      const branchId = br.id;

      const wh = await createWarehouse(actor, { code: "GUD-STK", name: "Gudang Stok", branchId }, tx);
      const wh2 = await createWarehouse(actor, { code: "GUD-STK2", name: "Gudang Dua", branchId }, tx);
      const wh3 = await createWarehouse(actor, { code: "GUD-STK3", name: "Gudang Tiga", branchId }, tx);

      const unit = await createUnit(actor, { code: "PCS", name: "Pieces", symbol: "pcs" }, tx);
      const product = await createProduct(
        actor,
        { sku: "STK-01", name: "Barang Uji", baseUnitId: unit.id },
        tx,
      );
      const loc1 = await createWarehouseLocation(actor, { warehouseId: wh.id, code: "A1", name: "Rak A1" }, tx);
      const loc2 = await createWarehouseLocation(actor, { warehouseId: wh2.id, code: "B1", name: "Rak B1" }, tx);

      const pos = async () => (await getStockPosition(actor, { productId: product.id, warehouseId: wh.id }, tx))[0];

      // ------------------------------ FIFO ---------------------------------
      const in1 = await postStockMovement(
        actor,
        { productId: product.id, warehouseId: wh.id, direction: "in", quantity: "10", unitCost: "1000", movementDate: "2026-01-01", sourceType: "opening" },
        tx,
      );
      assert("penerimaan #1 (10 @1000) tercatat", in1.direction === "in" && in1.unitCost === "1000.0000" && in1.totalCost === "10000.00");

      await postStockMovement(
        actor,
        { productId: product.id, warehouseId: wh.id, direction: "in", quantity: "5", unitCost: "1200", movementDate: "2026-01-02", sourceType: "goods_receipt" },
        tx,
      );

      const p1 = await pos();
      assert("posisi onHand 15.000 & valuasi 16000.00", p1?.onHand === "15.000" && p1?.valuation === "16000.00" && p1?.layerRemaining === "15.000");

      // Keluar 12 -> konsumsi FIFO: 10@1000 + 2@1200 = 12400; blended 1033.3333
      const out1 = await postStockMovement(
        actor,
        { productId: product.id, warehouseId: wh.id, direction: "out", quantity: "12", movementDate: "2026-01-03", sourceType: "goods_issue" },
        tx,
      );
      assert(
        "pengeluaran FIFO blended 1033.3333 & total 12400.00",
        out1.direction === "out" && out1.unitCost === "1033.3333" && out1.totalCost === "12400.00",
      );

      const p2 = await pos();
      assert("sisa onHand 3.000 (lapisan @1200) & valuasi 3600.00", p2?.onHand === "3.000" && p2?.valuation === "3600.00" && p2?.layerRemaining === "3.000");

      await expectError("keluar melebihi stok -> stok negatif ditolak", tx, "BUSINESS_RULE", () =>
        postStockMovement(
          actor,
          { productId: product.id, warehouseId: wh.id, direction: "out", quantity: "4", movementDate: "2026-01-04", sourceType: "goods_issue" },
          tx,
        ),
      );

      // --------------------- Imutabilitas ledger (append-only) --------------
      await expectThrows("ledger tidak dapat diUPDATE", tx, "append-only", () =>
        tx.update(stockMovements).set({ memo: "ubah" }).where(eq(stockMovements.id, in1.id)),
      );
      await expectThrows("ledger tidak dapat diDELETE", tx, "append-only", () =>
        tx.delete(stockMovements).where(eq(stockMovements.id, in1.id)),
      );

      // --------------------------- Validasi referensi -----------------------
      await expectError("gudang tidak ditemukan", tx, "VALIDATION_FAILED", () =>
        postStockMovement(
          actor,
          { productId: product.id, warehouseId: fake, direction: "in", quantity: "1", unitCost: "10", movementDate: "2026-01-05", sourceType: "goods_receipt" },
          tx,
        ),
      );
      await expectError("lokasi bukan milik gudang", tx, "BUSINESS_RULE", () =>
        postStockMovement(
          actor,
          { productId: product.id, warehouseId: wh.id, locationId: loc2.id, direction: "in", quantity: "1", unitCost: "10", movementDate: "2026-01-05", sourceType: "goods_receipt" },
          tx,
        ),
      );

      // Penerimaan valid dengan lokasi (biaya tetap per gudang).
      const inLoc = await postStockMovement(
        actor,
        { productId: product.id, warehouseId: wh.id, locationId: loc1.id, direction: "in", quantity: "2", unitCost: "500", movementDate: "2026-01-06", sourceType: "goods_receipt" },
        tx,
      );
      assert("penerimaan valid di lokasi dicatat", inLoc.locationCode === "A1");
      const p3 = await pos();
      assert("onHand bertambah jadi 5.000", p3?.onHand === "5.000");

      // gudang nonaktif menolak pergerakan; produk nonaktif menolak pergerakan.
      await updateWarehouse(actor, wh3.id, { isActive: false }, tx);
      await expectError("gudang nonaktif", tx, "BUSINESS_RULE", () =>
        postStockMovement(
          actor,
          { productId: product.id, warehouseId: wh3.id, direction: "in", quantity: "1", unitCost: "10", movementDate: "2026-01-07", sourceType: "goods_receipt" },
          tx,
        ),
      );
      const product2 = await createProduct(actor, { sku: "STK-02", name: "Barang Mati", baseUnitId: unit.id }, tx);
      await updateProduct(actor, product2.id, { isActive: false }, tx);
      await expectError("produk nonaktif", tx, "BUSINESS_RULE", () =>
        postStockMovement(
          actor,
          { productId: product2.id, warehouseId: wh.id, direction: "in", quantity: "1", unitCost: "10", movementDate: "2026-01-07", sourceType: "goods_receipt" },
          tx,
        ),
      );

      // ---------------------------- Jejak & izin ----------------------------
      const trail = await listStockMovements(actor, { productId: product.id }, tx);
      assert("jejak pergerakan = 4 baris", trail.length === 4);
      await expectError("tanpa izin manage stok", tx, "FORBIDDEN", () =>
        postStockMovement({ ...actor, grants: [] }, { productId: product.id, warehouseId: wh.id, direction: "in", quantity: "1", unitCost: "10", movementDate: "2026-01-08", sourceType: "goods_receipt" }, tx),
      );
      await expectError("tanpa izin read stok", tx, "FORBIDDEN", () => getStockPosition({ ...actor, grants: [] }, {}, tx));

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-stock] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-stock] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
