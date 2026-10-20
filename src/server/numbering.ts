import { and, eq, isNull, sql } from "drizzle-orm";

import { branches, numberingSequences } from "@/db/schema";
import { type Transaction } from "@/server/db";

type ResetPolicy = "never" | "yearly" | "monthly";

type NumberingRule = {
  prefix: string;
  resetPolicy: ResetPolicy;
  /** Jumlah digit minimal urutan (diberi nol di depan); angka lebih besar tidak dipotong. */
  padding: number;
  /** true = urutan terpisah per cabang dan kode cabang ikut di nomor. */
  perBranch: boolean;
};

/**
 * Aturan penomoran per jenis dokumen. Setiap modul menambahkan barisnya di sini
 * saat dokumennya dibuat (Tahap 4 dan seterusnya).
 */
export const NUMBERING_RULES = {
  journal_entry: { prefix: "JE", resetPolicy: "yearly", padding: 5, perBranch: false },
  tax_transaction: { prefix: "TX", resetPolicy: "yearly", padding: 5, perBranch: false },
  cash_transaction: { prefix: "CT", resetPolicy: "yearly", padding: 5, perBranch: false },
  bank_reconciliation: { prefix: "BR", resetPolicy: "yearly", padding: 5, perBranch: false },
  budget: { prefix: "BGT", resetPolicy: "yearly", padding: 5, perBranch: false },
  goods_receipt: { prefix: "GR", resetPolicy: "yearly", padding: 5, perBranch: false },
  goods_issue: { prefix: "GI", resetPolicy: "yearly", padding: 5, perBranch: false },
  stock_transfer: { prefix: "TR", resetPolicy: "yearly", padding: 5, perBranch: false },
  stock_adjustment: { prefix: "ADJ", resetPolicy: "yearly", padding: 5, perBranch: false },
  stock_opname: { prefix: "OP", resetPolicy: "yearly", padding: 5, perBranch: false },
  purchase_order: { prefix: "PO", resetPolicy: "yearly", padding: 5, perBranch: false },
  supplier_invoice: { prefix: "SIV", resetPolicy: "yearly", padding: 5, perBranch: false },
  ap_payment: { prefix: "PBY", resetPolicy: "yearly", padding: 5, perBranch: false },
  customer_invoice: { prefix: "INV", resetPolicy: "monthly", padding: 5, perBranch: true },
  sales_quotation: { prefix: "SQ", resetPolicy: "yearly", padding: 5, perBranch: false },
  sales_order: { prefix: "SO", resetPolicy: "yearly", padding: 5, perBranch: false },
  sales_delivery: { prefix: "DLV", resetPolicy: "yearly", padding: 5, perBranch: false },
  sales_return: { prefix: "SRT", resetPolicy: "yearly", padding: 5, perBranch: false },
  sales_credit_note: { prefix: "CN", resetPolicy: "yearly", padding: 5, perBranch: false },
  customer_payment: { prefix: "CMP", resetPolicy: "yearly", padding: 5, perBranch: false },
  employee: { prefix: "EMP", resetPolicy: "yearly", padding: 5, perBranch: false },
  employment_contract: { prefix: "KTR", resetPolicy: "yearly", padding: 5, perBranch: false },
  leave_request: { prefix: "CVT", resetPolicy: "yearly", padding: 5, perBranch: false },
  overtime_request: { prefix: "OTR", resetPolicy: "yearly", padding: 5, perBranch: false },
  payroll_period: { prefix: "PRD", resetPolicy: "yearly", padding: 5, perBranch: false },
  payroll_run: { prefix: "PR", resetPolicy: "monthly", padding: 5, perBranch: false },
  payslip: { prefix: "PS", resetPolicy: "monthly", padding: 5, perBranch: false },
  fixed_asset: { prefix: "FA", resetPolicy: "yearly", padding: 5, perBranch: false },
  asset_acquisition: { prefix: "ACQ", resetPolicy: "yearly", padding: 5, perBranch: false },
  depreciation_run: { prefix: "DRP", resetPolicy: "monthly", padding: 5, perBranch: false },
  asset_disposal: { prefix: "DSP", resetPolicy: "yearly", padding: 5, perBranch: false },
  asset_revaluation: { prefix: "RVY", resetPolicy: "yearly", padding: 5, perBranch: false },
  project: { prefix: "PRJ", resetPolicy: "yearly", padding: 5, perBranch: false },
  export_job: { prefix: "EXP", resetPolicy: "yearly", padding: 5, perBranch: false },
} as const satisfies Record<string, NumberingRule>;

