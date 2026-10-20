/**
 * Runner untuk eksekusi skrip SQL manual (mis. partisi audit_logs).
 * Memakai `pg.Client` langsung (satu koneksi, tanpa pool) agar seluruh
 * isi file dieksekusi dalam satu sesi — mendukung DO block + multi-statement.
 *
 * Pemakaian:
 *   bun run scripts/run-sql.ts src/db/manual/audit_logs_monthly_partition.sql
 *
 * Prasyarat: DATABASE_URL_UNPOOLED ter-set di .env.local.
 */
import { Client } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const filePath = process.argv[2];
if (!filePath) {
  console.error("Gunakan: bun run scripts/run-sql.ts <path-ke-file.sql>");
  process.exit(1);
}

const absolute = resolve(process.cwd(), filePath);
const sql = readFileSync(absolute, "utf8");

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) {
  console.error("DATABASE_URL_UNPOOLED belum diset di .env.local");
  process.exit(1);
}

const client = new Client({ connectionString, ssl: true });

async function main(): Promise<void> {
  await client.connect();
  console.log(`[run-sql] Terhubung ke database.`);
  console.log(`[run-sql] Mengeksekusi: ${filePath} (${sql.length} byte)`);
  try {
    await client.query(sql);
    console.log(`[run-sql] ✅ Eksekusi selesai tanpa error.`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[run-sql] ❌ Gagal: ${message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
