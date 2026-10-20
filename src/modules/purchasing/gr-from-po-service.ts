import { and, eq, inArray, sql } from "drizzle-orm";

import { purchaseOrderLines, purchaseOrders } from "@/db/schema";
import {
  createReceiptFromPoSchema,
  type CreateReceiptFromPoInput,
} from "@/modules/purchasing/schemas";
import { assertCan, assertReceivingWarehouse } from "@/modules/purchasing/_refs";
import { loadOpenPoLineQuantities } from "@/modules/purchasing/po-service";
import { resolveApAccountIds } from "@/modules/purchasing/ap-account-config";
import {
  createStockDocument,
  postStockDocument,
} from "@/modules/inventory/document-service";
import { createSystemDraft, postJournal } from "@/modules/accounting/journal-service";
import { cmp, mul, round, sum, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound, validationFailed } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const QTY_DP = 3;
const TOTAL_DP = 2;

/** sourceType jurnal GR/IR perpetual untuk penerimaan barang (5G). */
const SOURCE_RECEIPT = "purchase_receipt";

/** Kunci header PO (FOR UPDATE) dan pastikan status posted. */
async function lockPostedPo(tx: Tx, poId: string) {
  const [po] = await tx
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
      branchId: purchaseOrders.branchId,
      docNo: purchaseOrders.docNo,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .for("update")
    .limit(1);
  if (!po) throw notFound("Purchase order tidak ditemukan.");
  if (po.status !== "posted") {
    throw businessRule("Penerimaan hanya dapat dilakukan terhadap PO berstatus posted.");
  }
  return po;
}

/**
 * Menerima barang dari PO (Tahap 5F). Membuat dokumen penerimaan (receipt) pada
 * mesin stok 5D/5E — biaya lapisan = harga satuan dasar PO (baseAmount / qty) —
 * lalu memostingnya (stok naik, batch inline, serial terdaftar sesuai tracking),
 * kemudian menaikkan `quantityReceived` tiap baris PO. Over-receipt ditolak.
 *
 * 5F tidak menyentuh buku besar. Sejak 5G, penerimaan juga menerbitkan jurnal
 * GR/IR perpetual (Dr Inventory / Cr GR/IR) senilai biaya dasar, lewat mesin jurnal
 * yang sama (createSystemDraft + postJournal), sumber `purchase_receipt`/`post`.
 */
export async function createReceiptFromPo(
  actor: AuthContext,
  poId: string,
  input: CreateReceiptFromPoInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.receipts.manage");
  const parsed = createReceiptFromPoSchema.parse(input);

  const run = async (tx: Tx) => {
    const po = await lockPostedPo(tx, poId);
    await assertReceivingWarehouse(tx, parsed.warehouseId, po.branchId);

    // Baris PO milik PO ini + sisa qty (FOR UPDATE pada baris agar serialisasi penerimaan).
    const poLineIds = parsed.lines.map((l) => l.poLineId);
    const owned = await tx
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.poId, poId), inArray(purchaseOrderLines.id, [...new Set(poLineIds)])));
    const ownedIds = new Set(owned.map((r) => r.id));

    const open = await loadOpenPoLineQuantities(tx, poLineIds);

    const stockLines: {
      productId: string;
      quantity: string;
      unitCost: string;
      toLocationId?: string | null;
      batchNo?: string;
      batchExpiryDate?: string;
      serialNumbers?: string[];
    }[] = [];

    // Nilai dasar per baris penerimaan (qty x biaya satuan dasar PO) untuk jurnal GR/IR.
    const grBaseAmounts: string[] = [];

    for (const [index, rl] of parsed.lines.entries()) {
      const path = `lines.${index}`;
      if (!ownedIds.has(rl.poLineId)) {
        throw validationFailed([
          { path: `${path}.poLineId`, message: "Baris PO bukan milik purchase order ini." },
        ]);
      }
      const info = open.get(rl.poLineId);
      if (!info) {
        throw validationFailed([{ path: `${path}.poLineId`, message: "Baris PO tidak ditemukan." }]);
      }
      if (cmp(rl.quantity, info.remaining) > 0) {
        throw businessRule(
          `Jumlah diterima (${rl.quantity}) melebihi sisa pesanan (${info.remaining}) pada baris ${index + 1}.`,
        );
      }

      stockLines.push({
        productId: info.productId,
        quantity: toDb(rl.quantity, QTY_DP),
        unitCost: info.unitCostBase,
        batchNo: rl.batchNo,
        batchExpiryDate: rl.batchExpiryDate,
        serialNumbers: rl.serialNumbers && rl.serialNumbers.length > 0 ? rl.serialNumbers : undefined,
      });
      grBaseAmounts.push(toDb(round(mul(rl.quantity, info.unitCostBase), TOTAL_DP), TOTAL_DP));
    }

    const doc = await createStockDocument(
      actor,
      {
        type: "receipt",
        documentDate: parsed.documentDate,
        branchId: po.branchId,
        toWarehouseId: parsed.warehouseId,
        description: parsed.description ?? `Penerimaan dari PO ${po.docNo ?? po.id}`,
        lines: stockLines,
      },
      tx,
    );

    const posted = await postStockDocument(actor, doc.id, tx);

    // Jurnal GR/IR perpetual (5G): Dr Inventory / Cr GR/IR senilai biaya penerimaan.
    // Nol (biaya satuan 0) tidak menjurnal; jurnal dicatat dalam mata uang dasar.
    const grTotal = toDb(sum(grBaseAmounts), TOTAL_DP);
    if (cmp(grTotal, "0") > 0) {
      const { inventoryAccountId, grirAccountId } = await resolveApAccountIds(tx);
      const grDraft = await createSystemDraft(tx, actor, {
        entryDate: parsed.documentDate,
        description: `Penerimaan barang ${posted.docNo ?? doc.id} (GR/IR)`,
        reference: po.docNo ?? undefined,
        lines: [
          { accountId: inventoryAccountId, side: "debit", amount: grTotal },
          { accountId: grirAccountId, side: "credit", amount: grTotal },
        ],
        sourceType: SOURCE_RECEIPT,
        sourceId: doc.id,
        sourceEvent: "post",
      });
      await postJournal(actor, grDraft.id, tx);
    }

    // Naikkan quantityReceived per baris PO (akurat lewat aritmetika numeric DB).
    for (const rl of parsed.lines) {
      await tx
        .update(purchaseOrderLines)
        .set({
          quantityReceived: sql`${purchaseOrderLines.quantityReceived} + ${toDb(rl.quantity, QTY_DP)}`,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrderLines.id, rl.poLineId));
    }

    await audit.log(
      {
        action: "purchase_receipt.create",
        entityType: "purchase_receipt",
        entityId: doc.id,
        actorId: actor.userId,
        after: {
          poId,
          warehouseId: parsed.warehouseId,
          documentDate: parsed.documentDate,
          lineCount: parsed.lines.length,
          stockDocNo: posted.docNo,
        },
      },
      tx,
    );

    return { poId, stockDocument: posted };
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
