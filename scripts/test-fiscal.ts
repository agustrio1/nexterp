import { users } from "@/db/schema";
import {
  changePeriodStatus,
  createFiscalYear,
  getFiscalYear,
  listFiscalYears,
} from "@/modules/organization/fiscal-service";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/** Skrip uji sementara untuk 3H-4. Boleh dihapus setelah semua hasil sesuai. */

async function expectError(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(label, "GAGAL: seharusnya ditolak");
  } catch (error) {
    const e = error as { code?: string; message?: string };
    console.log(label, e.code, "|", e.message);
  }
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
  const fake = "00000000-0000-4000-8000-000000000000";

  const fy = await createFiscalYear(actor, {
    code: "FY2030",
    startDate: "2030-01-01",
    endDate: "2030-12-31",
    includeAdjustmentPeriod: true,
  });
  const p = fy.periods;
  console.log(
    "buat",
    fy.code,
    fy.status,
    p.length,
    `${p[0]?.startDate}..${p[0]?.endDate}`,
    p[1]?.endDate,
    `${p[12]?.startDate}..${p[12]?.endDate}`,
  );

  await expectError("duplikat", () =>
    createFiscalYear(actor, {
      code: "FY2030",
      startDate: "2032-01-01",
      endDate: "2032-12-31",
      includeAdjustmentPeriod: false,
    }),
  );
  await expectError("tumpang tindih", () =>
    createFiscalYear(actor, {
      code: "FY2030B",
      startDate: "2030-06-01",
      endDate: "2031-05-31",
      includeAdjustmentPeriod: false,
    }),
  );

  const fy2 = await createFiscalYear(actor, {
    code: "FY2031",
    startDate: "2031-01-01",
    endDate: "2031-06-30",
    includeAdjustmentPeriod: false,
  });
  console.log("buat", fy2.code, fy2.periods.length, fy2.periods[5]?.endDate);

  console.log("daftar", (await listFiscalYears(actor)).map((y) => y.code).join(","));

  const id = (no: number) => {
    const period = p[no - 1];
    if (!period) throw new Error(`Periode ${no} tidak ada`);
    return period.id;
  };

  await expectError("urutan tutup", () =>
    changePeriodStatus(actor, id(2), { status: "soft_closed" }),
  );
  console.log("p1", (await changePeriodStatus(actor, id(1), { status: "soft_closed" })).status);
  console.log("p2", (await changePeriodStatus(actor, id(2), { status: "soft_closed" })).status);
  console.log("p1", (await changePeriodStatus(actor, id(1), { status: "closed" })).status);

  await expectError("tutup lompat", () => changePeriodStatus(actor, id(3), { status: "closed" }));
  await expectError("buka tanpa alasan", () =>
    changePeriodStatus(actor, id(1), { status: "open" }),
  );
  await expectError("buka p1 saat p2 tertutup", () =>
    changePeriodStatus(actor, id(1), { status: "open", reason: "Koreksi saldo awal" }),
  );

  const withoutReopen = actor.grants.filter((g) => g.code !== "core.periods.reopen");
  await expectError("tanpa izin buka", () =>
    changePeriodStatus({ ...actor, grants: withoutReopen }, id(1), {
      status: "open",
      reason: "Koreksi saldo awal",
    }),
  );
  await expectError("tanpa izin sama sekali", () =>
    changePeriodStatus({ ...actor, grants: [] }, id(1), { status: "open", reason: "Koreksi" }),
  );

  console.log(
    "buka p2",
    (await changePeriodStatus(actor, id(2), { status: "open", reason: "Koreksi jurnal" })).status,
  );
  console.log(
    "buka p1",
    (await changePeriodStatus(actor, id(1), { status: "open", reason: "Koreksi saldo awal" }))
      .status,
  );
  console.log("status sama", (await changePeriodStatus(actor, id(1), { status: "open" })).status);

  await expectError("periode tak ada", () => changePeriodStatus(actor, fake, { status: "closed" }));
  console.log("detail", fy.code, (await getFiscalYear(actor, fy.id)).periods.length);
  await expectError("tahun tak ada", () => getFiscalYear(actor, fake));
  await expectError("izin", () => listFiscalYears({ ...actor, grants: [] }));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-fiscal] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });