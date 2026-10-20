# Operasional ERP (Tahap 10D/10E)

Cakupan: backup & restore Neon, rollback migrasi, deployment Vercel,
observability (logging, error tracking, health check), runbook insiden
umum. Semua perintah diasumsikan dijalankan dari root repo dengan
PowerShell sebagai shell (`;` bukan `&&`); operator wajib memakai
`.env.local` yang benar sebelum menyentuh produksi.

Dok ini TIDAK memuat secret. Nilai secret hanya dirujuk lewat nama
variabel environment.

---

## 1. Environment & Konfigurasi

### 1.1 Variabel wajib (lihat `src/config/env.ts`)

| Variabel | Wajib | Produksi | Fungsi |
|---|---|---|---|
| `NODE_ENV` | default `development` | `production` | Menonaktifkan debug paths. |
| `APP_URL` | no (default localhost) | URL publik Vercel | Dasar redirect Better Auth + CSRF origin. |
| `APP_TIMEZONE` | no (default `Asia/Jakarta`) | `Asia/Jakarta` | Interpretasi tanggal fiskal/periode. |
| `DATABASE_URL` | **ya** | Neon pooled | Runtime app (`-pooler.` host). |
| `DATABASE_URL_UNPOOLED` | untuk migrasi | Neon direct | Drizzle Kit (`ep-xxx.` host tanpa `-pooler`). |
| `BETTER_AUTH_SECRET` | **ya** (>= 32 char) | hasil `openssl rand -base64 32` | Signing cookie + token reset. |
| `AI_ENABLED` | no (default `false`) | sesuai kebutuhan | Gerbang modul AI (Tahap 9). |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | opsional | — | Provider AI aktif. |
| `LOG_LEVEL` | no (default `info`) | `info`/`warn` | Ambang log terendah (10D). |
| `ERROR_REPORTER` | no (default `none`) | `none` atau `sentry` | Pasang reporter eksternal (10D). |
| `SENTRY_DSN` | bila `ERROR_REPORTER=sentry` | — | DSN Sentry (belum terpasang SDK; lihat §4.2). |

`SKIP_ENV_VALIDATION=1` hanya untuk build/CI tanpa env lengkap; JANGAN
dipakai di runtime produksi karena akan menyembunyikan konfigurasi rusak.

### 1.2 Matriks environment Vercel

| Key | Preview (branch) | Production | Catatan |
|---|---|---|---|
| `NODE_ENV` | tidak diset (Vercel isi `production` saat build) | `production` | Jangan override manual. |
| `APP_URL` | `https://<branch>.vercel.app` | `https://<domain-resmi>` | Set per-project, bukan per-env global. |
| `DATABASE_URL` | Neon branch preview | Neon production | Branch Neon punya `?sslmode=require` sendiri. |
| `DATABASE_URL_UNPOOLED` | Neon branch direct | Neon production direct | Hanya dipakai saat `drizzle-kit migrate`. |
| `BETTER_AUTH_SECRET` | secret preview | secret production | ROTASI tiap 90 hari; jangan dipakai ulang. |
| `AI_ENABLED` | `false` kecuali QA AI | sesuai keputusan | Matikan di preview untuk hemat kuota. |
| `LOG_LEVEL` | `debug` untuk debugging preview | `info` | Jangan `debug` di prod (PII berisiko terekspos). |
| `ERROR_REPORTER` | `none` | `sentry` bila SDK dipasang | — |

**Prosedur rotasi `BETTER_AUTH_SECRET`**: (1) generate baru; (2) update
di Vercel Production + Preview; (3) redeploy; (4) semua sesi aktif
terputus — pengguna harus login ulang. Lakukan di luar jam kerja.

---

## 2. Backup & Restore (Neon)

### 2.1 Model backup

Neon menyediakan tiga lapis; ERP ini mengandalkan kombinasi:

1. **Point-in-time recovery (PITR) bawaan Neon** — retention default
   7–14 hari pada plan Launch/Scale. Mengaktifkan: Neon Console →
   Project → Branch → Restore.
2. **Snapshot manual (branch)** — sebelum migrasi besar (mis. partisi
   `audit_logs` di §5), buat branch:
   `neon branches create --parent main --name pre-migrasi-<date>`.
3. **Logical dump (`pg_dump`)** — bulanan untuk archivability eksternal
   + uji restore. Perintah standar:

   ```powershell
   $env:PGPASSWORD = Read-Host "Neon password" -AsSecureString
   bunx --bun pg-dump-compat `
     --host "$($env:DATABASE_URL_UNPOOLED -replace '.*@([^:]+):.*','$1')" `
     --username "<user>" --dbname "<db>" `
     --format=custom --file="backup/erp-$(Get-Date -Format yyyyMMdd-HHmm).dump"
   ```

   Catatan: `pg_dump` Neon harus memakai host **unpooled** karena
   pooled connection (PgBouncer transaction mode) menolak sesi panjang.

### 2.2 Restore drill (WAJIB diuji tiap kuartal)

Restore tanpa latihan = bukan backup. Prosedur drill:

1. Buat branch isolasi Neon dari PITR timestamp `T-1h`.
2. Dapatkan `DATABASE_URL_UNPOOLED_RESTORE` branch tersebut.
3. Deploy instance Vercel preview ke URL privat, arahkan ke branch itu.
4. Verifikasi tiga query kritis:
   - `SELECT count(*) FROM audit_logs WHERE at >= now() - interval '1 day';`
   - `SELECT count(*) FROM journal_entries WHERE status='posted' AND entry_date >= current_date - 7;`
   - `SELECT * FROM company_settings LIMIT 1;`
5. Verifikasi alur UI: login admin, buka laporan saldo, buat jurnal dummy
   → rollback via `bun run scripts/test-*.ts`.
6. Catat tanggal, hasil, durasi di log insiden.
7. Hapus branch restore.

### 2.3 Restore penuh (disaster)

- Bila Neon project hilang total: provision project baru, jalankan
  `pg_restore` dari dump custom terakhir + replay migrasi Drizzle dari
  `0000` sampai HEAD (`bun run db:migrate`).
- Update `DATABASE_URL` / `DATABASE_URL_UNPOOLED` di Vercel; redeploy.
- Estimasi RTO: 2–4 jam (tergantung plan Neon + ukuran dump). RPO:
  sebesar interval dump terakhir (default: 1 bulan → **kurangi jadi
  1 minggu** dengan cron mingguan).

---

## 3. Migrasi & Rollback

### 3.1 Apply migrasi (rutinitas)

```powershell
bun run db:generate           # hanya bila schema TS berubah
bun run db:migrate            # apply SQL ke DATABASE_URL_UNPOOLED
```

**Aturan** (Master Prompt §17): perintah `db:migrate` di produksi
memerlukan persetujuan eksplisit operator. Simpan keluaran terminal
utuh (`Tee-Object -FilePath logs/migrate-<date>.txt`).

### 3.2 Rollback

Drizzle Kit tidak menghasilkan `down` otomatis. Strategi:

1. **Prefer**: restore PITR Neon ke timestamp sebelum migrasi
   (§2.1 langkah 1). Cepat, tanpa SQL tulis-balik.
2. **Alternatif manual**: tulis SQL `DROP`/`ALTER` kebalikan pada
   branch Neon preview, uji, lalu apply ke produksi melalui
   `psql "$DATABASE_URL_UNPOOLED" -f rollback.sql`.
3. **Never**: edit `src/db/migrations/meta/_journal.json` manual —
   konsistensi hash Drizzle rusak.

### 3.3 Migrasi khusus Tahap 10C (partisi `audit_logs`)

Berkas: `src/db/manual/audit_logs_monthly_partition.sql`. Status:
**siap-jalankan tetapi TIDAK dieksekusi pada Tahap 10C**.

Prasyarat sebelum menjalankan:
- Backup PITR Neon aktif + restore drill terakhir lulus (§2.2).
- Snapshot branch manual (`pre-partisi-audit-<date>`).
- Tidak ada sesi writer ke `audit_logs` (pause worker jobs bila perlu).
- Eksekusi via `psql` dengan `-v ON_ERROR_STOP=1`:

  ```powershell
  psql "$env:DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 `
    -f src/db/manual/audit_logs_monthly_partition.sql
  ```

Pasca-eksekusi (WAJIB):
- `SELECT count(*) FROM audit_logs_default;` — harus 0 atau kecil.
- `SELECT relname FROM pg_class WHERE relname LIKE 'audit_logs_%' ORDER BY relname;` — daftar partisi bulanan terlihat.
- Pasang cron/pagerutyang memanggil `SELECT erp_audit_create_next_partition(2);` tiap awal bulan. Bisa via `pg_cron` Neon:
  ```sql
  SELECT cron.schedule('audit-partition-extend', '0 3 25 * *',
                       $$SELECT erp_audit_create_next_partition(2)$$);
  ```
- Retensi 7 tahun: tiap kwartal jalankan `ALTER TABLE audit_logs DETACH PARTITION audit_logs_YYYY_MM; DROP TABLE audit_logs_YYYY_MM;` untuk partisi terlama.

Rollback partisi: restore branch PITR/snapshot. Jangan coba `RENAME`
mundur — data sudah tersebar ke partition children.

---

## 4. Observability

### 4.1 Structured logging

Implementasi: `src/server/logger.ts` + `src/server/request-context.ts`
+ `src/proxy.ts`. Kontrak:

- Format: JSON per baris (`{"level":"info","msg":"request completed","requestId":"...","userId":"...","method":"GET","path":"/api/jobs","durationMs":12,"status":200}`).
- `error` ditulis ke **stderr**; `debug|info|warn` ke **stdout**.
- Setiap request API Node Handler menjalankan `runWithRequestContext(...)`
  — log otomatis di-merge `requestId`/`method`/`path`/`userId`/`startedAt`.
- `X-Request-Id` disuntikkan/di-generate di `src/proxy.ts` (Edge), lalu
  header yang sama dikembalikan pada response. Klien dapat mengirim
  `X-Request-Id` sendiri; server menolak karakter di luar `[A-Za-z0-9._-]`
  dan memotong ke 128 char.
- Ambang: `LOG_LEVEL=debug` di development, `info` di production,
  naikkan sementara ke `debug` hanya untuk investigasi spesifik
  (PII bisa ikut keluar — batasi durasi).

**Redaman otomatis** — payload sensitif (kolom `password`, `secret`,
`token`, `authorization`, `cookie`, API key) disaring oleh
`src/server/redact.ts` sebelum mencapai JSON output (implementasi 10B).

### 4.2 Error tracking

Implementasi: `src/server/error-reporter.ts`. Default: no-op.

`ERROR_REPORTER=sentry` hanya men-signal niat; SDK Sentry TIDAK
dipasang pada Tahap 10D (keputusan Master Prompt: dependency hanya
bila perlu). `initErrorReporter()` akan memperingatkan di log bila
`ERROR_REPORTER=sentry` tetapi SDK tidak tersedia.

Untuk mengaktifkan Sentry:

```ts
// instrumentation.ts (Next.js 16 register hook)
import * as Sentry from "@sentry/nextjs";
import { setErrorReporter } from "@/server/error-reporter";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  Sentry.init({ dsn: process.env.SENTRY_DSN });
  setErrorReporter({
    name: "sentry",
    report: (error, ctx) => Sentry.captureException(error, { extra: ctx }),
  });
}
```

Batas pelaporan: hanya `AppError.code === "INTERNAL"` atau `Error` tak
tergolongkan yang dikirim ke reporter. Error 4xx bisnis (validasi,
conflict, forbidden) TIDAK dilaporkan — menghindari noise.

### 4.3 Health check

`GET /api/health` (public, tanpa auth, `force-dynamic`). Tiga cek:

1. **DB ping** — `SELECT 1` via `db`. Gagal → status `503`.
2. **Queue backlog** — `count(*) job_runs WHERE status IN ('queued','running')`.
   - `>= 1000` → `503` (QUEUE_CRITICAL).
   - `>= 100`  → `200` dengan `degraded: true`.
3. **AI settings singleton** — `ai_settings.updatedAt` (info-only).

Contoh respons `200`:
```json
{
  "status": "ok",
  "checks": {
    "db": { "ok": true, "latencyMs": 4 },
    "queue": { "ok": true, "backlog": 12, "degraded": false },
    "ai": { "ok": true, "enabled": false, "updatedAt": "..." }
  },
  "uptimeMs": 4820113
}
```

Integrasi uptime monitor (UptimeRobot / BetterStack / Vercel): set
probe ke `/api/health`, timeout 5s, alert bila `!= 200` selama 3
siklus berturut.

---

## 5. Deployment (Vercel)

### 5.1 Build & release

```powershell
vercel link                         # sekali
vercel env pull .env.local          # untuk development lokal
vercel                              # preview dari branch
vercel --prod                       # setelah PR merge + review
```

**Pre-deploy checklist** (wajib lulus sebelum `--prod`):
- `bun x tsc --noEmit` → 0 error.
- `bun run lint` → 0 error/warning.
- `bun x vitest run` → semua unit test lulus (baseline 10C: 160 test).
- `bun run scripts/test-*.ts` (rollback-only) lulus terhadap DB staging.
- Migrasi Drizzle yang belum di-apply tercantum di PR; operator sudah
  APPROVE eksplisit (Master Prompt §2.2).

### 5.2 Environment variables Vercel

Set sekali per project via UI / CLI:
```powershell
vercel env add DATABASE_URL production
vercel env add DATABASE_URL preview
vercel env add BETTER_AUTH_SECRET production
vercel env add BETTER_AUTH_SECRET preview
# dst. sesuai matriks §1.2
```

**Jangan** pakai `vercel env add ... all` untuk `DATABASE_URL` —
Preview & Production wajib menunjuk Neon branch berbeda agar QA
tidak mencemari data produksi.

### 5.3 Post-deploy verification

- `curl https://<domain>/api/health` → `200` + `checks.db.ok=true`.
- Login manual admin → 200 + cookie `better-token` ter-set,
  `Secure; HttpOnly; SameSite=Lax`.
