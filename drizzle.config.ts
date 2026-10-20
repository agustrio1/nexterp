import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Drizzle Kit tidak membaca .env.local sendiri, jadi dimuat dengan loader bawaan Next.js.
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL_UNPOOLED;

if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED belum diset. Migrasi harus memakai koneksi direct (tanpa pooler) dari Neon.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./src/db/migrations",
  dbCredentials: { url },
  casing: "snake_case",
  strict: true,
  verbose: true,
});