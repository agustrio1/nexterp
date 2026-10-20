import { eq, sql } from "drizzle-orm";

import { approvalRequests, roles, userRoles, users } from "@/db/schema";
import {
  actOnApproval,
  cancelApproval,
  createApprovalWorkflow,
  getApprovalRequest,
  listApprovalRequests,
  submitApproval,
  updateApprovalWorkflow,
} from "@/modules/core/approval-service";
import type { Grant, AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 3J (mesin alur persetujuan).
 *
 * Semua operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data yang tersimpan. Tidak perlu persetujuan
 * Bagian 2.2 karena tidak ada commit.
 *
 * Catatan: trigger DB 0007 (imutabilitas status final + append-only actions)
 * BELUM diterapkan di DB ini (migration hanya ditulis, belum dijalankan). Uji
 * pemicu DB dibuat informatif; aturan service dan constraint bawaan 0002
 * (unique pending, unique step+actor, approver XOR, rentang amount) diuji ketat.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

async function expectError(label: string, tx: Tx, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint sp_err`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_err`);
    console.log(label, "GAGAL: seharusnya ditolak");
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_err`);
    const e = error as { code?: string; message?: string };
    console.log(label, e.code ?? "-", "|", e.message ?? String(error));
  }
}

/** Cek informatif (bukan assertion): melaporkan apakah operasi ditolak atau tidak. */
async function probe(label: string, tx: Tx, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint sp_probe`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_probe`);
    console.log(label, "| diterima");
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_probe`);
    const e = error as { code?: string; message?: string };
    console.log(label, "| ditolak:", e.message ?? String(error));
  }
}

function actorWith(userId: string, codes: string[]): AuthContext {
  const grants: Grant[] = codes.map((code) => ({ code, branchId: null }));
  return { userId, name: "Uji", email: "uji@example.com", grants };
}

