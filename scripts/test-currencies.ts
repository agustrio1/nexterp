import { users } from "@/db/schema";
import {
  createCurrency,
  createExchangeRate,
  getCurrency,
  listCurrencies,
  listExchangeRates,
  updateCurrency,
} from "@/modules/organization/currency-service";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/** Skrip uji sementara untuk 3H-2. Boleh dihapus setelah semua hasil sesuai. */

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

  const list = await listCurrencies(actor);
  console.log("mata uang", list.map((c) => `${c.code}:${c.isBase}`).join(","));

  const jpy = await createCurrency(actor, { code: "JPY", name: "Yen", symbol: "¥", decimals: 0 });
  console.log("buat", jpy.code, jpy.decimals, jpy.isActive);
  await expectError("duplikat", () =>
    createCurrency(actor, { code: "JPY", name: "Lain", decimals: 2 }),
  );

  const renamed = await updateCurrency(actor, "jpy", { name: "Yen Jepang" });
  console.log("ubah nama", renamed.name);
  const same = await updateCurrency(actor, "JPY", { name: "Yen Jepang" });
  console.log("tanpa perubahan", same.updatedAt.getTime() === renamed.updatedAt.getTime());

  await expectError("nonaktifkan dasar", () => updateCurrency(actor, "IDR", { isActive: false }));
  await expectError("desimal dasar", () => updateCurrency(actor, "IDR", { decimals: 0 }));

  const r1 = await createExchangeRate(actor, {
    fromCurrency: "USD",
    rateDate: "2027-01-05",
    rate: "16250.5",
    source: "uji",
  });
  console.log("kurs", r1.fromCurrency, r1.toCurrency, r1.rateDate, r1.rate);
  await expectError("kurs ganda", () =>
    createExchangeRate(actor, { fromCurrency: "USD", rateDate: "2027-01-05", rate: "16300" }),
  );
  await expectError("kurs dasar", () =>
    createExchangeRate(actor, { fromCurrency: "IDR", rateDate: "2027-01-05", rate: "1" }),
  );
  await expectError("kurs tak dikenal", () =>
    createExchangeRate(actor, { fromCurrency: "ZZZ", rateDate: "2027-01-05", rate: "1" }),
  );

  await updateCurrency(actor, "JPY", { isActive: false });
  await expectError("kurs nonaktif", () =>
    createExchangeRate(actor, { fromCurrency: "JPY", rateDate: "2027-01-05", rate: "110" }),
  );
  await updateCurrency(actor, "JPY", { isActive: true });

  await createExchangeRate(actor, { fromCurrency: "USD", rateDate: "2027-01-06", rate: "16300" });
  const rates = await listExchangeRates(actor, { fromCurrency: "USD", page: 1, pageSize: 20 });
  console.log("daftar kurs USD", rates.total, rates.items.map((r) => r.rateDate).join(","));

  const ranged = await listExchangeRates(actor, { dateFrom: "2027-01-06", page: 1, pageSize: 20 });
  console.log("filter tanggal", ranged.total);

  await expectError("izin", () => listCurrencies({ ...actor, grants: [] }));
  await expectError("tak ada", () => getCurrency(actor, "ZZZ"));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-currencies] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });