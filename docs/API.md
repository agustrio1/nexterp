# API ERP (Tahap 10E)

Dokumentasi permukaan API (endpoint surface), kontrak auth, konvensi
paginasi & error, serta contoh request end-to-end. Ditargetkan untuk
pengguna integrasi (frontend, ETL, sistem eksternal) dan reviewer
keamanan.

Berkas ini adalah kontrak — perubahan breaking pada response shape
WAJIB disertai update dokumen + bump versi pada PR terkait.

---

## 1. Konvensi umum

### 1.1 Basis URL & environment

| Environment | Base URL |
|---|---|
| Lokal dev | `http://localhost:3000/api/...` |
| Vercel preview | `https://<branch>.vercel.app/api/...` |
| Produksi | `https://<domain-resmi>/api/...` |

Semua endpoint berada di bawah prefix `/api`. Tidak ada API versioning
eksplisit (`/v1`) — Next.js route tree bertindak sebagai surface
stabil; breaking change diumumkan lewat changelog internal.

### 1.2 Content-Type

- Request body: **selalu** `application/json; charset=utf-8`. Handler
  menolak payload non-JSON dengan `VALIDATION_FAILED` 422.
- Response body: `application/json` untuk semua endpoint termasuk
  error.
- Pengecualian: `POST /api/reports/export/[jobId]` mengembalikan
  `text/csv` untuk unduhan artefak (lihat §5.3).

### 1.3 Header khusus

| Header | Arah | Fungsi |
|---|---|---|
| `X-Request-Id` | in / out | Diinject `src/proxy.ts` Edge bila klien tidak kirim; server meng-generate UUID. Echo di response. Klien WAJIB menyertakan saat melaporkan insiden. |
| `Origin` / `Referer` | in | Dipakai CSRF guard (`src/server/csrf.ts`). Harus cocok `APP_URL`, bila tidak → 403. |
| `Cookie: better-token=...` | in | Sesi Better Auth. Ditetapkan oleh server via `Set-Cookie` setelah login. |
| `Idempotency-Key` | in | Untuk POST berbiaya tinggi (job enqueue, journal post, transfer aset). Server menyimpan hash request di `idempotency_keys` selama TTL; request ulang dengan key sama mengembalikan respons pertama. |

### 1.4 Rate limit

Implementasi: `src/server/rate-limit.ts` + tabel `api_rate_limits`.
Bucket key = `(metode unsafe, client IP, group path)`. Default:
`API_UNSAFE_LIMIT_PER_MINUTE` per bucket. Kena `429 RATE_LIMITED`
dengan header `Retry-After` (detik). Endpoint `GET` tidak dibatasi
kecuali `audit-logs` (karena query berat).

---

## 2. Autentikasi & otorisasi

### 2.1 Sesi Better Auth

- Login: `POST /api/auth/sign-in/email` (dirouting Better Auth via
  `src/app/api/auth/[...all]/route.ts`). Body: `{ email, password }`.
- Response: cookie `better-token` (`HttpOnly; Secure; SameSite=Lax`).
- Logout: `POST /api/auth/sign-out`.
- Profil: `GET /api/auth/get-session` → `{ user: { id, email, name }, ... }`.

### 2.2 Context aktor

Setiap handler `/api/*` memanggil `requireActor()` (lihat
`src/server/auth/actor.ts`) yang:

1. Membaca session Better Auth.
2. Lookup `users.status` — `suspended` → `401 UNAUTHENTICATED`.
3. Load permission grants dari `roles` + `role_permissions` +
   `user_roles`.
4. Mengembalikan `AuthContext { userId, grants: Set<PermissionCode>, ... }`.

Tidak ada endpoint publik selain `/api/health`, `/api/auth/*`, dan
`/api/auth/[...all]` fallback. Semua lain → `401` bila tanpa sesi.

### 2.3 Model izin

Permission code format: `modul.sumber.aksi` (contoh:
`core.users.read`, `accounting.journals.post`). Definisi lengkap di
`src/modules/permissions.ts`. Endpoint memanggil `assertCan(actor,
code)` di awal service — kegagalan → `403 FORBIDDEN`.

### 2.4 CSRF

Guard: `sameOriginViolation(...)` di `src/server/errors.ts apiHandler`
— metode unsafe (`POST/PATCH/PUT/DELETE`) wajib Origin sama dengan
`APP_URL`. Respons 403 + logger.warn `"csrf violation"`.

---

## 3. Bentuk respons standar

### 3.1 Suksès single resource

```json
{ "data": { "id": "...", "name": "...", ... } }
```
Status: `200` (baca/patch) atau `201` (create).

### 3.2 Suksès list (keyset pagination, Tahap 10C)

```json
{
  "data": [ /* array of items */ ],
  "meta": {
    "limit": 20,
    "cursor": null,
    "nextCursor": "eyJ0IjoiMjAyNi0xMC0xNVQwMDowMDowMC4wMDBaIiwiaSI6Ij9...Iiwi",
    "hasMore": true
  }
}
```

**Parameter query**:
- `limit` integer 1..100, default 20.
- `cursor` opaque base64url string (1..400 char) — berasal dari
  `meta.nextCursor` respons sebelumnya. `null`/absent = halaman pertama.

**Klien**:
- Untuk halaman berikutnya: kirim `nextCursor` apa adanya.
- **Jangan** menafsikan isi cursor; format internal dan dapat berubah
  kapan pun (mis. tambah kolom urutan).
- Bila cursor kadaluarsa (data terkait terhapus), server
  mengembalikan `422 VALIDATION_FAILED` `path="cursor"`. Klien harus
  mulai ulang dari halaman pertama.

**Kenapa keyset, bukan OFFSET** (lihat `src/server/cursor.ts`): OFFSET
memindai baris terbuang O(n), rawan page drift saat insert concurrent.
Keyset pakai indeks `(kolomUrutan, id)` → O(log n) per halaman.

### 3.3 Sukses tanpa body (204)

Beberapa endpoint `DELETE` mengembalikan `204 No Content`. Tidak ada
JSON envelope.

### 3.4 Error

Semua error memakai bentuk seragam (dibuat oleh `toErrorResponse`
di `src/server/errors.ts`):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Input tidak valid.",
    "details": [
      { "path": "email", "message": "Format email tidak valid." },
      { "path": "password", "message": "Minimal 12 karakter." }
    ]
  },
  "requestId": "0f7c..."
}
```

`requestId` selalu ada dan sama dengan header `x-request-id`.
`details` hanya untuk 422 (`VALIDATION_FAILED` / `BUSINESS_RULE`).

---

## 4. Kode error

| HTTP | Code | Kapan | Klien harus |
|---|---|---|---|
| 401 | `UNAUTHENTICATED` | Tidak ada sesi / user suspended / sesi expired. | Redirect ke login; hapus cache state. |
| 403 | `FORBIDDEN` | Actor tidak punya permission, atau CSRF origin mismatch. | Tampilkan pesan "Anda tidak memiliki akses"; JANGAN retry. |
| 404 | `NOT_FOUND` | Resource dengan id/code yang diminta tidak ada. | Tampilkan empty-state. |
| 409 | `CONFLICT` | Uniqueness violation (kode duplikat, email sudah dipakai, dsb.). | Tandai field terkait; user perbaiki input. |
| 422 | `VALIDATION_FAILED` | Body/query tidak lolos Zod schema. | Render `details[]` inline per field. |
| 422 | `BUSINESS_RULE` | Aturan bisnis menolak (periode tutup, jurnal tak seimbang, saldo tidak cukup). | Tampilkan `message` ke user. |
| 429 | `RATE_LIMITED` | Bucket rate limit unsafe-method terlampaui. | Hormati `Retry-After`; exponential backoff. |
| 500 | `INTERNAL` | Bug tak terduga, DB connection error, dsb. | Jangan retry otomatis; laporkan `requestId` ke ops. |

`500` tidak pernah memuat detail teknis di body (diredam oleh
`toErrorResponse`) kecuali `NODE_ENV !== "production"`.

---

## 5. Permukaan endpoint per modul

Sub-bagian ini memetakan resource utama. Kolom **Izin** = permission
code yang dibutuhkan. Kolom **Paginasi** = `keyset` (10C), `full`
(array penuh tanpa paginasi — untuk katalog kecil), atau `n/a`.

### 5.1 Inti organisasi (Core)

| Endpoint | Metode | Izin | Catatan |
|---|---|---|---|
| `/api/health` | GET | publik | Lihat `docs/OPERATIONS.md §4.3`. |
| `/api/company` | GET, PATCH | `core.company.read` / `core.company.manage` | Singleton profil perusahaan. |
| `/api/settings` | GET, PUT | `core.settings.read` / `core.settings.manage` | Key-value settings. |
| `/api/branches` | GET, POST | `core.branches.read` / `core.branches.manage` | List `full`. |
| `/api/branches/[id]` | GET, PATCH, DELETE | `core.branches.read` / `.manage` | |
| `/api/departments` | GET, POST | `core.departments.read` / `.manage` | |
| `/api/departments/[id]` | GET, PATCH, DELETE | `core.departments.read` / `.manage` | |
| `/api/currencies` | GET, POST | `core.currencies.read` / `.manage` | List `full` (~180 kode ISO). |
| `/api/currencies/[code]` | GET, PATCH | `core.currencies.read` / `.manage` | Key = ISO 3-huruf. |
| `/api/exchange-rates` | GET, POST | `core.exchange_rates.read` / `.manage` | List **`keyset`** (10C). Filter: `fromCurrency`, `dateFrom`, `dateTo`. |
| `/api/fiscal-years` | GET, POST | `core.fiscal_years.read` / `.manage` | |
| `/api/fiscal-years/[id]` | GET, PATCH | `core.fiscal_years.read` / `.manage` | |
| `/api/periods/[id]/status` | POST | `core.periods.close` / `.reopen` | Buka/tutup periode akuntansi. |

### 5.2 Identitas & akses

| Endpoint | Metode | Izin | Catatan |
|---|---|---|---|
| `/api/users` | GET, POST | `core.users.read` / `.manage` | List **`keyset`**. Filter: `status`, `search` (ilike nama/email). |
| `/api/users/[id]` | GET, PATCH, DELETE | `core.users.read` / `.manage` | |
| `/api/users/[id]/status` | POST | `core.users.manage` | Aktif/suspend. |
| `/api/users/[id]/roles` | GET, PUT | `core.users.read` / `.manage` | Assign role. |
| `/api/users/[id]/reset-password` | POST | `core.users.manage` | Kirim token reset (email). |
| `/api/roles` | GET, POST | `core.roles.read` / `.manage` | |
| `/api/roles/[id]` | GET, PATCH, DELETE | `core.roles.read` / `.manage` | Role `isSystem=true` read-only. |
| `/api/permissions` | GET | `core.permissions.read` | Katalog permission. |
| `/api/auth/*` | — | publik | Di-route Better Auth. |
| `/api/me` | GET | sesi valid | Profil actor + grants (untuk UI shell). |

### 5.3 Jobs latar belakang (Tahap 8D/10C)

| Endpoint | Metode | Izin | Catatan |
|---|---|---|---|
| `/api/jobs` | GET | `core.jobs.read` | List **`keyset`**. Filter: `status`, `type`, `createdBy`. |
| `/api/jobs` | POST | `core.jobs.enqueue` | Body: `{ type, payload, idempotencyKey? }`. Return `202`. |
| `/api/jobs/[id]` | GET | `core.jobs.read` | |
| `/api/jobs/[id]/cancel` | POST | `core.jobs.cancel` | Hanya status `queued`. |
| `/api/reports/export` | POST | `reports.export.run` | Enqueue `export.report` job. |
| `/api/reports/export/[jobId]` | GET | `reports.export.run` | Download CSV — `text/csv` atau `404`/`409`. |

### 5.4 Akuntansi (Tahap 4E+)

| Endpoint | Metode | Izin | Catatan |
|---|---|---|---|
| `/api/chart-accounts` | GET, POST | `accounting.chart_accounts.read` / `.manage` | Tree + flat. |
| `/api/chart-accounts/[id]` | GET, PATCH | read/manage | |
| `/api/journals` | GET, POST | `accounting.journals.read` / `.create` | List **`keyset`** (sejak 4E). |
| `/api/journals/[id]` | GET, PATCH, DELETE | read / `.create` | Hanya `draft` bisa PATCH/DELETE. |
| `/api/journals/[id]/post` | POST | `accounting.journals.post` | Posting; balance check. |
| `/api/journals/[id]/reverse` | POST | `accounting.journals.reverse` | Buat jurnal reversal. |
| `/api/closing-entries` | POST | `accounting.closing.manage` | Tutup periode. |

### 5.5 Audit trail

| Endpoint | Metode | Izin | Catatan |
|---|---|---|---|
| `/api/audit-logs` | GET | `core.audit_logs.read` | List keyset (default `at DESC`). Filter: `entityType`, `entityId`, `actorId`, `dateFrom`, `dateTo`. |

Setelah partisi `audit_logs` aktif (lihat `docs/OPERATIONS.md §3.3`),
query dengan filter tanggal akan partition-pruning secara otomatis.

### 5.6 Modul domain (5–9)

Modul yang lebih luas (inventory/procurement, sales/CRM, HR/payroll,
fixed assets, projects, AI) memiliki pola endpoint serupa:
`GET /api/<resource>` list + `POST` create, `GET|PATCH|DELETE
/api/<resource>/[id]`, action endpoints di `/[id]/<action>`. Daftar
lengkap tersedia di repo: `Glob src/app/api/**/route.ts` (299 berkas
per Tahap 10C). Setiap route punya permission gate + audit log
mengikuti kontrak §2.

### 5.7 Dashboard read-only (Tahap 6B)

| Endpoint | Metode | Izin | Catatan |
|---|---|---|---|
| `/api/dashboard/executive` | GET | `core.dashboard.read` | Aggregate KPI eksekutif. |
| `/api/dashboard/finance` | GET | `core.dashboard.read` | |
| `/api/dashboard/sales` | GET | `core.dashboard.read` | |
| `/api/dashboard/inventory` | GET | `core.dashboard.read` | |
| `/api/dashboard/procurement` | GET | `core.dashboard.read` | |
| `/api/dashboard/hr` | GET | `core.dashboard.read` | |
| `/api/dashboard/payroll` | GET | `core.dashboard.read` | |
| `/api/dashboard/cash-flow` | GET | `core.dashboard.read` | |

Query parameter: `?branchId=&dateFrom=&dateTo=` (opsional per modul).

### 5.8 AI (Tahap 9)

| Endpoint | Metode | Izin | Catatan |
|---|---|---|---|
| `/api/ai/settings` | GET, PATCH | `core.ai.settings.read` / `.manage` | Konfigurasi provider, quota. |
| `/api/ai/usage` | GET | `core.ai.usage.read` | Riwayat `ai_requests`. |
| `/api/ai/assistant/analyze` | POST | `core.ai.assistant.use` | Query analysis ter-gate. |
| `/api/ai/assistant/report-query` | POST | `core.ai.assistant.use` | Report query builder (SQL-free). |

AI tidak pernah mengeksekusi SQL bebas; hanya memanggil service layer
yang sudah di-authorize actor.

---

## 6. Contoh alur end-to-end

### 6.1 Login → list users (keyset) → halaman kedua

```bash
# 1. Login
curl -c cookies.txt -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@erp.local","password":"..."}'

