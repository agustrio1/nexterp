import { and, asc, desc, eq, type SQL } from "drizzle-orm";

import { apPaymentAllocations, apPayments, bankAccounts } from "@/db/schema";
import {
  createApPaymentSchema,
  listApPaymentsQuerySchema,
  type CreateApPaymentInput,
  type ListApPaymentsQuery,
} from "@/modules/purchasing/schemas";
import { assertActiveBranch, assertActiveCurrency, assertCan } from "@/modules/purchasing/_refs";
import { requireActiveSupplier } from "@/modules/purchasing/supplier-service";
import { loadOpenInvoicesForSupplier } from "@/modules/purchasing/invoice-service";
import { resolveApAccountIds } from "@/modules/purchasing/ap-account-config";
import { resolveRateToBase } from "@/modules/organization/currency-service";
import { cmp, div, mul, round, sub, toDb } from "@/lib/money";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/** sourceType jurnal mesin persetujuan 5G untuk pembayaran AP. */
const SOURCE_PAYMENT = "ap_payment";
const TOTAL_DP = 2;

const paymentColumns = {
  id: apPayments.id,
  docNo: apPayments.docNo,
  status: apPayments.status,
  supplierId: apPayments.supplierId,
  branchId: apPayments.branchId,
  paymentDate: apPayments.paymentDate,
  currency: apPayments.currency,
  exchangeRate: apPayments.exchangeRate,
  amountForeign: apPayments.amountForeign,
  amountBase: apPayments.amountBase,
  bankAccountId: apPayments.bankAccountId,
  journalEntryId: apPayments.journalEntryId,
  memo: apPayments.memo,
  postedAt: apPayments.postedAt,
  cancelledAt: apPayments.cancelledAt,
  reversedAt: apPayments.reversedAt,
  reason: apPayments.reason,
  createdAt: apPayments.createdAt,
  updatedAt: apPayments.updatedAt,
};

async function loadAllocations(reader: Reader, paymentId: string) {
  return reader
    .select({
      id: apPaymentAllocations.id,
      invoiceId: apPaymentAllocations.invoiceId,
      amountBase: apPaymentAllocations.amountBase,
      amountForeign: apPaymentAllocations.amountForeign,
    })
    .from(apPaymentAllocations)
    .where(eq(apPaymentAllocations.paymentId, paymentId))
    .orderBy(asc(apPaymentAllocations.invoiceId));
}

async function requirePayment(reader: Reader, id: string) {
  const [header] = await reader
    .select(paymentColumns)
    .from(apPayments)
    .where(eq(apPayments.id, id))
    .limit(1);
  if (!header) throw notFound("Pembayaran AP tidak ditemukan.");
  const allocations = await loadAllocations(reader, id);
  return { ...header, allocations };
}

