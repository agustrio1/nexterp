import { asc, eq } from "drizzle-orm";

import { fiscalYears, jobRuns, users } from "@/db/schema";
import { createEmployee } from "@/modules/hr/employee-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { createPeriod, finalizePeriod } from "@/modules/payroll/period-service";
import { setCompensation } from "@/modules/payroll/compensation-service";
import { createRun, getRun } from "@/modules/payroll/run-service";
import { enqueueExport, enqueuePayrollRun, getJob, runNextJob } from "@/modules/jobs/job-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 8E: loop worker latar belakang. Menguji dispatch registri
 * lintas jenis job (`export.report` + `payroll.run`), siklus klaim yang tidak
 * memproses dobel, spesialisasi worker per izin jenis, retry -> dead-letter,
 * dan idempotensi enqueue kalkulasi payroll. FY terisolasi UJIFY2039.
 * SELURUHNYA dalam SATU transaksi dengan throw Rollback — TIDAK ADA data
 * tersimpan di DB. (Konkurensi lintas koneksi dijamin `FOR UPDATE SKIP LOCKED`;
 * dalam satu koneksi, flip status running memberi jaminan no-double yang sama.)
 */

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

async function expectFail(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    assert(`${label} (harusnya ditolak)`, false);
  } catch {
    assert(`${label} ditolak`, true);
  }
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna (jalankan db:seed + db:create-admin).");

  const actorA: AuthContext = {
    userId: u.id,
    name: "Operator",
    email: "operator-uji@example.com",
    grants: await loadGrants(u.id),
  };
  const noGrants: AuthContext = { ...actorA, grants: [] };
  const payrollOnly: AuthContext = { ...actorA, grants: actorA.grants.filter((g) => g.code.startsWith("payroll.")) };

  const FROM = "2039-01-01";
  const TO = "2039-12-31";
  const MISSING = "00000000-0000-4000-8000-000000009999";

  try {
    await db.transaction(async (tx) => {
      /* ----------------------- Payroll fixture ----------------------- */
      await createFiscalYear(
        actorA,
        { code: "UJIFY2039", startDate: "2039-01-01", endDate: "2039-12-31", includeAdjustmentPeriod: false },
        tx,
      );
      const emp = await createEmployee(
        actorA,
        { code: "UJ-WE01", firstName: "Karyawan", lastName: "Worker", email: null, dateJoined: "2039-01-01", status: "active" },
        tx,
      );
      await setCompensation(actorA, { employeeId: emp.id, baseSalary: "8000000", effectiveFrom: "2039-01-01" }, tx);
      const period = await createPeriod(
        actorA,
        { code: "UJ-WPER-203903", name: "Maret 2039", periodStart: "2039-03-01", periodEnd: "2039-03-31" },
        tx,
      );
      await finalizePeriod(actorA, period.id, tx);
      const run = await createRun(actorA, { periodId: period.id }, tx);
      assert("run dibuat berstatus draft", run.status === "draft");

      /* -------- Fase A: payroll.run diklaim & menjalankan calculateRun -------- */
      const jobP = await enqueuePayrollRun(actorA, { runId: run.id }, tx);
      assert("job kalkulasi berstatus antre", jobP.status === "queued" && jobP.type === "payroll.run");

      const ranP = await runNextJob(actorA, tx);
      assert("worker mengklaim job payroll.run", ranP !== null && ranP.id === jobP.id && ranP.type === "payroll.run");
      assert("job kalkulasi sukses", ranP !== null && ranP.status === "succeeded");
      assert("hasil job memuat ringkasan run", ranP !== null && (ranP.result as { runId?: string }).runId === run.id);

      const calculated = await getRun(actorA, run.id, tx);
      assert("run menjadi calculated via worker", calculated.status === "calculated");
      assert("run punya minimal satu karyawan", (calculated.employeeCount ?? 0) >= 1);

      /* -------- Fase B: spesialisasi — worker payroll TIDAK menyentuh ekspor -------- */
      const jobE1 = await enqueueExport(actorA, { reportKey: "trial-balance", query: { from: FROM, to: TO } }, tx);
      assert("job ekspor E1 antre", jobE1.status === "queued");
      const wrongKind = await runNextJob(payrollOnly, tx);
      assert("worker payroll tidak mengklaim job ekspor", wrongKind === null);
      assert("job ekspor E1 masih antre", (await getJob(actorA, jobE1.id, tx)).status === "queued");

      const ranE1 = await runNextJob(actorA, tx);
      assert("worker berhak mengklaim & sukseskan E1", ranE1 !== null && ranE1.id === jobE1.id && ranE1.status === "succeeded");

      /* -------- Fase C: banyak job, satu-satu, tanpa dobel -------- */
      const keys = ["worker-c1", "worker-c2", "worker-c3"];
      const enqIds: string[] = [];
      for (const k of keys) {
        const j = await enqueueExport(
          actorA,
          { reportKey: "trial-balance", query: { from: FROM, to: TO }, idempotencyKey: k },
          tx,
        );
        enqIds.push(j.id);
      }

      const processed: string[] = [];
      for (let i = 0; i < 10; i++) {
        const job = await runNextJob(actorA, tx);
        if (!job) break;
        assert(`siklus worker ke-${i + 1} sukses`, job.status === "succeeded");
        processed.push(job.id);
      }
      assert("tepat tiga job diproses", processed.length === 3);
      assert("tiap job diproses sekali (tak dobel)", new Set(processed).size === 3);
      assert("kumpulan job sama dengan yang diantrkan", keys.every((_, idx) => processed.includes(enqIds[idx])));
      assert("antrean kosong -> tak ada yang diklaim", (await runNextJob(actorA, tx)) === null);

      /* -------- Fase D: gagal -> dead-letter (maxAttempts 1) -------- */
      const jobDL = await enqueueExport(
        actorA,
        { reportKey: "general-ledger", query: { from: FROM, to: TO, accountId: MISSING }, maxAttempts: 1 },
        tx,
      );
      const ranDL = await runNextJob(actorA, tx);
      assert("job gagal menjadi dead-letter", ranDL !== null && ranDL.id === jobDL.id && ranDL.status === "failed");
      assert("alasan kegagalan tercatat", ranDL !== null && typeof ranDL.lastError === "string" && ranDL.lastError.includes("tidak ditemukan"));
      assert("dead-letter tak diambil lagi", (await runNextJob(actorA, tx)) === null);

      /* -------- Fase E: idempotensi + guard izin -------- */
      const jobPAgain = await enqueuePayrollRun(actorA, { runId: run.id }, tx);
      assert("enqueue kalkulasi run sama mengembalikan job sama", jobPAgain.id === jobP.id);
      await expectFail("enqueue kalkulasi tanpa izin", () => enqueuePayrollRun(noGrants, { runId: run.id }, tx));
      await expectFail("worker tanpa izin job apa pun ditolak", () => runNextJob(noGrants, tx));

      /* -------- Sisa: hanya job payroll.run (sukses) & ekspor (gagal) yang tertinggal? -------- */
      const queued = await tx
        .select({ id: jobRuns.id })
        .from(jobRuns)
        .where(eq(jobRuns.status, "queued"));
      assert("tidak ada job antre tersisa", queued.length === 0);

      const succeededCount = await tx
        .select({ id: jobRuns.id })
        .from(jobRuns)
        .where(eq(jobRuns.status, "succeeded"))
        .orderBy(asc(jobRuns.createdAt));
      assert("total job sukses = 5 (1 payroll + 4 ekspor)", succeededCount.length === 5);

      const fy = await tx.select({ code: fiscalYears.code }).from(fiscalYears).where(eq(fiscalYears.code, "UJIFY2039")).limit(1);
      assert("FY uji ada di dalam transaksi", fy[0]?.code === "UJIFY2039");

      throw new Rollback("selesai — rollback");
    });
    throw new Error("Transaksi selesai tanpa rollback — fixture bisa tersimpan!");
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`\n[test-worker] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
  }
}

main();
