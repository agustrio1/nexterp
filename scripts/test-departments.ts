import { eq } from "drizzle-orm";

import { branches, users } from "@/db/schema";
import { updateBranch } from "@/modules/organization/branch-service";
import {
  createDepartment,
  getDepartment,
  listDepartments,
  updateDepartment,
} from "@/modules/organization/department-service";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/** Skrip uji sementara untuk 3G-6. Boleh dihapus setelah semua hasil sesuai. */

async function expectError(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(label, "GAGAL: seharusnya ditolak");
  } catch (error) {
    const e = error as { code?: string; message?: string };
    console.log(label, e.code, "|", e.message);
  }
}

async function branchId(code: string): Promise<string> {
  const [row] = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, code));
  if (!row) throw new Error(`Cabang ${code} belum ada. Buat dulu lewat POST /api/branches.`);
  return row.id;
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const actor = {
    userId: u.id,
    name: "Uji",
    email: "uji@example.com",
    grants: await loadGrants(u.id),
  };
  const jkt = await branchId("JKT-01");
  const sby = await branchId("SBY-01");
  const fake = "00000000-0000-4000-8000-000000000000";

  const keu = await createDepartment(actor, { code: "KEU", name: "Keuangan", branchId: jkt });
  console.log("buat", keu.code, keu.branchId === jkt, keu.parentId);

  await expectError("duplikat", () => createDepartment(actor, { code: "KEU", name: "Lain" }));
  await expectError("beda cabang", () =>
    createDepartment(actor, { code: "AKT", name: "Akuntansi", parentId: keu.id, branchId: sby }),
  );

  const akt = await createDepartment(actor, {
    code: "AKT",
    name: "Akuntansi",
    parentId: keu.id,
    branchId: jkt,
  });
  console.log("anak", akt.parentId === keu.id);

  await expectError("induk tak ada", () =>
    createDepartment(actor, { code: "XXX", name: "X", parentId: fake }),
  );

  const pjk = await createDepartment(actor, { code: "PJK", name: "Pajak" });
  console.log("perusahaan", pjk.branchId);
  const gdg = await createDepartment(actor, {
    code: "GDG",
    name: "Gudang",
    parentId: pjk.id,
    branchId: sby,
  });
  console.log("gudang", gdg.branchId === sby);

  await expectError("siklus", () => updateDepartment(actor, keu.id, { parentId: akt.id }));
  await expectError("diri sendiri", () => updateDepartment(actor, keu.id, { parentId: keu.id }));
  await expectError("ubah cabang ber-anak", () => updateDepartment(actor, keu.id, { branchId: sby }));
  await expectError("nonaktif induk", () => updateDepartment(actor, keu.id, { isActive: false }));

  const aktOff = await updateDepartment(actor, akt.id, { isActive: false });
  const keuOff = await updateDepartment(actor, keu.id, { isActive: false });
  console.log("nonaktif anak lalu induk", aktOff.isActive, keuOff.isActive);

  await expectError("anak aktif saat induk nonaktif", () =>
    updateDepartment(actor, akt.id, { isActive: true }),
  );

  const keuOn = await updateDepartment(actor, keu.id, { isActive: true });
  const aktOn = await updateDepartment(actor, akt.id, { isActive: true });
  console.log("aktif lagi", keuOn.isActive, aktOn.isActive);

  await expectError("pindah induk beda cabang", () =>
    updateDepartment(actor, gdg.id, { parentId: keu.id }),
  );

  const moved = await updateDepartment(actor, gdg.id, { parentId: keu.id, branchId: jkt });
  console.log("pindah", moved.parentId === keu.id, moved.branchId === jkt);

  const same = await updateDepartment(actor, gdg.id, { name: "Gudang" });
  console.log("tanpa perubahan", same.updatedAt.getTime() === moved.updatedAt.getTime());

  await updateBranch(actor, sby, { isActive: false });
  await expectError("cabang nonaktif", () =>
    createDepartment(actor, { code: "ZZZ", name: "Z", branchId: sby }),
  );
  await updateBranch(actor, sby, { isActive: true });

  console.log("daftar", (await listDepartments(actor)).map((d) => d.code).join(","));
  console.log(
    "daftar JKT",
    (await listDepartments(actor, { branchId: jkt })).map((d) => d.code).join(","),
  );
  console.log("nonaktif", (await listDepartments(actor, { isActive: false })).length);

  await expectError("izin", () => listDepartments({ ...actor, grants: [] }));
  await expectError("tak ada", () => getDepartment(actor, fake));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-departments] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });