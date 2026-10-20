import { and, asc, eq, lte } from "drizzle-orm";

import { statutoryRuleBrackets, statutoryRules } from "@/db/schema";
import type {
  CreateBracketInput,
  CreateStatutoryRuleInput,
  UpdateBracketInput,
  UpdateStatutoryRuleInput,
} from "@/modules/payroll/schemas";
import { assertCan, inTx, requireRule, type Reader, type Tx } from "@/modules/payroll/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const ruleColumns = {
  id: statutoryRules.id,
  code: statutoryRules.code,
  kind: statutoryRules.kind,
  party: statutoryRules.party,
  name: statutoryRules.name,
  rate: statutoryRules.rate,
  flatAmount: statutoryRules.flatAmount,
  wageCap: statutoryRules.wageCap,
  belowWageCap: statutoryRules.belowWageCap,
  source: statutoryRules.source,
  effectiveFrom: statutoryRules.effectiveFrom,
  isActive: statutoryRules.isActive,
  notes: statutoryRules.notes,
  createdAt: statutoryRules.createdAt,
  updatedAt: statutoryRules.updatedAt,
};

const bracketColumns = {
  id: statutoryRuleBrackets.id,
  ruleId: statutoryRuleBrackets.ruleId,
  orderNo: statutoryRuleBrackets.orderNo,
  minAmount: statutoryRuleBrackets.minAmount,
  maxAmount: statutoryRuleBrackets.maxAmount,
  rate: statutoryRuleBrackets.rate,
  source: statutoryRuleBrackets.source,
};

async function loadBrackets(reader: Reader, ruleId: string) {
  return reader
    .select(bracketColumns)
    .from(statutoryRuleBrackets)
    .where(eq(statutoryRuleBrackets.ruleId, ruleId))
    .orderBy(asc(statutoryRuleBrackets.orderNo));
}

async function withBrackets(reader: Reader, id: string) {
  const rule = await requireRule(reader, id);
  const brackets = await loadBrackets(reader, id);
  return { ...rule, brackets };
}

export async function listStatutoryRules(
  actor: AuthContext,
  query: { isActive?: boolean; kind?: string } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.statutory.read");
  const reader = externalTx ?? db;
  return reader
    .select(ruleColumns)
    .from(statutoryRules)
    .where(
      and(
        query.isActive === undefined ? undefined : eq(statutoryRules.isActive, query.isActive),
        query.kind === undefined ? undefined : eq(statutoryRules.kind, query.kind as "pph21"),
      ),
    )
    .orderBy(asc(statutoryRules.kind), asc(statutoryRules.effectiveFrom));
}

export async function getStatutoryRule(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.statutory.read");
  return withBrackets(externalTx ?? db, id);
}

export async function createStatutoryRule(
  actor: AuthContext,
  input: CreateStatutoryRuleInput,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.statutory.manage");
  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select({ id: statutoryRules.id })
      .from(statutoryRules)
      .where(eq(statutoryRules.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode aturan statutory sudah dipakai.");
    if (!input.rate && !input.flatAmount) {
      throw businessRule(
        "Aturan statutory harus punya tarif (rate) atau jumlah tetap (flatAmount); progresif ditambahkan lewat bracket.",
      );
    }

    const [created] = await tx
      .insert(statutoryRules)
      .values({
        code: input.code,
        kind: input.kind,
        party: input.party,
        name: input.name,
        rate: input.rate ?? null,
        flatAmount: input.flatAmount ?? null,
        wageCap: input.wageCap ?? null,
        belowWageCap: input.belowWageCap ?? null,
        source: input.source,
        effectiveFrom: input.effectiveFrom,
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: statutoryRules.id });
    if (!created) throw new Error("Gagal membuat aturan statutory.");
    await audit.log(
      {
        action: "payroll.statutory.create",
        entityType: "statutory_rule",
        entityId: created.id,
        actorId: actor.userId,
        after: { code: input.code, kind: input.kind, party: input.party, source: input.source },
      },
      tx,
    );
    return withBrackets(tx, created.id);
  });
}

export async function updateStatutoryRule(
  actor: AuthContext,
  id: string,
  input: UpdateStatutoryRuleInput,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.statutory.manage");
  return inTx(externalTx, async (tx) => {
    const current = await requireRule(tx, id);
    const next = {
      kind: input.kind ?? current.kind,
      party: input.party ?? current.party,
      name: input.name ?? current.name,
      rate: input.rate === undefined ? current.rate : input.rate,
      flatAmount: input.flatAmount === undefined ? current.flatAmount : input.flatAmount,
      wageCap: input.wageCap === undefined ? current.wageCap : input.wageCap,
      belowWageCap: input.belowWageCap === undefined ? current.belowWageCap : input.belowWageCap,
      source: input.source ?? current.source,
      isActive: input.isActive ?? current.isActive,
      notes: input.notes === undefined ? current.notes : input.notes,
    };
    if (!next.rate && !next.flatAmount) {
      throw businessRule("Aturan statutory harus punya tarif atau jumlah tetap.");
    }
    await tx
      .update(statutoryRules)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(statutoryRules.id, id));
    await audit.log(
      { action: "payroll.statutory.update", entityType: "statutory_rule", entityId: id, actorId: actor.userId, after: next },
      tx,
    );
    return withBrackets(tx, id);
  });
}