async function main() {
  const [admin] = await db.select({ id: users.id }).from(users).limit(1);
  if (!admin) throw new Error("Belum ada pengguna (admin).");

  const manage = actorWith(admin.id, ["core.approval_workflows.manage", "core.approval_workflows.read"]);

  try {
    await db.transaction(async (tx) => {
      /* ===== Setup: aktor sementara (requester, approver user, approver role) ===== */
      const [uReq] = await tx
        .insert(users)
        .values({ name: "Pengaju", email: "pengaju.uji@example.com" })
        .returning({ id: users.id });
      const [uUsr] = await tx
        .insert(users)
        .values({ name: "Approver User", email: "approver-user.uji@example.com" })
        .returning({ id: users.id });
      const [uRole] = await tx
        .insert(users)
        .values({ name: "Approver Role", email: "approver-role.uji@example.com" })
        .returning({ id: users.id });
      const [uLain] = await tx
        .insert(users)
        .values({ name: "Bukan Approver", email: "bukan-approver.uji@example.com" })
        .returning({ id: users.id });
      const [role1] = await tx
        .insert(roles)
        .values({ code: "uji_approver", name: "Approver Uji" })
        .returning({ id: roles.id });

      // uRole memegang role1 secara global (branchId null).
      await tx.insert(userRoles).values({ userId: uRole.id, roleId: role1.id, branchId: null });

      const requester = actorWith(uReq.id, ["core.approvals.request", "core.approvals.read", "core.approvals.cancel"]);
      const approverUser = actorWith(uUsr.id, ["core.approvals.act", "core.approvals.read"]);
      const approverRole = actorWith(uRole.id, ["core.approvals.act", "core.approvals.read"]);
      const bystander = actorWith(uLain.id, ["core.approvals.act", "core.approvals.read"]);

      const doc = () => crypto.randomUUID();

      /* ===== W-A: 2 langkah (user lalu role) — happy path multi-step ===== */
      const wfA = await createApprovalWorkflow(
        manage,
        {
          docType: "test.po.multi",
          name: "Alur multi langkah",
          isActive: true,
          steps: [{ approverUserId: uUsr.id }, { approverRoleId: role1.id }],
        },
        tx,
      );
      console.log("wfA langkah:", wfA.steps.map((s) => s.stepNo).join(","));

      // Validasi: langkah harus menunjuk tepat satu approver (Zod di rute; di service lolos) —
      // cek approver tak ada ditolak service.
      await expectError("create wf approver role tak ada", tx, () =>
        createApprovalWorkflow(
          manage,
          { docType: "test.po.bad", name: "Bad", isActive: true, steps: [{ approverRoleId: doc() }] },
          tx,
        ),
      );

      const reqA = await submitApproval(requester, { docType: "test.po.multi", docId: doc(), amount: "2000.00" }, tx);
      console.log("submit A", reqA.status, "langkah", reqA.workflow.steps.length);

      // SoD: pengaju tidak boleh menindak.
      await expectError("SoD pengaju menyetujui sendiri", tx, () =>
        actOnApproval({ ...requester, grants: [...requester.grants, { code: "core.approvals.act", branchId: null }] }, reqA.id, { action: "approve" }, tx),
      );

      // Bukan approver langkah aktif.
      await expectError("bystander approve step1", tx, () => actOnApproval(bystander, reqA.id, { action: "approve" }, tx));

      // Approver user approve step1 -> maju ke step2 (tetap pending).
      const a1 = await actOnApproval(approverUser, reqA.id, { action: "approve", note: "OK level 1" }, tx);
      console.log("setelah approve step1", a1.request.status, "step", a1.request.currentStep);

      // Approver user bukan approver step2 (role) -> forbidden.
      await expectError("approver user approve step2", tx, () =>
        actOnApproval(approverUser, reqA.id, { action: "approve" }, tx),
      );

      // Pemegang role approve step2 (langkah terakhir) -> approved.
      const a2 = await actOnApproval(approverRole, reqA.id, { action: "approve", note: "OK level 2" }, tx);
      console.log("setelah approve step2", a2.request.status, "completedAt?", !!a2.request.completedAt);

      // Tindak lagi setelah final -> businessRule.
      await expectError("act setelah approved", tx, () => actOnApproval(approverRole, reqA.id, { action: "approve" }, tx));

      /* ===== W-B: tolak (reject) langsung final ===== */
      await createApprovalWorkflow(
        manage,
        { docType: "test.po.reject", name: "Alur satu langkah", isActive: true, steps: [{ approverRoleId: role1.id }] },
        tx,
      );
      const reqB = await submitApproval(requester, { docType: "test.po.reject", docId: doc() }, tx);
      const rejected = await actOnApproval(approverRole, reqB.id, { action: "reject", note: "Tidak layak" }, tx);
      console.log("reject", rejected.request.status, "completedAt?", !!rejected.request.completedAt);

      /* ===== W-C: pengajuan ganda dokumen sama -> conflict ===== */
      const docC = doc();
      await submitApproval(requester, { docType: "test.po.reject", docId: docC }, tx);
      await expectError("submit ganda dokumen sama", tx, () =>
        submitApproval(requester, { docType: "test.po.reject", docId: docC }, tx),
      );

      /* ===== W-D: pembatalan oleh pengaju ===== */
      const reqD = await submitApproval(requester, { docType: "test.po.reject", docId: doc() }, tx);
      const cancelled = await cancelApproval(requester, reqD.id, { reason: "Salah ajukan" }, tx);
      console.log("cancel", cancelled.status, "completedAt?", !!cancelled.completedAt);
      await expectError("act setelah cancelled", tx, () => actOnApproval(approverRole, reqD.id, { action: "approve" }, tx));

      /* ===== W-E: pencocokan rentang amount ===== */
      await createApprovalWorkflow(
        manage,
        { docType: "test.po.bounded", name: "Kecil", isActive: true, minAmount: "0.00", maxAmount: "5000.00", steps: [{ approverUserId: uUsr.id }] },
        tx,
      );
      await createApprovalWorkflow(
        manage,
        { docType: "test.po.bounded", name: "Besar", isActive: true, minAmount: "5000.01", maxAmount: "99999.00", steps: [{ approverUserId: uUsr.id }] },
        tx,
      );
      const reqE1 = await submitApproval(requester, { docType: "test.po.bounded", docId: doc(), amount: "3000.00" }, tx);
      const reqE2 = await submitApproval(requester, { docType: "test.po.bounded", docId: doc(), amount: "8000.00" }, tx);
      console.log("bounded pilih", reqE1.workflow.name, "vs", reqE2.workflow.name);
      // Tanpa amount -> kedua alur berbatas gagal dievaluasi -> tidak ada yang cocok.
      await expectError("bounded tanpa amount", tx, () =>
        submitApproval(requester, { docType: "test.po.bounded", docId: doc() }, tx),
      );

      /* ===== W-F: ambiguitas dua alur tanpa batas -> conflict ===== */
      await createApprovalWorkflow(
        manage,
        { docType: "test.po.ambig", name: "Dup A", isActive: true, steps: [{ approverUserId: uUsr.id }] },
        tx,
      );
      await createApprovalWorkflow(
        manage,
        { docType: "test.po.ambig", name: "Dup B", isActive: true, steps: [{ approverRoleId: role1.id }] },
        tx,
      );
      await expectError("dua alur cocok -> ambigu", tx, () =>
        submitApproval(requester, { docType: "test.po.ambig", docId: doc() }, tx),
      );

      /* ===== W-G: tidak ada alur untuk docType -> businessRule ===== */
      await expectError("docType tanpa alur", tx, () =>
        submitApproval(requester, { docType: "test.po.tiada", docId: doc() }, tx),
      );

      /* ===== Update alur: ganti langkah + toggle isActive ===== */
      const upd = await updateApprovalWorkflow(
        manage,
        wfA.id,
        { name: "Alur multi (direvisi)", steps: [{ approverUserId: uRole.id }] },
        tx,
      );
      console.log("update wfA langkah", upd.steps.length, "nama", upd.name);

      /* ===== minAmount > maxAmount -> ditolak ===== */
      await expectError("min > max", tx, () =>
        createApprovalWorkflow(
          manage,
          { docType: "test.po.minmax", name: "Bad range", isActive: true, minAmount: "9000.00", maxAmount: "1000.00", steps: [{ approverUserId: uUsr.id }] },
          tx,
        ),
      );

      /* ===== list + forMe + get ===== */
      const reqForMe = await submitApproval(requester, { docType: "test.po.reject", docId: doc() }, tx);
      const mine = await listApprovalRequests(approverRole, { status: "pending", forMe: true }, tx);
      const all = await listApprovalRequests(requester, { docType: "test.po.reject" }, tx);
      console.log("forMe(role)", mine.items.length, "list reject", all.items.length);
      const detail = await getApprovalRequest(approverRole, reqForMe.id, tx);
      console.log("detail", detail.status, "actions", detail.actions.length, "steps", detail.steps.length);

      /* ===== Permission gate ===== */
      await expectError("submit tanpa izin request", tx, () =>
        submitApproval(actorWith(uUsr.id, []), { docType: "test.po.reject", docId: doc() }, tx),
      );
      await expectError("create wf tanpa izin manage", tx, () =>
        createApprovalWorkflow(
          actorWith(uUsr.id, ["core.approval_workflows.read"]),
          { docType: "test.po.perm", name: "X", isActive: true, steps: [{ approverUserId: uUsr.id }] },
          tx,
        ),
      );

      /* ===== Informatif: perilaku DB guard 0007 (aktif hanya setelah migrate) ===== */
      await probe("DB: UPDATE status final reqA (butuh 0007 untuk ditolak)", tx, async () => {
        await tx
          .update(approvalRequests)
          .set({ status: "pending", updatedAt: new Date() })
          .where(eq(approvalRequests.id, reqA.id));
      });

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log("[test-approvals] rollback OK — tidak ada data tersimpan di DB.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-approvals] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