- Satu request API audit: `curl -H "Authorization: Bearer <token>" https://<domain>/api/audit-logs?limit=1` → header `x-request-id` muncul.

---

## 6. Runbook insiden umum

### 6.1 `503` pada `/api/health`, `queue.backlog > 1000`

Penyebab: worker mati atau job menggantung di `status='running'`.

Tindakan:
1. Cek proses `bun run jobs:worker` (systemd/PM2/Vercel Cron — lihat Tahap 8D).
2. `psql "$DATABASE_URL" -c "SELECT id, type, status, claimed_at FROM job_runs WHERE status='running' AND claimed_at < now() - interval '1 hour';"`
3. Untuk job yang jelas macet: `UPDATE job_runs SET status='queued', claimed_at=NULL, attempts=attempts+1 WHERE id IN (...);` — **WAJIB approval DB-writing** dari user (Master Prompt §2.2).
4. Restart worker; pantau `backlog` 30 menit.

### 6.2 `Nein: connection pool exhausted` (PgBouncer "client has already been connected")

- Neon pooled limit: 100 connections (Launch). Cek di Neon Console → Monitor.
- Reduksi: pastikan `db/index.ts` memakai singleton `pg.Pool` (bukan `new Client()` per request).
- Klien AI/worker: pakai `DATABASE_URL_UNPOOLED` khusus, jangan campur dengan pool utama.

