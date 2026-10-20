import type { PartyShare, SalaryComponentKind, StatutoryKind } from "@/db/schema/payroll";
import { add, cmp, div, mul, sub, toDb } from "@/lib/money";

/**
 * Mesin kalkulasi payroll MURNI (tanpa DB) dan KONFIGURATIF.
 * TIDAK ada angka regulasi bawaan — seluruh tarif/iuran datang dari statutory_rules
 * yang sudah dimuat efektif-tanggal oleh pemanggil. Fungsi ini mudah diuji dan
 * deterministik; semua nominal string desimal, pembulatan HALF_UP 2 desimal.
 */

export type BracketInput = {
  minAmount: string;
  maxAmount: string | null;
  rate: string;
};

export type StatutoryRuleInput = {
  id: string;
  code: string;
  kind: StatutoryKind;
  party: PartyShare;
  name: string;
  rate: string | null;
  flatAmount: string | null;
  wageCap: string | null;
  belowWageCap: boolean | null;
  brackets: BracketInput[];
};

export type ComponentValueInput = {
  componentId: string;
  code: string;
  name: string;
  kind: SalaryComponentKind;
  basis: "fixed" | "percentage_of_base" | "statutory" | "attendance";
  amount: string | null;
  percentValue: string | null;
  includeInTaxBase: boolean;
  includeInBpjsBase: boolean;
};

export type AdjustmentInput = {
  kind: SalaryComponentKind;
  amount: string;
  label: string;
};

export type EmployeePayInput = {
  employeeId: string;
  baseSalary: string;
  components: ComponentValueInput[];
  adjustments: AdjustmentInput[];
  rules: StatutoryRuleInput[];
};

export type PayLine = {
  label: string;
  kind: SalaryComponentKind;
  amount: string;
  componentId?: string | null;
  statutoryRuleId?: string | null;
  basisSnapshot?: Record<string, unknown>;
};

export type EmployeePayResult = {
  employeeId: string;
  grossEarnings: string;
  totalDeductions: string;
  netPay: string;
  earnings: PayLine[];
  deductions: PayLine[];
  /** Biaya ditanggung pemberi kerja (BPJS) — TIDAK memotong net, di luar totalDeductions. */
  employerCosts: PayLine[];
  /** Agregat untuk jurnal (sudah termasuk porsi pemberi kerja pada bpjsEmployer). */
  tax: string;
  bpjsEmployee: string;
  bpjsEmployer: string;
  otherDeduction: string;
};

/** Pajak progresif atas suatu dasar: jumlah tiap irisan-bracket x tarif bracket. */
export function computeBracketsTax(base: string, brackets: readonly BracketInput[]): string {
  let total = add();
  for (const b of brackets) {
    // Irisan penghasilan [0, base] dengan bracket [min, max??] = max(0, min(base, max) - min).
    let top = base;
    if (b.maxAmount != null && cmp(base, b.maxAmount) > 0) top = b.maxAmount;
    if (cmp(top, b.minAmount) <= 0) continue;
    const width = sub(top, b.minAmount);
    total = add(total, mul(width, div(b.rate, 100)));
  }
  return toDb(total, 2);
}

/** Dasar pengenaan sebuah aturan berdasarkan jenisnya. */
function ruleBase(kind: StatutoryKind, taxBase: string, bpjsBase: string, gross: string): string {
  if (kind === "pph21") return taxBase;
  if (kind.startsWith("bpjs_")) return bpjsBase;
  return gross; // other -> atas penghasilan bruto
}

/** Terapkan plafon upah (wageCap) + semantik belowWageCap. */
function applyWageCap(base: string, wageCap: string | null, belowWageCap: boolean | null): string {
  if (wageCap == null) return base;
  if (belowWageCap === true) {
    // Aturan hanya berlaku untuk yang penghasilannya DI BAWAH plafon (mis. iuran berdasar UMR).
    return cmp(base, wageCap) < 0 ? base : "0";
  }
  // Default: dasar dibatasi (di-cap) pada nilai plafon.
  return cmp(base, wageCap) > 0 ? wageCap : base;
}

