import { eq, sql } from "drizzle-orm";

import { branches, stockDocumentLines, stockDocuments, users } from "@/db/schema";
import { createProduct } from "@/modules/inventory/product-service";
import { getStockPosition } from "@/modules/inventory/stock-service";
import {
  cancelStockDocument,
  createStockDocument,
  getStockDocument,
  listStockDocuments,
  postStockDocument,
  reverseStockDocument,
} from "@/modules/inventory/document-service";
import { createUnit } from "@/modules/inventory/unit-service";
import { createWarehouse, createWarehouseLocation } from "@/modules/inventory/warehouse-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 5D (dokumen stok: receipt/issue/transfer/
 * adjustment/opname, state machine draf->posted->cancel/reverse + guard).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`,
 * sehingga TIDAK ADA data tersimpan. BUTUH tabel & trigger 5D (migrasi 0016).
 * Cabang disisipkan langsung (createBranch tak menerima externalTx).
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
          { code: "inventory.documents.read", branchId: null },
          { code: "inventory.documents.manage", branchId: null },
        ],
      };

      // ---- Prasyarat master ----
      const [br] = await tx
        .insert(branches)
        .values({ code: "BR-DOC", name: "Cabang Dokumen", isActive: true, createdBy: u.id, updatedBy: u.id })
        .returning({ id: branches.id });
      if (!br) throw new Error("Gagal membuat cabang uji.");
      const branchId = br.id;

      const wh = await createWarehouse(actor, { code: "GUD-DOC", name: "Gudang Doc", branchId }, tx);
      const wh2 = await createWarehouse(actor, { code: "GUD-DOC2", name: "Gudang Doc 2", branchId }, tx);
      const unit = await createUnit(actor, { code: "PCE", name: "Pieces Doc", symbol: "pc" }, tx);
      const mk = (sku: string) => createProduct(actor, { sku, name: `Barang ${sku}`, baseUnitId: unit.id }, tx);
      const A = await mk("DOC-A");
      const B = await mk("DOC-B");
      const C = await mk("DOC-C");
      const D = await mk("DOC-D");
      const E = await mk("DOC-E");
      const locA1 = await createWarehouseLocation(actor, { warehouseId: wh.id, code: "A1", name: "Rak A1" }, tx);
      const locB1 = await createWarehouseLocation(actor, { warehouseId: wh2.id, code: "B1", name: "Rak B1" }, tx);

      const pos = async (productId: string, warehouseId: string) =>
        (await getStockPosition(actor, { productId, warehouseId }, tx))[0];

      // -------------------------- Receipt ---------------------------------
      const grA = await postStockDocument(
        actor,
        (await createStockDocument(
          actor,
          { type: "receipt", documentDate: "2026-02-01", branchId, toWarehouseId: wh.id, lines: [{ productId: A.id, quantity: "10", unitCost: "1000" }] },
          tx,
        )).id,
        tx,
      );
      assert("GR: status posted & nomor GR-", grA.status === "posted" && !!grA.docNo?.startsWith("GR-"));
      let pA = await pos(A.id, wh.id);
      assert("GR: A onHand 10.000 valuasi 10000.00", pA?.onHand === "10.000" && pA?.valuation === "10000.00");

      await postStockDocument(
        actor,
        (await createStockDocument(
          actor,
          { type: "receipt", documentDate: "2026-02-01", branchId, toWarehouseId: wh.id, lines: [{ productId: C.id, quantity: "5", unitCost: "100" }, { productId: D.id, quantity: "5", unitCost: "500" }, { productId: B.id, quantity: "5", unitCost: "2000" }] },
          tx,
        )).id,
        tx,
      );

      // --------------------------- Issue (FIFO) ----------------------------
      const giA = await postStockDocument(
        actor,
        (await createStockDocument(
          actor,
          { type: "issue", documentDate: "2026-02-02", branchId, fromWarehouseId: wh.id, lines: [{ productId: A.id, quantity: "4" }] },
          tx,
        )).id,
        tx,
      );
      assert("GI: nomor GI- & A onHand 6.000", !!giA.docNo?.startsWith("GI-") && (await pos(A.id, wh.id))?.onHand === "6.000");

      // Keluar melebihi stok -> guard stok negatif via jalur dokumen.
      const giNeg = await createStockDocument(
        actor,
        { type: "issue", documentDate: "2026-02-02", branchId, fromWarehouseId: wh.id, lines: [{ productId: A.id, quantity: "999" }] },
        tx,
      );
      await expectError("issue melebihi stok -> stok negatif ditolak", tx, "BUSINESS_RULE", () =>
        postStockDocument(actor, giNeg.id, tx),
      );

      // --------------------------- Transfer --------------------------------
      const trB = await postStockDocument(
        actor,
        (await createStockDocument(
          actor,
          { type: "transfer", documentDate: "2026-02-03", branchId, fromWarehouseId: wh.id, toWarehouseId: wh2.id, lines: [{ productId: B.id, quantity: "2", toLocationId: locB1.id }] },
          tx,
        )).id,
        tx,
      );
      const pB2 = await pos(B.id, wh2.id);
      assert("TR: nomor TR- & B tujuan onHand 2.000 valuasi 4000.00", !!trB.docNo?.startsWith("TR-") && pB2?.onHand === "2.000" && pB2?.valuation === "4000.00");
      assert("TR: B asal tersisa 3.000", (await pos(B.id, wh.id))?.onHand === "3.000");

      // -------------------------- Adjustment -------------------------------
      const adjA = await postStockDocument(
        actor,
        (await createStockDocument(
          actor,
          { type: "adjustment", documentDate: "2026-02-04", branchId, fromWarehouseId: wh.id, lines: [{ productId: A.id, quantity: "1", direction: "in", unitCost: "3000", fromLocationId: locA1.id }] },
          tx,
        )).id,
        tx,
      );
      assert("ADJ: nomor ADJ- & A onHand 7.000", !!adjA.docNo?.startsWith("ADJ-") && (await pos(A.id, wh.id))?.onHand === "7.000");

      // --------------------------- Opname (gain + loss) --------------------
      // A: onHand 7 -> counted 9 (selisih lebih +2 dinilai biaya lapisan terbaru 3000)
      // C: onHand 5 -> counted 3 (selisih kurang -2 keluar FIFO)
      const op = await postStockDocument(
        actor,
        (await createStockDocument(
          actor,
          { type: "opname", documentDate: "2026-02-05", branchId, fromWarehouseId: wh.id, lines: [{ productId: A.id, quantity: "9" }, { productId: C.id, quantity: "3" }] },
          tx,
        )).id,
        tx,
      );
      pA = await pos(A.id, wh.id);
      const pC = await pos(C.id, wh.id);
      assert("OP: nomor OP- & A onHand 9.000 valuasi 15000.00", !!op.docNo?.startsWith("OP-") && pA?.onHand === "9.000" && pA?.valuation === "15000.00");
      assert("OP: C onHand 3.000 valuasi 300.00", pC?.onHand === "3.000" && pC?.valuation === "300.00");

      // -------------------------- Cancel draf ------------------------------
      const draftE = await createStockDocument(
        actor,
        { type: "receipt", documentDate: "2026-02-06", branchId, toWarehouseId: wh.id, lines: [{ productId: E.id, quantity: "1", unitCost: "10" }] },
        tx,
      );
      assert("Cancel: draf dibuat status draft", draftE.status === "draft");
      const cancelled = await cancelStockDocument(actor, draftE.id, { reason: "batal uji" }, tx);
      assert("Cancel: status cancelled & E tak bergerak", cancelled.status === "cancelled" && (await pos(E.id, wh.id)) === undefined);
      await expectError("post dokumen cancelled", tx, "BUSINESS_RULE", () => postStockDocument(actor, draftE.id, tx));

      // -------------------------- Reverse ----------------------------------
      const grD = await postStockDocument(
        actor,
        (await createStockDocument(
          actor,
          { type: "receipt", documentDate: "2026-02-06", branchId, toWarehouseId: wh.id, lines: [{ productId: D.id, quantity: "3", unitCost: "500" }] },
          tx,
        )).id,
        tx,
      );
      assert("sebelum reverse D onHand 8.000 (5+3)", (await pos(D.id, wh.id))?.onHand === "8.000");
      const reversed = await reverseStockDocument(actor, grD.id, { reason: "salah input" }, tx);
      assert("Reverse: status reversed & D onHand 5.000", reversed.status === "reversed" && (await pos(D.id, wh.id))?.onHand === "5.000");
      await expectError("reverse dokumen sudah reversed", tx, "BUSINESS_RULE", () => reverseStockDocument(actor, grD.id, { reason: "dua kali" }, tx));

      // --------------------- Guard imutabilitas dokumen --------------------
      await expectThrows("posted doc tak boleh ubah type", tx, "non-draf", () =>
        tx.update(stockDocuments).set({ type: "issue" }).where(eq(stockDocuments.id, grA.id)),
      );
      await expectThrows("baris doc posted tak boleh dihapus", tx, "non-draf", () =>
        tx.delete(stockDocumentLines).where(eq(stockDocumentLines.documentId, grA.id)),
      );

      // ------------------------ Validasi bentuk ----------------------------
      await expectError("receipt tanpa biaya satuan", tx, "VALIDATION_FAILED", () =>
        createStockDocument(actor, { type: "receipt", documentDate: "2026-02-07", branchId, toWarehouseId: wh.id, lines: [{ productId: A.id, quantity: "1" }] }, tx),
      );
      await expectError("transfer gudang sama", tx, "VALIDATION_FAILED", () =>
        createStockDocument(actor, { type: "transfer", documentDate: "2026-02-07", branchId, fromWarehouseId: wh.id, toWarehouseId: wh.id, lines: [{ productId: A.id, quantity: "1" }] }, tx),
      );
      await expectError("lokasi bukan milik gudang (issue)", tx, "BUSINESS_RULE", () =>
        createStockDocument(actor, { type: "issue", documentDate: "2026-02-07", branchId, fromWarehouseId: wh.id, lines: [{ productId: A.id, quantity: "1", fromLocationId: locB1.id }] }, tx),
      );

      // --------------------------- Baca & izin -----------------------------
      const doc = await getStockDocument(actor, grA.id, tx);
      assert("get dokumen: header + lines (1 baris)", doc.id === grA.id && doc.lines.length === 1);
      const receipts = await listStockDocuments(actor, { type: "receipt", status: "posted" }, tx);
      // Receipt posted = GR-A + GR-multi(C/D/B); GR-D sudah reversed & GR-E masih draf,
      // jadi keduanya TIDAK boleh muncul. Filter type+status harus tegas.
      assert(
        "list filter receipt+posted >= 2 & semua cocok",
        receipts.length >= 2 && receipts.every((d) => d.type === "receipt" && d.status === "posted"),
      );
      assert(
        "list receipt+posted mengecualikan reversed (GR-D absent)",
        !receipts.some((d) => d.id === grD.id),
      );
      await expectError("get dokumen tak ada", tx, "NOT_FOUND", () => getStockDocument(actor, fake, tx));
      await expectError("tanpa izin manage dokumen", tx, "FORBIDDEN", () =>
        createStockDocument({ ...actor, grants: [] }, { type: "issue", documentDate: "2026-02-08", branchId, fromWarehouseId: wh.id, lines: [{ productId: A.id, quantity: "1" }] }, tx),
      );
      await expectError("tanpa izin read dokumen", tx, "FORBIDDEN", () => listStockDocuments({ ...actor, grants: [] }, {}, tx));

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-documents] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-documents] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