### 6.3 `401 CSRF` massal pada user tertentu

- Header `Origin` / `Referer` tidak cocok `APP_URL` — periksa konfigurasi Vercel preview vs production.
- Cookie `better-token` hilang → sesi expired; user perlu login ulang.
- Jangan matikan CSRF di produksi.

### 6.4 Migration `db:migrate` gagal di tengah

- Drizzle wrap tiap file dalam satu transaksi (Postgres DDL
  transactional) — rollback otomatis; `audit_logs` dan tabel inti
  lain kembali ke kondisi pra-migrasi.
- Perbaiki SQL di `src/db/migrations/<n>_*.sql`, hapus entry
  `meta/_journal.json` + snapshot terkait HANYA jika file belum
  pernah di-apply ke environment manapun. Jangan menyentuh journal
  untuk migration yang sudah apply (buat migrasi koreksi baru).
- Run `bun run db:migrate` lagi.

### 6.5 PII / password bocor ke log

- Trigger: insiden `clampValue` object besar (lihat 10A) atau
  developer menambahkan `logger.info("...", req.body)` tanpa redaction.
- Tindakan: (1) stop rotasi log; (2) grep `password|token|api[_-]?key`
  di stdout/stderr Vercel; (3) tambahkan pattern redaction di
  `src/server/redact.ts`; (4) bila data keluar dari boundary, jalankan
  prosedur wajib lapor PII.