/** Hitung satu aturan statutory terhadap suatu dasar -> nominal + pemetaan pihak. */
function evaluateRule(rule: StatutoryRuleInput, base: string): string {
  const effectiveBase = applyWageCap(base, rule.wageCap, rule.belowWageCap);
  if (rule.brackets.length > 0) return computeBracketsTax(effectiveBase, rule.brackets);
  if (rule.rate != null) return toDb(mul(effectiveBase, div(rule.rate, 100)), 2);
  if (rule.flatAmount != null) return toDb(rule.flatAmount, 2);
  return "0.00";
}

export function computeEmployeePay(input: EmployeePayInput): EmployeePayResult {
  const base = toDb(input.baseSalary, 2);

  // 1) Earnings dari komponen (fixed / percentage_of_base). attendance diperlakukan
  //    sebagai nilai tetap yang sudah diisi admin (basis 'fixed'-like via amount).
  const earnings: PayLine[] = [];
  let gross = add(base);
  earnings.push({ label: "Gaji Pokok", kind: "earning", amount: base });

  let taxBase = add(base);
  let bpjsBase = add(base);

  for (const c of input.components) {
    if (c.kind !== "earning") continue;
    let amount = "0.00";
    if (c.basis === "percentage_of_base" && c.percentValue != null) {
      amount = toDb(mul(base, div(c.percentValue, 100)), 2);
    } else if (c.amount != null) {
      // fixed & attendance memakai nilai tetap.
      amount = toDb(c.amount, 2);
    } else {
      continue;
    }
    if (cmp(amount, "0") <= 0) continue;
    gross = gross.plus(amount);
    if (c.includeInTaxBase) taxBase = taxBase.plus(amount);
    if (c.includeInBpjsBase) bpjsBase = bpjsBase.plus(amount);
    earnings.push({
      label: c.name,
      kind: "earning",
      amount,
      componentId: c.componentId,
      basisSnapshot: { basis: c.basis, amount: c.amount, percentValue: c.percentValue },
    });
  }

  // 2) Penyesuaian earning.
  for (const a of input.adjustments) {
    if (a.kind !== "earning") continue;
    const amount = toDb(a.amount, 2);
    if (cmp(amount, "0") <= 0) continue;
    gross = gross.plus(amount);
    earnings.push({ label: a.label, kind: "earning", amount, basisSnapshot: { adjustment: true } });
  }

  // 3) Statutory rules -> potongan (employee) & biaya (employer).
  let tax = add();
  let bpjsEmployee = add();
  let bpjsEmployer = add();
  let otherDeduction = add();
  const deductions: PayLine[] = [];
  const employerCosts: PayLine[] = [];

  for (const rule of input.rules) {
    const baseForRule = ruleBase(rule.kind, toDb(taxBase, 2), toDb(bpjsBase, 2), toDb(gross, 2));
    const isBpjs = rule.kind.startsWith("bpjs_");

    if (rule.party === "employee") {
      const amt = evaluateRule(rule, baseForRule);
      if (cmp(amt, "0") <= 0) continue;
      deductions.push({
        label: rule.name,
        kind: "deduction",
        amount: amt,
        statutoryRuleId: rule.id,
        basisSnapshot: { rule: rule.code, party: "employee", base: baseForRule },
      });
      if (rule.kind === "pph21") tax = tax.plus(amt);
      else if (isBpjs) bpjsEmployee = bpjsEmployee.plus(amt);
      else otherDeduction = otherDeduction.plus(amt);
    } else if (rule.party === "employer") {
      if (!isBpjs) {
        throw new Error(
          `Aturan '${rule.code}' pihak employer hanya didukung untuk jenis BPJS; gunakan konfigurasi lain.`,
        );
      }
      const amt = evaluateRule(rule, baseForRule);
      if (cmp(amt, "0") <= 0) continue;
      bpjsEmployer = bpjsEmployer.plus(amt);
      employerCosts.push({
        label: `${rule.name} (pemberi kerja)`,
        kind: "deduction",
        amount: amt,
        statutoryRuleId: rule.id,
        basisSnapshot: { rule: rule.code, party: "employer", base: baseForRule },
      });
      // Biaya pemberi kerja TIDAK memotong net; dicatat sebagai beban & liabilitas.
    } else {
      // both -> potongan pekerja + biaya pemberi kerja pada nominal yang sama (khusus BPJS).
      if (!isBpjs) {
        throw new Error(`Aturan '${rule.code}' pihak both hanya didukung untuk jenis BPJS.`);
      }
      const amt = evaluateRule(rule, baseForRule);
      if (cmp(amt, "0") <= 0) continue;
      bpjsEmployee = bpjsEmployee.plus(amt);
      bpjsEmployer = bpjsEmployer.plus(amt);
      deductions.push({
        label: `${rule.name} (pekerja)`,
        kind: "deduction",
        amount: amt,
        statutoryRuleId: rule.id,
        basisSnapshot: { rule: rule.code, party: "both", base: baseForRule },
      });
      employerCosts.push({
        label: `${rule.name} (pemberi kerja)`,
        kind: "deduction",
        amount: amt,
        statutoryRuleId: rule.id,
        basisSnapshot: { rule: rule.code, party: "employer", base: baseForRule },
      });
    }
  }

  // 4) Penyesuaian deduction -> other deduction (dipotong dari net).
  for (const a of input.adjustments) {
    if (a.kind !== "deduction") continue;
    const amount = toDb(a.amount, 2);
    if (cmp(amount, "0") <= 0) continue;
    otherDeduction = otherDeduction.plus(amount);
    deductions.push({ label: a.label, kind: "deduction", amount, basisSnapshot: { adjustment: true } });
  }

  const totalDeductions = add(tax, bpjsEmployee, otherDeduction);
  const netPay = toDb(sub(gross, totalDeductions), 2);
  if (cmp(netPay, "0") < 0) {
    throw new Error(`Net payroll karyawan ${input.employeeId} negatif (potongan > penghasilan).`);
  }

  return {
    employeeId: input.employeeId,
    grossEarnings: toDb(gross, 2),
    totalDeductions: toDb(totalDeductions, 2),
    netPay,
    earnings,
    deductions,
    employerCosts,
    tax: toDb(tax, 2),
    bpjsEmployee: toDb(bpjsEmployee, 2),
    bpjsEmployer: toDb(bpjsEmployer, 2),
    otherDeduction: toDb(otherDeduction, 2),
  };
}

/** Agregat seluruh hasil karyawan untuk kebutuhan jurnal. */
export function aggregatePay(results: readonly EmployeePayResult[]) {
  let gross = add();
  let deductions = add();
  let net = add();
  let tax = add();
  let bpjsEmployee = add();
  let bpjsEmployer = add();
  let otherDeduction = add();
  for (const r of results) {
    gross = gross.plus(r.grossEarnings);
    deductions = deductions.plus(r.totalDeductions);
    net = net.plus(r.netPay);
    tax = tax.plus(r.tax);
    bpjsEmployee = bpjsEmployee.plus(r.bpjsEmployee);
    bpjsEmployer = bpjsEmployer.plus(r.bpjsEmployer);
    otherDeduction = otherDeduction.plus(r.otherDeduction);
  }
  return {
    employeeCount: results.length,
    grossEarnings: toDb(gross, 2),
    totalDeductions: toDb(deductions, 2),
    netPay: toDb(net, 2),
    tax: toDb(tax, 2),
    bpjsEmployee: toDb(bpjsEmployee, 2),
    bpjsEmployer: toDb(bpjsEmployer, 2),
    otherDeduction: toDb(otherDeduction, 2),
  };
}