# 2. List users (halaman pertama, default limit 20)
curl -b cookies.txt http://localhost:3000/api/users
# → { "data": [...20 users...], "meta": { "limit":20, "cursor":null,
#     "nextCursor":"eyJ0Ijoi...", "hasMore":true } }

# 3. Halaman kedua
curl -b cookies.txt "http://localhost:3000/api/users?cursor=eyJ0Ijoi..."
```

### 6.2 Enqueue export job + download

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/reports/export \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"reportKey":"sales.summary","params":{"from":"2026-01-01"}}'
# → 202 { "data": { "jobId":"<uuid>", "status":"queued" } }

# Poll status
curl -b cookies.txt http://localhost:3000/api/jobs/<jobId>
# → { "data": { "status":"succeeded", ... } }

# Download artefak
curl -b cookies.txt http://localhost:3000/api/reports/export/<jobId> -o sales.csv
```

### 6.3 Kegagalan validasi

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/currencies \
  -H "Content-Type: application/json" \
  -d '{"code":"idr","name":"", "decimals":8}'
# → HTTP 422
# {
#   "error": {
#     "code": "VALIDATION_FAILED",
#     "message": "Input tidak valid.",
#     "details": [
#       { "path": "code", "message": "Kode harus 3 huruf kapital." },
#       { "path": "name", "message": "Nama wajib diisi." },
#       { "path": "decimals", "message": "Desimal harus 0..6." }
#     ]
#   },
#   "requestId": "0f7c..."
# }
```

---

## 7. Catatan integrasi

- **Retry**: hanya untuk `429` (hormati `Retry-After`) dan `5xx`
  idempoten (`GET`). Untuk `POST` gunakan `Idempotency-Key` bila
  provider mendukung; tanpa key, `5xx` **tidak** di-retry otomatis.
- **Caching**: server tidak mengirim `Cache-Control` untuk list API
  — default browser tidak cache. Klien boleh cache di sisi UI dengan
  invalidasi manual setelah mutation.
- **Compression**: `Accept-Encoding: gzip, br` dianjurkan; Vercel edge
  otomatis compress.
- **Time**: semua timestamp UTC ISO-8601 dengan `Z` suffix. Zona lokal
  (`Asia/Jakarta`) ditampilkan di UI, bukan di wire.
- **Money**: selalu string desimal presisi tinggi. Jangan parse ke
  float JS; gunakan `decimal.js` di klien bila perlu aritmetika.

---

## 8. Perubahan breaking

Perubahan yang membutuhkan migrasi klien:
- Mengubah shape `data` item resource.
- Mengubah makna `code` error.
- Menghapus endpoint atau mengubah permission code.
- Mengubah semantik cursor (format internal — klien tidak boleh
  bergantung pada isi).

Perubahan non-breaking:
- Menambah field opsional pada response.
- Menambah parameter query dengan default backward-compatible.
- Menambah endpoint baru.

Changelog internal di repo commit message. Konsumen eksternal
diberi lead-time minimal 1 sprint sebelum breaking apply.

---

Dokumen ini adalah artefak **10E** (dokumentasi penggunaan API).
Sumber kebenaran tetap kode sumber: `src/app/api/**/route.ts` dan
`src/modules/*/schemas.ts`. Update dokumen bersamaan dengan perubahan
kode; PR yang menyentuh endpoint tanpa update dok ini akan ditolak.