---

## 7. Keamanan operasional

- **Rate limit**: middleware DB (Tahap 10B) — `api_rate_limits` dengan
  window rolling. Reset: `DELETE FROM api_rate_limits WHERE window_start < now() - interval '1 hour';` (cron nightly).
- **Lockout akun**: 5 percobaan gagal → lockout 15 menit (`users.failedLoginCount`, `users.lockedUntil`). Reset manual via `bun run scripts/test-security.ts` (dev) atau query `UPDATE users SET failed_login_count=0, locked_until=NULL WHERE email='...';` (prod, approval).
- **Backup secret**: `BETTER_AUTH_SECRET` TIDAK pernah masuk repo.
  Simpan di password manager + Vercel secret only (bukan env plain).
- **Audit trail**: `audit_logs` append-only (trigger di migrasi 0003).
  Setelah partisi 10C aktif, retensi 7 tahun ditegakkan via
  DROP PARTITION, bukan DELETE — bypass trigger secara desain.

---

## 8. Checklists ringkas

**Sebelum migrasi besar (partisi, indeks baru)**
- [ ] Backup PITR aktif + restore drill terakhir lulus
- [ ] Snapshot branch Neon manual dibuat
- [ ] Estimasi durasi lock diukur di branch preview
- [ ] Operator approval eksplisit tercatat di PR

**Sebelum deploy produksi**
- [ ] `tsc`, `lint`, `vitest` lulus lokal
- [ ] `scripts/test-*.ts` lulus di staging
- [ ] Env Vercel production sudah disamakan dengan `.env.example` §1
- [ ] `/api/health` respons 200 setelah deploy
- [ ] Rollback plan tertulis (PITR timestamp atau branch revert)

**Bulanan**
- [ ] Restore drill (§2.2) — catat hasil
- [ ] Review `pg_stat_statements` untuk query lambat baru
- [ ] Cek ukuran `audit_logs_default` partition (harus ~0)
- [ ] Rotasi `BETTER_AUTH_SECRET` (opsional; trigger relogin massal)

---

Dokumen ini adalah artefak Tahap **10D** (observability & operasi
inti) dan **10E** (dokumentasi operasional). Update dokumen setiap ada
keputusan operasional baru yang mengubah asumsi (mis. provider AI baru,
partisi lain dibuat, retention berubah).
