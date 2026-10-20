import { sql } from "drizzle-orm";

import { users } from "@/db/schema";
import {
  createProductCategory,
  listProductCategories,
  updateProductCategory,
} from "@/modules/inventory/category-service";
import {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "@/modules/inventory/product-service";
import {
  createUnit,
  createUnitConversion,
  listUnits,
  updateUnit,
} from "@/modules/inventory/unit-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 5A (master persediaan: kategori, satuan,
 * konversi satuan, produk).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data tersimpan. BUTUH tabel 5A (migrasi 0013).
 * Izin inventory.* diberikan eksplisit ke actor agar tidak bergantung pada seed.
 *
 * Cakupan: guard kode/SKU duplikat, hierarki kategori (diri sendiri, siklus,
 * induk tak ada/aktif), blok nonaktif_when_masak_pakai, konversi satuan
 * (pasangan unik, satuan tak ada/nonaktif), produk (kategori+satuan tervalidasi),
 * SKU imutabel, update tanpa perubahan, filter daftar, dan penegakan izin.
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
          { code: "inventory.product_categories.read", branchId: null },
          { code: "inventory.product_categories.manage", branchId: null },
          { code: "inventory.units.read", branchId: null },
          { code: "inventory.units.manage", branchId: null },
          { code: "inventory.products.read", branchId: null },
          { code: "inventory.products.manage", branchId: null },
        ],
      };

      // ------------------------------ Kategori ------------------------------
      const root = await createProductCategory(actor, { code: "ELK", name: "Elektronik" }, tx);
      assert("kategori root dibuat", root.code === "ELK" && root.parentId === null);

      await expectError("duplikat kode kategori", tx, "CONFLICT", () =>
        createProductCategory(actor, { code: "ELK", name: "Lain" }, tx),
      );

      const child = await createProductCategory(
        actor,
        { code: "ELK-TV", name: "Televisi", parentId: root.id },
        tx,
      );
      assert("kategori anak", child.parentId === root.id);

      await expectError("induk kategori tidak ada", tx, "VALIDATION_FAILED", () =>
        createProductCategory(actor, { code: "XYZ", name: "Anak X", parentId: fake }, tx),
      );
      await expectError("induk = diri sendiri", tx, "BUSINESS_RULE", () =>
        updateProductCategory(actor, root.id, { parentId: root.id }, tx),
      );
      await expectError("siklus hierarki", tx, "BUSINESS_RULE", () =>
        updateProductCategory(actor, root.id, { parentId: child.id }, tx),
      );
      await expectError("nonaktif induk ber-anak aktif", tx, "CONFLICT", () =>
        updateProductCategory(actor, root.id, { isActive: false }, tx),
      );

      // ------------------------------ Satuan --------------------------------
      const pcs = await createUnit(actor, { code: "PCS", name: "Pieces", symbol: "pcs" }, tx);
      assert("satuan pcs dibuat", pcs.code === "PCS");
      await expectError("duplikat kode satuan", tx, "CONFLICT", () =>
        createUnit(actor, { code: "PCS", name: "Lain" }, tx),
      );
      const box = await createUnit(actor, { code: "BOX", name: "Box", symbol: "box" }, tx);
      const kg = await createUnit(actor, { code: "KG", name: "Kilogram", symbol: "kg" }, tx);

      // ----------------------------- Konversi -------------------------------
      const conv = await createUnitConversion(
        actor,
        { fromUnitId: box.id, toUnitId: pcs.id, ratio: "12.000000", note: "1 dos = 12 pcs" },
        tx,
      );
      assert(
        "konversi box->pcs tersimpan dengan join satuan",
        conv.fromUnitCode === "BOX" && conv.toUnitCode === "PCS" && conv.ratio === "12.000000",
      );
      await expectError("duplikat pasangan konversi", tx, "CONFLICT", () =>
        createUnitConversion(actor, { fromUnitId: box.id, toUnitId: pcs.id, ratio: "10" }, tx),
      );
      await expectError("satuan asal konversi tidak ada", tx, "VALIDATION_FAILED", () =>
        createUnitConversion(actor, { fromUnitId: fake, toUnitId: pcs.id, ratio: "5" }, tx),
      );
      await expectError("nonaktif satuan masih dipakai konversi", tx, "CONFLICT", () =>
        updateUnit(actor, box.id, { isActive: false }, tx),
      );

      // ------------------------------ Produk --------------------------------
      const prod = await createProduct(
        actor,
        { sku: "TV-32", name: "Televisi 32 inch", categoryId: child.id, baseUnitId: pcs.id },
        tx,
      );
      assert(
        "produk dibuat dengan join kategori+satuan",
        prod.categoryName === "Televisi" && prod.baseUnitCode === "PCS",
      );
      await expectError("duplikat SKU", tx, "CONFLICT", () =>
        createProduct(actor, { sku: "TV-32", name: "Lain", baseUnitId: pcs.id }, tx),
      );
      await expectError("kategori produk tidak ada", tx, "VALIDATION_FAILED", () =>
        createProduct(actor, { sku: "SPRY", name: "Semprot", categoryId: fake, baseUnitId: pcs.id }, tx),
      );
      await expectError("satuan produk tidak ada", tx, "VALIDATION_FAILED", () =>
        createProduct(actor, { sku: "SPRY", name: "Semprot", baseUnitId: fake }, tx),
      );
      await expectError("nonaktif kategori dipakai produk", tx, "CONFLICT", () =>
        updateProductCategory(actor, child.id, { isActive: false }, tx),
      );
      await expectError("nonaktif satuan dipakai produk", tx, "CONFLICT", () =>
        updateUnit(actor, pcs.id, { isActive: false }, tx),
      );

      const prodUpd = await updateProduct(actor, prod.id, { name: "Televisi 43 inch" }, tx);
      assert("update nama produk (SKU imutabel)", prodUpd.name === "Televisi 43 inch" && prodUpd.sku === "TV-32");
      const same = await updateProduct(actor, prod.id, { name: "Televisi 43 inch" }, tx);
      assert("update tanpa perubahan tidak menyentuh updatedAt", same.updatedAt.getTime() === prodUpd.updatedAt.getTime());

      // Kategori nonaktif tidak boleh dipakai produk baru.
      const tmpCat = await createProductCategory(actor, { code: "TMP", name: "Sementara" }, tx);
      await updateProductCategory(actor, tmpCat.id, { isActive: false }, tx);
      await expectError("kategori nonaktif untuk produk baru", tx, "CONFLICT", () =>
        createProduct(actor, { sku: "OFFL", name: "Off Line", categoryId: tmpCat.id, baseUnitId: kg.id }, tx),
      );

      // Satuan nonaktif tidak boleh dipakai produk baru.
      const tmpUnit = await createUnit(actor, { code: "LTR", name: "Liter", symbol: "l" }, tx);
      await updateUnit(actor, tmpUnit.id, { isActive: false }, tx);
      await expectError("satuan nonaktif untuk produk baru", tx, "BUSINESS_RULE", () =>
        createProduct(actor, { sku: "OIL", name: "Minyak", baseUnitId: tmpUnit.id }, tx),
      );

      // --------------------------- Baca & izin ------------------------------
      const cats = await listProductCategories(actor, {}, tx);
      assert("daftar kategori berisi root", cats.some((c) => c.code === "ELK"));
      const units = await listUnits(actor, { isActive: true }, tx);
      assert("daftar satuan aktif berisi pcs", units.some((un) => un.code === "PCS"));
      const prods = await listProducts(actor, { search: "Televisi" }, tx);
      assert("cari produk berdasarkan nama", prods.some((p) => p.sku === "TV-32"));
      const got = await getProduct(actor, prod.id, tx);
      assert("get product", got.id === prod.id);
      await expectError("produk tidak ada", tx, "NOT_FOUND", () => getProduct(actor, fake, tx));
      await expectError("tanpa izin read produk", tx, "FORBIDDEN", () =>
        listProducts({ ...actor, grants: [] }, {}, tx),
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(
      `[test-inventory] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`,
    );
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-inventory] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
