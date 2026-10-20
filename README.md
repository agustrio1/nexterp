# ERP — Master Prompt v2

Enterprise Resource Planning modular (multi-cabang, multi-mata-uang,
akuntansi berpasangan, inventory, procurement, sales/CRM, HR/payroll,
aset tetap, proyek, dashboard, asisten AI). Backend Next.js 16 App
Router + PostgreSQL (Neon) + Drizzle ORM + Better Auth + Zod 4.

Stack ringkas: Bun 1.3, TypeScript strict, decimal.js untuk uang
(selalu string), argon2 untuk hash password, ESLint 9, Vitest 5.
Frontend masih tahap awal (lihat `doc.md §15 Track UI`).

## Mulai cepat (development)

```powershell
# 1. Setup env
Copy-Item .env.example .env.local
# Edit .env.local: isi DATABASE_URL, DATABASE_URL_UNPOOLED,
# BETTER_AUTH_SECRET (min 32 char), dan opsional AI_*.

# 2. Install dependensi
bun install

# 3. Terapkan migrasi Skema (membuat seluruh tabel)
bun run db:generate   # hanya bila schema TS berubah
bun run db:migrate

# 4. Seed data awal (role/permission default + singleton settings)
bun run db:seed

# 5. Buat admin pertama (password min 12 karakter)
$env:ADMIN_EMAIL    = "admin@erp.local"
$env:ADMIN_NAME     = "Administrator"
$env:ADMIN_PASSWORD = "Ganti-INI-12-char"
bun run db:create-admin
Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_NAME, Env:ADMIN_PASSWORD

# 6. Jalankan dev server + worker job latar belakang
bun run dev           # terminal A
bun run jobs:worker   # terminal B (untuk ekspor CSV / payroll run)
```

Buka `http://localhost:3000/api/health` — harus `200`.

## Quality gates (sebelum commit & push)

```powershell
bun x tsc --noEmit           # type check — 0 error
bun run lint                 # ESLint — 0 error/warning
bun x vitest run             # unit test murni — semua lulus
```

Test integrasi (rollback-only, tidak menyimpan data):

```powershell
bun run scripts/test-security.ts
bun run scripts/test-jobs-export.ts
bun run scripts/test-ai-assistant.ts
# dst. untuk test-currencies, test-departments, test-fiscal, test-numbering, test-audit-read
```

Semua test integrasi memakai transaksi DB + `throw Rollback` di akhir;
tidak ada penulisan permanen. Lihat `src/db/schema/*` untuk kontrak
DDL dan `src/modules/*/service.ts` untuk aturan bisnis.

## Struktur repo

```
src/
  app/api/**           Route handler Next.js (299 endpoint per Tahap 10C)
  config/env.ts        Validasi env (Zod)
  db/schema/**         Definisi tabel Drizzle (source of truth DDL)
  db/migrations/**     SQL hasil `drizzle-kit generate`
  db/manual/**         Skrip SQL manual (bukan bagian dari `db:migrate`)
  db/seed/**           Seeder data awal
  lib/money.ts         Util decimal.js (format/parse/rounding)
  modules/**           Service layer per domain + Zod schemas
  server/**            Fondasi: auth, actor, audit, db, logger, errors, cursor, csrf, rate-limit, proxy
  proxy.ts             Next 16 Proxy (x-request-id injector, edge)
docs/
  API.md               Kontrak permukaan API + pagination + error codes
  OPERATIONS.md        Runbook operasional (backup Neon, deploy, observability, partisi)
scripts/
  test-*.ts            Test integrasi rollback-only
  worker.ts            Daemon job latar belakang (SKIP LOCKED)
tests/unit/            Vitest — unit test modul murni
doc.md                 MASTER PROMPT v2 + status Tahap 0..10E
```

## Dokumentasi lanjut

- **Permukaan API, pagination, error code** → `docs/API.md`.
- **Backup Neon, restore drill, migrasi partisi, deploy Vercel,
  logging, error tracking, health check, runbook insiden** →
  `docs/OPERATIONS.md`.
- **Riwayat tahapan + keputusan design + status per-butir §18** →
  `doc.md`.

## Aturan kerja (ringkas dari MASTER PROMPT §17)

- Tidak ada `any` sembarangan; uang selalu string decimal; tidak ada
  dummy data; tidak ada endpoint tanpa validasi Zod.
- Setiap perubahan skema harus lewat `drizzle-kit generate` + review
  SQL manual; migrasi bersifat satu-arah (tidak ada `down` otomatis).
- Perintah menyentuh DB writing (`db:migrate`, `db:seed`, `psql -c
  "UPDATE ..."`, `DROP`) **memerlukan persetujuan eksplisit user**
  sebelum dijalankan.
- Fitur UI tidak dianggap selesai sebelum aksi terkait teruji lewat
  endpoint API + audit log.

## Status Tahap (per 10E)

Lihat tabel di `doc.md §15`. Ringkasan: Tahap 0–10E selesai; Track
UI (U1–U6) menyusul paralel dengan review produk.
