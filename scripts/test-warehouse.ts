import { eq, sql } from "drizzle-orm";

import { branches, users } from "@/db/schema";
import {
  createWarehouse,
  createWarehouseLocation,
  getWarehouse,
  getWarehouseLocation,
  listWarehouseLocations,
  listWarehouses,
  updateWarehouse,
  updateWarehouseLocation,
} from "@/modules/inventory/warehouse-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 5B (gudang & lokasi).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data tersimpan. BUTUH tabel 5B (migrasi 0014).
 * Cabang disisipkan langsung (bukan via createBranch) agar ikut ter-rollback.
 * Izin inventory.warehouses.* diberikan eksplisit ke actor.
 *
 * Cakupan: guard kode gudang duplikat, cabang tak ada/nonaktif, join cabang,
 * lokasi unik-per-gudang (kode sama di gudang beda boleh), gudang tak ada/nonaktif,
 * blok nonaktif-gudang-punya-lokasi-aktif, pindah cabang ke nonaktif, lokasi boleh
 * dinonaktifkan lalu gudang ikut nonaktif, update tanpa perubahan, filter daftar,
 * dan penegakan izin.
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
          { code: "inventory.warehouses.read", branchId: null },
          { code: "inventory.warehouses.manage", branchId: null },
        ],
      };

      const addBranch = async (code: string, name: string, isActive = true) => {
        const [row] = await tx
          .insert(branches)
          .values({ code, name, isActive, createdBy: u.id, updatedBy: u.id })
          .returning({ id: branches.id });
        if (!row) throw new Error(`Gagal menyisipkan cabang ${code}.`);
        return row.id;
      };

      const brA = await addBranch("BR-WHA", "Cabang Uji A");
      const brB = await addBranch("BR-WHB", "Cabang Uji B");

      // ------------------------------ Gudang -------------------------------
      const whA = await createWarehouse(
        actor,
        { code: "GUD-A", name: "Gudang Utama", branchId: brA },
        tx,
      );
      assert(
        "gudang dibuat dengan join cabang",
        whA.branchCode === "BR-WHA" && whA.isActive === true,
      );

      await expectError("duplikat kode gudang", tx, "CONFLICT", () =>
        createWarehouse(actor, { code: "GUD-A", name: "Lain", branchId: brA }, tx),
      );
      await expectError("cabang gudang tidak ada", tx, "VALIDATION_FAILED", () =>
        createWarehouse(actor, { code: "GUD-X", name: "X", branchId: fake }, tx),
      );

      // Cabang B dinonaktifkan -> tidak boleh dipakai gudang baru.
      await tx.update(branches).set({ isActive: false }).where(eq(branches.id, brB));
      await expectError("cabang gudang tidak aktif", tx, "BUSINESS_RULE", () =>
        createWarehouse(actor, { code: "GUD-B", name: "Cabang B", branchId: brB }, tx),
      );

      // ------------------------------ Lokasi -------------------------------
      const loc1 = await createWarehouseLocation(
        actor,
        { warehouseId: whA.id, code: "RAK-01", name: "Raki 01" },
        tx,
      );
      assert(
        "lokasi dibuat dengan join gudang",
        loc1.warehouseCode === "GUD-A" && loc1.isActive === true,
      );
      await expectError("duplikat kode lokasi dalam gudang sama", tx, "CONFLICT", () =>
        createWarehouseLocation(actor, { warehouseId: whA.id, code: "RAK-01", name: "Lain" }, tx),
      );

      // Gudang kedua (cabang sama) boleh memakai kode lokasi yang sama.
      const whC = await createWarehouse(
        actor,
        { code: "GUD-C", name: "Gudang Cabang", branchId: brA },
        tx,
      );
      const locC = await createWarehouseLocation(
        actor,
        { warehouseId: whC.id, code: "RAK-01", name: "Raki Gudang C" },
        tx,
      );
      assert("kode lokasi unik per gudang (boleh sama di gudang beda)", locC.warehouseCode === "GUD-C");

      await expectError("lokasi di gudang tidak ada", tx, "VALIDATION_FAILED", () =>
        createWarehouseLocation(actor, { warehouseId: fake, code: "Z01", name: "Z" }, tx),
      );

      // ----------------------- Guard nonaktif & pindah ---------------------
      await expectError("nonaktif gudang masih punya lokasi aktif", tx, "CONFLICT", () =>
        updateWarehouse(actor, whA.id, { isActive: false }, tx),
      );
      await expectError("pindah gudang ke cabang nonaktif", tx, "BUSINESS_RULE", () =>
        updateWarehouse(actor, whA.id, { branchId: brB }, tx),
      );

      const whUpd = await updateWarehouse(actor, whA.id, { name: "Gudang Utama Baru" }, tx);
      assert("update nama gudang (kode tetap)", whUpd.name === "Gudang Utama Baru" && whUpd.code === "GUD-A");
      const whSame = await updateWarehouse(actor, whA.id, { name: "Gudang Utama Baru" }, tx);
      assert("update gudang tanpa perubahan tidak menyentuh updatedAt", whSame.updatedAt.getTime() === whUpd.updatedAt.getTime());

      // Nonaktifkan lokasi, lalu gudang boleh dinonaktifkan.
      const locOff = await updateWarehouseLocation(actor, loc1.id, { isActive: false }, tx);
      assert("lokasi dapat dinonaktifkan", locOff.isActive === false);
      const whOff = await updateWarehouse(actor, whA.id, { isActive: false }, tx);
      assert("gudang nonaktif setelah lokasi tak aktif", whOff.isActive === false);

      // Gudang nonaktif menolak lokasi baru.
      await expectError("lokasi di gudang nonaktif", tx, "BUSINESS_RULE", () =>
        createWarehouseLocation(actor, { warehouseId: whA.id, code: "RAK-02", name: "Raki 02" }, tx),
      );

      // --------------------------- Baca & izin -----------------------------
      const whs = await listWarehouses(actor, {}, tx);
      assert("daftar gudang berisi kedua gudang", whs.some((w) => w.code === "GUD-A") && whs.some((w) => w.code === "GUD-C"));
      const whActive = await listWarehouses(actor, { isActive: true }, tx);
      assert("filter gudang aktif excludes GUD-A nonaktif", !whActive.some((w) => w.code === "GUD-A"));
      const locs = await listWarehouseLocations(actor, { warehouseId: whC.id }, tx);
      assert("daftar lokasi per gudang", locs.length === 1 && locs[0]?.code === "RAK-01");
      assert("get warehouse", (await getWarehouse(actor, whC.id, tx)).id === whC.id);
      assert("get location", (await getWarehouseLocation(actor, locC.id, tx)).id === locC.id);
      await expectError("gudang tidak ada", tx, "NOT_FOUND", () => getWarehouse(actor, fake, tx));
      await expectError("lokasi tidak ada", tx, "NOT_FOUND", () => getWarehouseLocation(actor, fake, tx));
      await expectError("tanpa izin read gudang", tx, "FORBIDDEN", () =>
        listWarehouses({ ...actor, grants: [] }, {}, tx),
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(
      `[test-warehouse] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`,
    );
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-warehouse] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