/* ------------------------------ Bracket ----------------------------- */

export async function addBracket(actor: AuthContext, ruleId: string, input: CreateBracketInput, externalTx?: Tx) {
  assertCan(actor, "payroll.statutory.manage");
  return inTx(externalTx, async (tx) => {
    await requireRule(tx, ruleId);
    const [dup] = await tx
      .select({ id: statutoryRuleBrackets.id })
      .from(statutoryRuleBrackets)
      .where(and(eq(statutoryRuleBrackets.ruleId, ruleId), eq(statutoryRuleBrackets.orderNo, input.orderNo)))
      .limit(1);
    if (dup) throw conflict("Nomor urut bracket sudah dipakai pada aturan ini.");
    if (input.maxAmount && input.maxAmount <= input.minAmount) {
      throw businessRule("Batas atas bracket harus lebih besar dari batas bawah.");
    }

    const [created] = await tx
      .insert(statutoryRuleBrackets)
      .values({
        ruleId,
        orderNo: input.orderNo,
        minAmount: input.minAmount,
        maxAmount: input.maxAmount ?? null,
        rate: input.rate,
        source: input.source,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: statutoryRuleBrackets.id });
    if (!created) throw new Error("Gagal membuat bracket statutory.");
    await audit.log(
      {
        action: "payroll.statutory.bracket.create",
        entityType: "statutory_rule",
        entityId: ruleId,
        actorId: actor.userId,
        after: { bracketId: created.id, orderNo: input.orderNo, rate: input.rate, source: input.source },
      },
      tx,
    );
    return withBrackets(tx, ruleId);
  });
}

export async function updateBracket(
  actor: AuthContext,
  bracketId: string,
  input: UpdateBracketInput,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.statutory.manage");
  return inTx(externalTx, async (tx) => {
    const [current] = await tx
      .select(bracketColumns)
      .from(statutoryRuleBrackets)
      .where(eq(statutoryRuleBrackets.id, bracketId))
      .limit(1);
    if (!current) throw notFound("Bracket statutory tidak ditemukan.");
    const next = {
      minAmount: input.minAmount ?? current.minAmount,
      maxAmount: input.maxAmount === undefined ? current.maxAmount : input.maxAmount,
      rate: input.rate ?? current.rate,
      source: input.source ?? current.source,
    };
    if (next.maxAmount && next.maxAmount <= next.minAmount) {
      throw businessRule("Batas atas bracket harus lebih besar dari batas bawah.");
    }
    await tx
      .update(statutoryRuleBrackets)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(statutoryRuleBrackets.id, bracketId));
    await audit.log(
      { action: "payroll.statutory.bracket.update", entityType: "statutory_rule", entityId: current.ruleId, actorId: actor.userId, after: next },
      tx,
    );
    return withBrackets(tx, current.ruleId);
  });
}

export async function deleteBracket(actor: AuthContext, bracketId: string, externalTx?: Tx) {
  assertCan(actor, "payroll.statutory.manage");
  return inTx(externalTx, async (tx) => {
    const [current] = await tx
      .select({ ruleId: statutoryRuleBrackets.ruleId })
      .from(statutoryRuleBrackets)
      .where(eq(statutoryRuleBrackets.id, bracketId))
      .limit(1);
    if (!current) throw notFound("Bracket statutory tidak ditemukan.");
    await tx.delete(statutoryRuleBrackets).where(eq(statutoryRuleBrackets.id, bracketId));
    await audit.log(
      { action: "payroll.statutory.bracket.delete", entityType: "statutory_rule", entityId: current.ruleId, actorId: actor.userId, after: { bracketId } },
      tx,
    );
    return withBrackets(tx, current.ruleId);
  });
}

/** Muat aturan aktif + bracket yang berlaku pada tanggal (untuk engine). */
export async function loadEffectiveStatutoryRules(tx: Tx, asOfDate: string) {
  const rules = await tx
    .select(ruleColumns)
    .from(statutoryRules)
    .where(and(eq(statutoryRules.isActive, true), lte(statutoryRules.effectiveFrom, asOfDate)));
  if (rules.length === 0) return [];
  const brackets = await tx
    .select(bracketColumns)
    .from(statutoryRuleBrackets)
    .orderBy(asc(statutoryRuleBrackets.orderNo));
  const byRule = new Map<string, typeof brackets>();
  for (const b of brackets) {
    const list = byRule.get(b.ruleId) ?? [];
    list.push(b);
    byRule.set(b.ruleId, list);
  }
  return rules.map((r) => ({ ...r, brackets: byRule.get(r.id) ?? [] }));
}
