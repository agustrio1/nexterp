import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env, isProduction } from "@/config/env";
import * as schema from "@/db/schema";

/**
 * Satu Pool per proses. Disimpan di globalThis agar tidak membuat koneksi baru
 * pada setiap hot reload (development) maupun pada instance serverless yang dipakai ulang.
 */
const globalForDb = globalThis as unknown as { __erpPool?: Pool };

const pool =
  globalForDb.__erpPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    // Kecil dan sengaja: PgBouncer milik Neon yang menangani konkurensi.
    max: isProduction ? 5 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

pool.on("error", (error) => {
  // Error pada koneksi idle tidak boleh menjatuhkan proses.
  console.error("[db] Error pada koneksi idle:", error.message);
});

globalForDb.__erpPool = pool;

export const db = drizzle({ client: pool, schema, casing: "snake_case" });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Dapat berupa db biasa atau transaksi; dipakai oleh repository agar bisa ikut transaksi pemanggil. */
export type DbExecutor = Database | Transaction;