export type NumberedDocType = keyof typeof NUMBERING_RULES;

const MAX_ATTEMPTS = 5;

/** Kunci periode dari tanggal dokumen: '' (never), '2026' (yearly), '202601' (monthly). */
function periodKeyFor(date: string, policy: ResetPolicy): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Tanggal dokumen tidak valid: ${date}`);
  }

  if (policy === "yearly") return date.slice(0, 4);
  if (policy === "monthly") return date.slice(0, 4) + date.slice(5, 7);
  return "";
}

async function takeNext(
  tx: Transaction,
  docType: string,
  branchId: string | null,
  periodKey: string,
  rule: NumberingRule,
): Promise<{ seq: number; prefix: string; padding: number }> {
  const branchMatch =
    branchId === null ? isNull(numberingSequences.branchId) : eq(numberingSequences.branchId, branchId);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Baris urutan terkunci oleh UPDATE ini sampai transaksi pemanggil selesai.
    const [updated] = await tx
      .update(numberingSequences)
      .set({ nextNo: sql`${numberingSequences.nextNo} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(numberingSequences.docType, docType),
          eq(numberingSequences.periodKey, periodKey),
          branchMatch,
        ),
      )
      .returning({
        // RETURNING memuat nilai SESUDAH pembaruan; dikurangi 1 = nomor yang diambil.
        taken: sql<string>`${numberingSequences.nextNo} - 1`,
        prefix: numberingSequences.prefix,
        padding: numberingSequences.padding,
      });

    if (updated) {
      return { seq: Number(updated.taken), prefix: updated.prefix, padding: updated.padding };
    }

    const [inserted] = await tx
      .insert(numberingSequences)
      .values({
        docType,
        branchId,
        periodKey,
        prefix: rule.prefix,
        padding: rule.padding,
        resetPolicy: rule.resetPolicy,
        nextNo: 2, // nomor 1 diambil sekarang
      })
      .onConflictDoNothing()
      .returning({ id: numberingSequences.id });

    if (inserted) {
      return { seq: 1, prefix: rule.prefix, padding: rule.padding };
    }
    // Transaksi lain membuat baris yang sama pada saat bersamaan; ulangi dari UPDATE.
  }

  throw new Error("Gagal mengambil nomor dokumen setelah beberapa percobaan.");
}

/**
 * Mengambil nomor dokumen berikutnya. WAJIB dipanggil di dalam transaksi bisnis pemanggil
 * (nomor ikut batal bila transaksi dibatalkan) dan sedekat mungkin dengan akhir transaksi,
 * karena baris urutan terkunci sampai transaksi selesai.
 *
 * @param options.date tanggal dokumen (YYYY-MM-DD), menentukan periode penomoran
 * @param options.branchId wajib bila jenis dokumen bersifat per cabang
 */
export async function nextDocumentNumber(
  tx: Transaction,
  docType: NumberedDocType,
  options: { date: string; branchId?: string | null },
): Promise<string> {
  const rule: NumberingRule = NUMBERING_RULES[docType];
  const periodKey = periodKeyFor(options.date, rule.resetPolicy);

  let branchId: string | null = null;
  let branchCode: string | null = null;

  if (rule.perBranch) {
    if (!options.branchId) {
      throw new Error(`Dokumen ${docType} membutuhkan cabang untuk penomoran.`);
    }

    const [branch] = await tx
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, options.branchId))
      .limit(1);
    if (!branch) {
      throw new Error("Cabang untuk penomoran tidak ditemukan.");
    }

    branchId = options.branchId;
    branchCode = branch.code;
  }

  const { seq, prefix, padding } = await takeNext(tx, docType, branchId, periodKey, rule);

  return [prefix, branchCode, periodKey === "" ? null : periodKey, String(seq).padStart(padding, "0")]
    .filter((part): part is string => part !== null)
    .join("-");
}