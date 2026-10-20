import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Konfigurasi Vitest untuk unit test murni (Tahap 10A).
 * - Hanya memuat file di `tests/unit/**` — skrip integrasi rollback di `scripts/`
 *   tetap dijalankan terpisah (`bun run scripts/test-*.ts`), tidak lewat sini.
 * - Environment default `node` (tidak perlu DOM untuk fungsi murni).
 * - Alias `@/` mengikuti tsconfig.
 * - Tidak memakai plugin React/Next — unit test di 10A tidak menyentuh komponen.
 * - `pool: "forks"` default; `isolate: true` menjaga test antar-file independen.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    isolate: true,
    // SKIP_ENV_VALIDATION -> `@/config/env` mengembalikan process.env tanpa validasi zod.
    // Unit test 10A tidak menjalankan query; pg Pool di `@/server/db` cukup di-import
    // tanpa koneksi nyata (lazy connect pada query pertama).
    env: {
      SKIP_ENV_VALIDATION: "1",
      NODE_ENV: "test",
      APP_URL: "http://localhost:3000",
    },
  },
});