async function lockPayment(tx: Tx, id: string) {
  const [row] = await tx
    .select(paymentColumns)
    .from(apPayments)
    .where(eq(apPayments.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Pembayaran AP tidak ditemukan.");
  return row;
}

/** Rekening kas/bank harus ada & aktif; mengembalikan id akun GL penampungnya. */
async function requireActiveBankAccount(tx: Tx, id: string, path: string): Promise<string> {
  const [account] = await tx
    .select({
      id: bankAccounts.id,
      code: bankAccounts.code,
      isActive: bankAccounts.isActive,
      accountId: bankAccounts.accountId,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, id))
    .limit(1);
  if (!account) throw validationFailed([{ path, message: "Rekening kas/bank tidak ditemukan." }]);
  if (!account.isActive) throw businessRule(`Rekening ${account.code} tidak aktif.`);
  return account.accountId;
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function listApPayments(
  actor: AuthContext,
  query: ListApPaymentsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.payments.read");
  const reader = externalTx ?? db;
  const parsed = listApPaymentsQuerySchema.parse(query);

  const conditions: (SQL | undefined)[] = [
    parsed.status === undefined ? undefined : eq(apPayments.status, parsed.status),
    parsed.supplierId === undefined ? undefined : eq(apPayments.supplierId, parsed.supplierId),
  ];

  return reader
    .select(paymentColumns)
    .from(apPayments)
    .where(and(...conditions))
    .orderBy(desc(apPayments.paymentDate), desc(apPayments.id));
}

export async function getApPayment(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.payments.read");
  return requirePayment(externalTx ?? db, id);
}

/* ------------------------------------------------------------------ */
/* Tulis: draf                                                         */
/* ------------------------------------------------------------------ */

/**
 * Buat pembayaran AP berstatus draft. Kurs/amountBase + alokasi FIFO baru
 * diselesaikan saat posting (fail-closed bila referensi berubah).
 */
export async function createApPayment(
  actor: AuthContext,
  input: CreateApPaymentInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.payments.manage");
  const parsed = createApPaymentSchema.parse(input);

  const run = async (tx: Tx) => {
    if (cmp(parsed.amountForeign, "0") <= 0) {
      throw validationFailed([
        { path: "amountForeign", message: "Jumlah pembayaran harus lebih dari nol." },
      ]);
    }

    const supplier = await requireActiveSupplier(tx, parsed.supplierId);
    await assertActiveBranch(tx, parsed.branchId);
    await requireActiveBankAccount(tx, parsed.bankAccountId, "bankAccountId");

    const currency = parsed.currency ?? supplier.currency;
    if (!currency) {
      throw businessRule(
        "Mata uang pembayaran tidak ditentukan; isi mata uang pada pemasok atau request.",
      );
    }
    await assertActiveCurrency(tx, currency, "currency");

    const [payment] = await tx
      .insert(apPayments)
      .values({
        status: "draft",
        supplierId: parsed.supplierId,
        branchId: parsed.branchId,
        paymentDate: parsed.paymentDate,
        currency,
        amountForeign: toDb(parsed.amountForeign, TOTAL_DP),
        amountBase: "0.00",
        bankAccountId: parsed.bankAccountId,
        memo: parsed.memo ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: apPayments.id });
    if (!payment) throw new Error("Gagal membuat pembayaran AP.");

    await audit.log(
      {
        action: "ap_payment.create",
        entityType: "ap_payment",
        entityId: payment.id,
        actorId: actor.userId,
        after: {
          supplierId: parsed.supplierId,
          currency,
          amountForeign: toDb(parsed.amountForeign, TOTAL_DP),
        },
      },
      tx,
    );

    return requirePayment(tx, payment.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ------------------------------------------------------------------ */
/* Transisi: post / cancel / reverse                                   */
/* ------------------------------------------------------------------ */

/**
 * draft -> posted. Snapshot kurs paymentDate -> amountBase, alokasi FIFO ke invoice
 * terbuka (urut jatuh tempo), terbitkan jurnal Dr AP / Cr Bank dalam mata uang dasar.
 * Pembayaran melebihi total utang terbuka ditolak (no overpayment).
 */
export async function postApPayment(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.payments.post");

  const run = async (tx: Tx) => {
    const current = await lockPayment(tx, id);
    if (current.status !== "draft") {
      throw businessRule("Hanya pembayaran berstatus draft yang dapat diposting.");
    }

    // Selesaikan ulang referensi (fail-closed bila berubah sejak draf).
    await requireActiveSupplier(tx, current.supplierId);
    const bankGlAccountId = await requireActiveBankAccount(tx, current.bankAccountId, "bankAccountId");

    const { rate } = await resolveRateToBase(tx, current.currency, current.paymentDate);
    const amountBase = toDb(round(mul(current.amountForeign, rate), TOTAL_DP), TOTAL_DP);
    if (cmp(amountBase, "0") <= 0) {
      throw businessRule("Nilai basis pembayaran bernilai nol; periksa kurs dan jumlah.");
    }

    // Alokasi FIFO ke invoice terbuka (sisa > 0), urut jatuh tempo.
    const openInvoices = await loadOpenInvoicesForSupplier(tx, current.supplierId);
    let left = amountBase;
    const allocations: {
      invoiceId: string;
      amountBase: string;
      amountForeign: string;
    }[] = [];
    for (const inv of openInvoices) {
      if (cmp(left, "0") <= 0) break;
      const applied = cmp(inv.remainingBase, left) <= 0 ? inv.remainingBase : left;
      allocations.push({
        invoiceId: inv.id,
        amountBase: toDb(applied, TOTAL_DP),
        amountForeign: toDb(div(applied, inv.exchangeRate), TOTAL_DP),
      });
      left = toDb(sub(left, applied), TOTAL_DP);
    }
    if (cmp(left, "0") > 0) {
      throw businessRule(
        `Jumlah pembayaran (${amountBase}) melebihi total utang terbuka pemasok ini. Kurangi jumlah atau hapus tagihan lain.`,
      );
    }
    if (allocations.length === 0) {
      throw businessRule("Tidak ada invoice terbuka untuk dialokasikan.");
    }

    const { apAccountId } = await resolveApAccountIds(tx);

    const systemDraft = await createSystemDraft(tx, actor, {
      entryDate: current.paymentDate,
      description: `Pembayaran AP ${current.memo ?? current.id}`,
      lines: [
        { accountId: apAccountId, side: "debit", amount: amountBase },
        { accountId: bankGlAccountId, side: "credit", amount: amountBase },
      ],
      sourceType: SOURCE_PAYMENT,
      sourceId: current.id,
      sourceEvent: "post",
    });
    const posted = await postJournal(actor, systemDraft.id, tx);

    await tx.insert(apPaymentAllocations).values(
      allocations.map((a) => ({
        paymentId: current.id,
        invoiceId: a.invoiceId,
        amountBase: a.amountBase,
        amountForeign: a.amountForeign,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    const docNo = await nextDocumentNumber(tx, "ap_payment", { date: current.paymentDate });

    await tx
      .update(apPayments)
      .set({
        status: "posted",
        docNo,
        exchangeRate: rate,
        amountBase,
        journalEntryId: posted.id,
        postedAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(apPayments.id, id));

    await audit.log(
      {
        action: "ap_payment.post",
        entityType: "ap_payment",
        entityId: id,
        actorId: actor.userId,
        before: { status: "draft" },
        after: {
          status: "posted",
          docNo,
          exchangeRate: rate,
          amountBase,
          journalEntryId: posted.id,
          allocationCount: allocations.length,
        },
      },
      tx,
    );

    return requirePayment(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/** draft -> cancelled (belum menyentuh buku besar). */
export async function cancelApPayment(
  actor: AuthContext,
  id: string,
  input: { reason: string },
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.payments.manage");

  const run = async (tx: Tx) => {
    const current = await lockPayment(tx, id);
    if (current.status !== "draft") {
      throw businessRule(
        "Hanya pembayaran berstatus draft yang dapat dibatalkan. Gunakan reversal untuk pembayaran posted.",
      );
    }

    await tx
      .update(apPayments)
      .set({
        status: "cancelled",
        reason: input.reason,
        cancelledAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(apPayments.id, id));

    await audit.log(
      {
        action: "ap_payment.cancel",
        entityType: "ap_payment",
        entityId: id,
        actorId: actor.userId,
        before: { status: "draft" },
        after: { status: "cancelled", reason: input.reason },
      },
      tx,
    );

    return requirePayment(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/** posted -> reversed: balik jurnal + hapus alokasi agar invoice kembali terbuka. */
export async function reverseApPayment(
  actor: AuthContext,
  id: string,
  input: { reason: string },
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.payments.post");

  const run = async (tx: Tx) => {
    const current = await lockPayment(tx, id);
    if (current.status !== "posted") {
      throw businessRule("Hanya pembayaran berstatus posted yang dapat direversal.");
    }
    if (!current.journalEntryId) {
      throw businessRule("Pembayaran posted tanpa jurnal terkait; tidak dapat direversal.");
    }

    await reverseJournal(actor, current.journalEntryId, { reason: input.reason }, tx);
    await tx.delete(apPaymentAllocations).where(eq(apPaymentAllocations.paymentId, id));

    await tx
      .update(apPayments)
      .set({
        status: "reversed",
        reason: input.reason,
        reversedAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(apPayments.id, id));

    await audit.log(
      {
        action: "ap_payment.reverse",
        entityType: "ap_payment",
        entityId: id,
        actorId: actor.userId,
        before: { status: "posted" },
        after: { status: "reversed", reason: input.reason },
      },
      tx,
    );

    return requirePayment(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
