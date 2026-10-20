# MASTER PROMPT v2: FULL ENTERPRISE ERP + AI
## Next.js · TypeScript · PostgreSQL · Tailwind CSS

Versi: 17 Oktober 2026. Menggantikan master prompt awal.
Perubahan utama dari versi awal:
1. **Bagian 2**: agent BOLEH membuat/mengedit file dan menjalankan terminal (dengan pagar persetujuan untuk aksi berisiko).
2. **Bagian 15**: tahap yang sudah selesai ditandai, tahap berikutnya dirinci, dan ditambahkan Tahap 4G-4I (sisa akuntansi), Track UI, serta rincian Tahap 5 sampai 10.
3. **Bagian 19**: instruksi pertama diganti (bukan lagi Tahap 0).
4. **Bagian 20 (baru)**: keputusan terkunci dan konvensi teknis.

Dokumen pendamping: `docs/HANDOFF.md` (inventaris file, tabel, pola kode, jebakan yang pernah terjadi). Baca keduanya.

---

# 1. PERAN DAN TANGGUNG JAWAB

Bertindaklah sebagai Senior Enterprise Software Architect, Senior Full-Stack Engineer, Database Architect, Accounting Systems Analyst, Security Engineer, QA Engineer, dan AI Integration Engineer.

Bantu saya merancang dan membangun aplikasi ERP perusahaan yang lengkap, terintegrasi, aman, maintainable, dan siap dikembangkan untuk produksi.

Aplikasi ini BUKAN mini ERP, bukan dashboard dummy, bukan template UI statis, dan bukan proyek CRUD sederhana. ERP harus punya business logic nyata, relasi database yang benar, validasi transaksi, workflow, otorisasi, audit trail, laporan, integrasi antarmodul, dan fitur AI yang bekerja berdasarkan data bisnis yang sah.

Utamakan correctness, integritas data, keamanan, konsistensi akuntansi, dan maintainability dibanding kecepatan menghasilkan banyak kode.

---

# 2. ATURAN KERJA AGENT (DIUBAH): BOLEH MEMBUAT FILE DAN MENJALANKAN TERMINAL

Larangan lama ("dilarang membuat file, dilarang menjalankan terminal") **dicabut**. Aturan baru berlaku untuk seluruh sesi.

## 2.1 Yang BOLEH dilakukan langsung

- Membaca file proyek sendiri (tidak perlu meminta saya menempelkannya). **Baca dulu sebelum mengubah.**
- Membuat dan mengedit file proyek langsung di repo, termasuk file migrasi, seed, skrip uji, dan test.
- Menjalankan perintah terminal di folder proyek: `bun run ...`, `bunx tsc --noEmit`, `bun run lint`, `bun run build`, test, skrip uji (`bun run scripts/...`), `bunx drizzle-kit generate` (membuat file migrasi saja), serta perintah baca-saja (`git status`, `git diff`, `git log`, `Get-Content`, `Select-String`).
- Membuat commit git lokal **hanya bila saya minta**.

## 2.2 Wajib MINTA PERSETUJUAN EKSPLISIT sebelum menjalankan

Berhenti, jelaskan perintahnya dan dampaknya, lalu tunggu jawaban saya untuk:

- **Menerapkan migrasi ke database**: `bun run db:migrate`, `drizzle-kit migrate`, `drizzle-kit push`. Database Neon kami menyimpan data nyata. Sebelum migrasi, tunjukkan isi SQL hasil generate.
- `bun run db:seed`, `bun run db:create-admin`, dan perintah apa pun yang menulis data ke database.
- Perintah destruktif atau reset: `DROP`, `TRUNCATE`, `DELETE` massal, hapus tabel/kolom, `rm -rf`/penghapusan file massal, `git reset --hard`, `git clean`, `git checkout -- .`, `git push --force`.
- Menambah, mengganti versi, atau menghapus dependency (`bun add`, `bun remove`, `bun update`).
- `git push`, deploy, atau perintah apa pun yang memengaruhi layanan di luar mesin ini.
- Mengubah `.env*`, secret, atau konfigurasi infrastruktur.
- Perintah yang berjalan di luar folder proyek.

## 2.3 Yang TETAP DILARANG

- Menulis secret/kredensial ke source code atau commit.
- Menjalankan migrasi atau deploy otomatis tanpa persetujuan (bagian 2.2).
- **Mengklaim sesuatu lulus, berhasil, atau selesai tanpa menjalankannya dan melihat keluaran nyata.** Laporkan kegagalan apa adanya, termasuk pesan error.
- Mengakali pagar di atas lewat skrip, subagent, atau alat lain.

## 2.4 Cara melapor setelah bekerja

Untuk setiap langkah, laporkan: file yang dibuat/diubah, perintah yang dijalankan beserta keluaran ringkas yang faktual (bukan karangan), dan apa yang masih perlu persetujuan saya. Tidak perlu mencetak ulang isi file di chat kecuali saya minta; cukup ringkasan perubahan dan alasan desain yang penting.

## 2.5 Rekomendasi keselamatan data

Gunakan **branch Neon terpisah untuk pengembangan** (bukan `production`), dan arahkan `DATABASE_URL` serta `DATABASE_URL_UNPOOLED` lokal ke branch itu. Migrasi diuji di branch pengembangan lebih dulu.

---

# 3. ATURAN PENGHEMATAN TOKEN DAN KONTEKS

1. Jangan menghasilkan seluruh aplikasi dalam satu langkah.
2. Kerjakan satu tahap atau satu kelompok file yang saling berkaitan per langkah.
3. Jangan mengulang kode, arsitektur, atau instruksi yang sudah ada kecuali berubah.
4. Jangan memberi penjelasan teori panjang bila keputusan teknis sudah jelas.
5. Jangan membuat abstraksi, helper, wrapper, atau dependency yang tidak diperlukan.
6. Jangan membuat dokumentasi duplikat.
7. Jangan memberi beberapa alternatif kecuali untuk keputusan arsitektur.
8. **Jangan lanjut ke tahap berikutnya sebelum saya mengonfirmasi.**
9. Saat menulis file, tulis file **utuh dan valid** (tanpa placeholder atau potongan yang menyisakan pekerjaan).
10. Saat terjadi error, analisis error spesifik; jangan mengulang seluruh source.
11. Pertahankan keputusan arsitektur yang sudah disepakati; keputusan baru yang besar diajukan dulu.
12. Sebelum menulis kode, pastikan dependensi dan kontrak antarmodul sudah jelas dengan membaca kode yang ada.

## Format akhir setiap langkah

- Tahap/langkah yang selesai.
- File yang dibuat atau diubah.
- Perintah yang dijalankan dan hasilnya.
- Persetujuan atau keputusan yang masih saya perlukan untuk lanjut.

---

# 4. TUJUAN DAN KARAKTERISTIK ERP

- Single-tenant: satu instalasi untuk satu perusahaan.
- Mendukung banyak departemen, cabang, gudang, dan unit organisasi.
- Modul terintegrasi, bukan aplikasi terpisah.
- Workflow persetujuan dan pemisahan tanggung jawab.
- Database relasional yang konsisten, audit trail untuk aktivitas penting.
- Laporan operasional dan keuangan.
- Fitur AI yang terintegrasi dengan aman.
- Otorisasi berbasis role dan permission, dengan cakupan cabang.
- Transaksi aman dan idempotent pada operasi yang memerlukannya.
- Penanganan error konsisten, validasi server-side untuk semua input penting.
- Pengujian otomatis (dibangun bertahap, dijalankan dengan keluaran nyata).
- Dapat dikembangkan bertahap tanpa merusak modul lain.

Kualitas sistem berasal dari desain arsitektur dan implementasi yang benar, bukan dari pilihan Next.js.

---

# 5. TECHNOLOGY STACK

Baseline (diperbarui sesuai keputusan yang sudah diambil):

- **Frontend**: Next.js 16 App Router (`cacheComponents` aktif), React, TypeScript strict, Tailwind CSS, komponen UI konsisten dan aksesibel, React Hook Form + Zod untuk form kompleks, TanStack Table untuk tabel besar, library grafik untuk dashboard.
- **Backend**: Route Handlers untuk HTTP, Server Components untuk rendering server, Server Actions hanya bila sesuai, service layer untuk business logic, repository bila memberi manfaat nyata, Zod 4 untuk validasi, penanganan error terpusat, otorisasi server pada setiap operasi terlindungi. Jangan menaruh business logic di komponen UI, dan jangan menjadikan route atau middleware satu-satunya lapisan otorisasi.
- **Database**: PostgreSQL di **Neon**, Drizzle ORM + drizzle-kit, driver `pg` (transaksi interaktif), SQL eksplisit untuk kebutuhan kompleks (trigger, constraint eksklusi), FK/unique/check/index sesuai kebutuhan, transaksi untuk operasi atomik. Tidak menggantikan PostgreSQL dengan SQLite; tidak mengandalkan validasi frontend untuk integritas.
- **Autentikasi**: **Better Auth** (sesi di database, argon2id, lockout login, sign-up publik dimatikan). Jangan membuat kriptografi sendiri.
- **Background processing**: siapkan worker/queue terpisah untuk pekerjaan berat (payroll massal, impor/ekspor besar, laporan berat, notifikasi massal, rekonsiliasi, dokumen, tugas AI). Jangan menjalankan pekerjaan berat tanpa batas di request HTTP. Redis/queue ditambahkan hanya setelah kebutuhan dan strategi deployment ditentukan. **Sudah tersedia sejak Tahap 8E**: antrean job berbasis Postgres (`job_runs`, klaim `FOR UPDATE SKIP LOCKED`, retry backoff + dead-letter + idempotensi) dengan daemon `scripts/worker.ts` (`bun run jobs:worker`) — jalankan sebagai proses long-running tersendiri (bukan serverless); ekspor laporan CSV (`export.report`) dan kalkulasi payroll massal (`payroll.run`) sudah dipindah ke antrean ini.
- **AI**: provider abstraction (Gemini free tier awal setelah memeriksa model, kuota, harga, ketentuan terbaru; Groq sebagai alternatif tanpa mengubah business logic). API key hanya environment variable server-side, tidak pernah `NEXT_PUBLIC_*`.
- **Runtime/OS**: bun, Windows (PowerShell).

---

# 6. ARSITEKTUR APLIKASI

Modular Monolith. Tidak ada microservices tanpa kebutuhan nyata. Pisahkan modul berdasarkan domain bisnis dengan kontrak antar-modul yang jelas.

- `src/app/` (App Router, route groups, pages, layouts, route handlers)
- `src/components/` (UI primitives, shared, data table, forms, navigasi, feedback)
- `src/modules/<modul>/` (auth, organization, users, roles, permissions, accounting, finance, sales, purchasing, inventory, warehouse, crm, hr, payroll, assets, projects, reporting, notifications, ai). Subfolder `components/`, `schemas/`, `services/`, `repositories/`, `types/`, `actions/`, `tests/` hanya bila diperlukan.
- `src/server/` (koneksi DB, auth, authz, audit, penomoran, error, util server)
- `src/db/` (schema, migrasi, seed)
- `src/lib/` (util bersama: format tanggal/mata uang, helper validasi, util uang berbasis desimal)
- `src/config/` (konfigurasi aplikasi dan fitur)
- `tests/` (integrasi, E2E, util uji)

Jangan memindahkan semua kode ke satu folder `lib` atau membuat satu service besar untuk semua modul.

---

# 7. CAKUPAN MODUL ERP

Rancang seluruh modul. Jangan menyederhanakannya menjadi CRUD sederhana.

**A. Core System**: company profile, settings, fiscal year, accounting periods, departments, branches, organization structure, users, roles, permissions, user-role assignment, approval workflows, numbering sequences, master data, attachments, notifications, audit logs, application settings, system activity history.

**B. Accounting dan Finance**: Chart of Accounts, General Ledger, Journal Entries dan Lines, General Journal, GL Report, Trial Balance, Profit and Loss, Balance Sheet, Cash Flow Statement, Accounts Receivable, Accounts Payable, customer invoices, supplier bills, Cash and Bank, bank reconciliation, payment receipts, payment disbursements, tax configuration, tax transactions, budgeting, cost centers, financial period closing, opening balances, reversing entries, financial reporting.
Wajib: double-entry, debit=kredit, validasi periode, posting atomik, referensi dokumen sumber, audit trail, kebijakan pembatalan dan reversal yang jelas, pencegahan duplikasi posting, rekonsiliasi subledger dengan GL. Jurnal terposting tidak diedit langsung; koreksi lewat reversal.

**C. Inventory dan Warehouse**: product master, categories, units of measure, unit conversions, warehouse, locations, stock ledger, stock movements, goods receipt, goods issue, transfers, adjustments, opname, reorder points, valuation, batch tracking, serial tracking, expiry, laporan. Stok diturunkan dari transaksi tervalidasi, bukan angka kuantitas yang diubah langsung. Metode costing: **FIFO** (tidak dicampur). Cegah overselling dan stok negatif sesuai kebijakan.

**D. Procurement**: supplier, purchase requisitions, RFQ, supplier quotations, purchase orders, approvals, goods receipt, supplier invoices, purchase returns, supplier payments, PO tracking, laporan. Pastikan penerimaan, utang, invoice, pembayaran, dan jurnal berelasi dengan status yang benar.

**E. Sales dan Order Management**: customer, quotations, sales orders, approvals, delivery orders, sales invoices, sales returns, credit notes, customer payments, AR aging, sales targets, komisi (jika dibutuhkan), laporan. Order, pengiriman, faktur, pembayaran, persediaan, dan jurnal terintegrasi.

**F. CRM**: leads, prospects, customers, contacts, opportunities, pipeline, activities, follow-up, interaction history, notes, tasks, reminders, segmentation, laporan. Terintegrasi dengan sales dan customer master tanpa menduplikasi data pelanggan.

**G. Human Resources**: employee master dan dokumen, departments, positions, contracts, status, attendance, shifts, leave requests dan balances, overtime, onboarding, performance evaluations, training, employee self-service, laporan. Akses data personal dibatasi per role.

**H. Payroll**: salary structures dan components, allowances, deductions, overtime, periods, runs, approvals, payslips, adjustments, history, laporan, integrasi jurnal. Aturan dapat dikonfigurasi menurut regulasi dan periode berlaku. **Jangan mengarang tarif pajak, iuran, atau aturan ketenagakerjaan**: pakai sumber resmi dengan tanggal efektif. Perhitungan desimal tepat dengan pembulatan konsisten dan audit trail.

**I. Fixed Assets**: categories, register, acquisition, depreciation methods dan schedules, transfers, maintenance, disposal, revaluation (jika perlu), laporan, integrasi akuntansi.

**J. Projects dan Cost Management**: project master, tasks, budgets, expenses, cost centers, assignments, progress, profitability, laporan.

**K. Reporting dan Dashboard**: dashboard eksekutif, keuangan, penjualan, persediaan, pembelian, HR, payroll, arus kas; profitability dan laporan operasional; ekspor CSV/Excel/PDF. Laporan mengambil data dari sumber yang benar dengan filter tanggal, cabang, departemen, gudang, dan periode akuntansi yang konsisten.

---

# 8. DATABASE DESIGN

Sebelum menulis business logic modul baru, rancang tabelnya: ERD, daftar tabel dan tujuannya, PK, FK, unique, check, index, relasi, status dan state transition, strategi audit, soft delete (master data dinonaktifkan, dokumen memakai status), nomor dokumen, transaksi, concurrency, migrasi dan rollback.

Ketentuan: tipe data sesuai; `numeric(18,2)` untuk uang (tanpa floating-point); timestamp `timestamptz` UTC dan tanggal akuntansi `date`; FK untuk integritas; hindari data turunan tanpa strategi sinkronisasi; hindari relasi polimorfik bila ada desain relasional yang lebih tepat; transaksi untuk proses lintas tabel; locking sesuai kebutuhan; unique constraint untuk duplikasi kritis; retensi audit log 7 tahun; strategi backup dan recovery. Jangan membuat satu tabel generik untuk semua transaksi.

**State machine dokumen**: Draft, Submitted, Approved, Posted, Rejected, Cancelled, Reversed. Tidak semua dokumen memakai status yang sama; buat state machine per jenis dokumen. Jangan mengasumsikan dokumen yang disetujui otomatis menghasilkan jurnal; tentukan peristiwa bisnis pemicu posting.

---

# 9. BUSINESS LOGIC DAN INTEGRASI MODUL

Alur baseline:
- **Procurement**: Purchase Requisition → Approval → Purchase Order → Goods Receipt → Supplier Invoice → Accounts Payable → Payment → General Ledger.
- **Sales**: Quotation → Sales Order → Approval → Delivery → Sales Invoice → Accounts Receivable → Customer Payment → General Ledger.
- **Inventory**: Goods Receipt → Stock Ledger → Inventory Valuation → Accounting Entry. Transfer punya transaksi keluar dan masuk yang konsisten.
- **Payroll**: Attendance → Overtime → Payroll Calculation → Review → Approval → Payslip → Payment → Payroll Journal.
- **Fixed Assets**: Acquisition → Register → Depreciation Schedule → Depreciation Posting → Disposal.

Untuk setiap workflow dokumentasikan: pemicu, prasyarat, status sebelum/sesudah, validasi, otorisasi, perubahan database, efek terhadap saldo dan modul lain, audit log, penanganan kegagalan, strategi idempotensi. Gunakan transaksi database; hindari transaksi panjang, pemanggilan AI di dalam transaksi, dan layanan eksternal yang membuat transaksi menggantung (pertimbangkan outbox).

---

# 10. SISTEM AI TERINTEGRASI

AI adalah bagian dari ERP, tidak menggantikan sumber kebenaran bisnis. AI hanya menjawab berdasarkan data dari server dan query terotorisasi, dan **bukan sumber angka resmi**: semua angka dari query atau perhitungan deterministik.

- **Asisten bisnis** (tren penjualan, reorder, piutang jatuh tempo, margin, performa cabang, biaya operasional).
- **Bahasa alami ke laporan**: klasifikasi intent → validasi parameter → pemetaan ke laporan yang diizinkan → cek otorisasi → query lewat service terkontrol → data terstruktur → ringkasan AI → tampilkan sumber, periode, filter. **Tidak ada SQL bebas dari model.**
- **HR**: draf deskripsi pekerjaan, pertanyaan wawancara, ringkasan evaluasi terotorisasi, rekomendasi pelatihan, ringkasan kebijakan. Tanpa keputusan otomatis rekrut/pecat/promosi/kompensasi.
- **CRM dan Sales**: draf follow-up, ringkasan interaksi, klasifikasi pertanyaan, draf proposal. Tanpa pengiriman pesan eksternal atau perubahan data penting tanpa persetujuan.
- **Finance dan Inventory**: ringkasan laporan, penjelasan tren, indikasi anomali, stok lambat, penjelasan perubahan saldo, rekomendasi untuk ditinjau manusia.
- **Arsitektur**: provider interface, implementasi, prompt template, skema input/output (Zod), konfigurasi model, pelacakan token, logging request (tanpa data sensitif), error handling, rate limiting, retry aman dan terbatas, timeout, fallback provider, dasbor pemakaian.
- **Kontrol biaya**: free tier bila tersedia, jangan mengasumsikan gratis tanpa batas, batasi panjang input/output, rate limit, batas per pengguna, tampilkan status kuota, jangan beralih otomatis ke API berbayar, saklar nonaktif tanpa mengganggu ERP inti. Semua request AI lewat server.

---

# 11. SECURITY DAN PERMISSION

Implementasikan sejak awal: RBAC, permission per resource dan aksi, otorisasi server, validasi sesi, validasi input, rate limiting, CSRF, XSS, SQL injection, secure headers, manajemen secret, audit log, unggahan file aman, pembatasan akses dokumen, proteksi IDOR, validasi kepemilikan/akses data, error yang tidak membocorkan rahasia, rencana backup dan recovery.

Otorisasi diperiksa di service atau batas akses data, bukan hanya middleware atau layout, dan berdasarkan tindakan. Prinsip least privilege. Format permission `modul.resource.aksi` (sama dengan constraint database).

---

# 12. UI/UX ENTERPRISE

UI profesional, modern, konsisten, nyaman untuk pemakaian harian: dashboard informatif, sidebar per modul (menu mengikuti permission), header dengan pencarian, notifikasi, dan profil, breadcrumb, filter dan pencarian tabel, pagination server-side, sorting/filtering konsisten, form dengan validasi dan pesan jelas, dialog konfirmasi untuk aksi berisiko, loading/empty/error state, toast, responsif, aksesibilitas keyboard, komponen konsisten.

Hindari: dashboard angka dummy, tombol tanpa fungsi, menu tanpa halaman, data hardcoded sebagai data produksi, animasi berlebihan, komponen duplikat, form tanpa validasi, tabel yang tidak mendukung data besar. Data demo harus ditandai jelas. Jangan mengklaim fitur selesai bila baru UI.

**Saat ini belum ada UI sama sekali (semua baru API).** Lihat Track UI di bagian 15.

---

# 13. TESTING DAN QUALITY CONTROL

Agent boleh menulis **dan menjalankan** tes, lalu melaporkan keluaran nyata (bagian 2.3).

Strategi: unit, integration, API, authorization, database transaction, E2E, invariants akuntansi dan inventori, kalkulasi payroll, provider AI, penanganan error. Sampai Tahap 3 pengujian berupa skrip uji sementara di `scripts/`; mulai 4D tulis tes otomatis permanen untuk invarian akuntansi, dan rapikan infrastruktur tes di Tahap 10A.

Kasus wajib: jurnal tidak seimbang ditolak; pengguna tanpa permission tidak bisa memposting; stok tidak berubah tanpa transaksi valid; permintaan duplikat tidak menghasilkan posting ganda; dokumen terposting tidak bisa diedit sembarangan; payroll tidak dihitung tanpa data dan aturan; AI tidak membaca data di luar izin; kegagalan provider AI tidak merusak transaksi ERP; kegagalan satu bagian workflow tidak meninggalkan saldo tidak konsisten.

Jangan pernah menyatakan tes lulus tanpa keluaran eksekusi yang nyata.

---

# 14. DEPLOYMENT DAN OPERASIONAL

Target: Vercel untuk Next.js, PostgreSQL terkelola (Neon), worker terpisah untuk pekerjaan berat, object storage untuk lampiran, provider AI via integrasi server. Rancang: environment variables, konfigurasi produksi, migrasi, backup, error monitoring, structured logging, health check, rate limiting, manajemen koneksi database, penanganan error yang rapi, strategi rollback deployment.

Jangan mengasumsikan semua layanan punya free tier permanen. Jangan menyimpan kredensial produksi di source. **Migrasi dan deployment tidak pernah otomatis**: selalu dengan persetujuan eksplisit (bagian 2.2).

---

# 15. TAHAP PENGERJAAN DAN STATUS PROGRES

Ikuti urutan, jangan melompati tahap. Setiap tahap/langkah dilanjutkan hanya setelah saya menyetujui hasil sebelumnya.

Legenda: ✅ selesai dan disetujui · 🟡 kode sudah ada tetapi ada verifikasi/pengecekan tertunda · ⬜ belum dikerjakan

## Status per tahap

| Tahap | Isi | Status |
|---|---|---|
| 0 | Project Discovery | ✅ (mulai dari nol) |
| 1 | Architecture Blueprint | ✅ |
| 2 | Database dan ERD | ✅ |
| 3A | Init project, env, koneksi Neon + Drizzle, health check | ✅ |
| 3B | Skema Core (identitas, RBAC, organisasi, periode, mata uang, sistem), seed, trigger audit | ✅ |
| 3C | Better Auth, lockout, admin pertama | ✅ |
| 3D | Authz, audit, error terpusat, validasi bersama | ✅ |
| 3E | Manajemen pengguna | ✅ |
| 3F | Role dan permission | ✅ (🟡 uji B, C, D milik 3F-4 belum dilaporkan) |
| 3G | Organisasi: profil perusahaan, pengaturan, cabang, departemen | ✅ |
| 3H | Mata uang, kurs, tahun fiskal, periode akuntansi | ✅ |
| 3I-1 | Penomoran dokumen | ✅ |
| 3I-2 | Service baca audit log | ✅ |
| 3I-3 | Route `GET /api/audit-logs` | ✅ |
| 3J | Mesin alur persetujuan (service atas tabel `approval_*`) | ✅ (schemas + service + 6 route + `scripts/test-approvals.ts` 25 kasus hijau; `0007_approval_guards.sql` sudah di-migrate (guard terverifikasi aktif di DB); permission `core.approvals.request/act/cancel` sudah di-seed; sisa: tes permanen Vitest di 10A) |
| 4A | Permission akuntansi dan registri lintas modul | ✅ |
| 4B-1 | Skema `chart_accounts`, `journal_entries`, `journal_entry_lines` | ✅ |
| 4B-2 | Trigger imutabilitas dan penjaga keseimbangan jurnal | ✅ (diverifikasi lewat `scripts/test-journals.ts` T8 dan `scripts/test-chart-accounts.ts` guard tipe) |
| 4C | Bagan akun | ✅ (kode + seed 38 akun + `scripts/test-chart-accounts.ts` 15 kasus hijau) |
| 4D | Jurnal dan mesin posting | 🟡 (kode + `scripts/test-journals.ts` 18 kasus hijau; 4D-6 tes permanen Vitest menunggu Tahap 10A) |
| 4E | Buku besar dan laporan keuangan dasar | 🟡 (report-schemas + report-service + 4 route `/api/reports/{general-ledger,trial-balance,income-statement,balance-sheet}` + `scripts/test-reports.ts` 29 asersi hijau; sumber baris jurnal `posted`+`reversed`, string desimal, dukung `from`/`to` XOR `periodId`, neraca menyertakan laba ditahan sementara; sisa: tes permanen Vitest di 10A) |
| 4F | Saldo awal, penutupan, pemeriksaan penutupan periode | 🟡 (engine `createSystemDraft` + 2 permission + `retained_earnings_account_id` di settings (validasi akun equity/postable/aktif) + closing-schemas + closing-service (`createOpeningBalanceDraft`, `createClosingEntryDraft` baris otomatis, `closeFiscalYear`) + blokir draf di `changePeriodStatus` + 3 route `/api/{opening-balances,closing-entries,fiscal-years/[id]/close}` + `scripts/test-closing.ts` 33 asersi hijau (satu transaksi, rollback penuh; FY2040 terisolasi; tsc/lint/build 46 route nol); model dua langkah draf→post; guard `0008_closing_guards.sql` sudah di-migrate (trigger `journal_entries_special_source_guard` terverifikasi aktif — test 4F tetap hijau dengan guard live) dan 2 permission (`accounting.opening.manage`, `accounting.closing.manage`) sudah di-seed (total 47) & terhubung ke `super_admin`; sisa: tes permanen Vitest di 10A) |
| 4G | Pajak dan pusat biaya | 🟡 (skema `finance.ts`: `cost_centers` (hirarki `parentId`), `taxes` (akun COA penampung), `tax_rates` (bertanggal efektif, `source` wajib, numeric(9,4) persen, tarif tidak pernah dikarang), `tax_transactions` (subledger + snapshot tarif, tanpa jurnal otomatis — integrasi AP/AR di Tahap 5/6); kolom `cost_center_id` nullable + index parsial di `journal_entry_lines`; 6 permission (`cost_centers`/`taxes`/`tax_transactions` read+manage); aturan numbering `tax_transaction` (prefix TX, tahunan); 3 service (cost-center hirarki, tax master+rate efektif, tax-transaction hitung `base×rate%` HALF_UP 2dp); `costCenterReport` + schema; 8 route `/api/{cost-centers[/{id}],taxes[/{id}[/rates]],tax-transactions[/{id}],reports/cost-center}`; migrasi `0009_tax_and_cost_centers.sql` sudah di-migrate (4 tabel + `cost_center_id` + index/FK terverifikasi lahir); 6 permission sudah di-seed (total 53) & terhubung ke `super_admin`; seed demo `cost-centers-demo.ts` [DEMO] dijalankan (8 cost center hirarki); `scripts/test-tax-cost.ts` 23 asersi hijau (satu transaksi, rollback penuh; FY2041 terisolasi; bao hirarki CC + penolakan kode/izin/nonaktif-punya-anak, akun non-postable, tarif efektif + resolve, snapshot & hitung `1000000×11%=110000`, nomor `TX`, baris jurnal `costCenterId` + validasi tak ditemukan, laporan per CC net 3.800.000); tsc/lint/build 54 route nol; sisa: tes permanen Vitest di 10A) |
| 4H | Kas, bank, pembayaran, rekonsiliasi bank | 🟡 (4H-A/B selesai: skema `finance.ts` `bank_accounts` (master; `accountId` wajib aset+postable, `kind` cash/bank, tanpa kolom saldo — saldo dari GL) & `cash_transactions` (mutasi receipt/disbursement/transfer, enum status draft/posted/reversed/cancelled, check party per type + anti transfer-diri + posted butuh jurnal); auto-post jurnal double-entry reuse `createSystemDraft`+`postJournal` (source `cash_transaction`) & reversal reuse `reverseJournal`; 4 permission (`bank_accounts`/`cash_transactions` read+manage); numbering `cash_transaction` (CT, tahunan); 2 service (bank-account master CRUD + guard nonaktif-bila-dipakai, cash-transaction draf→post→cancel/reverse + list keyset); laporan `cashBook` (mutasi + saldo berjalan per rekening) + schema; 8 route `/api/{bank-accounts[/{id}],cash-transactions[/{id}[/post|/cancel|/reverse]],reports/cash-book}`; migrasi 0010 diterapkan + seed 4 permission (53→57) + `scripts/test-cash.ts` PASS 26 asersi dengan rollback penuh (FY2042 terisolasi: posting receipt/disbursement/transfer auto-jurnal, buku kas per rekening, reversal meniadakan efek, guard non-aset/duplikat/izin/cancel-post-reverse/validasi party/deactivate-dipakai; tsc/lint/build nol). SISA 4H-C selesai kode: skema `bank_statement_lines` (arah in/out, `amount>0`, `reconciliationId`+`matchedCashTransactionId` nullable, index parsial) & `bank_reconciliations` (per rekening+rentang tanggal, saldo statement opening/closing string desimal, `bookBalanceStart`/`bookBalanceEnd` disnapshot dari GL saat finalize, enum status draft/final, docNo `BR` diisi saat final, check final-butuh-nomor+penanda+saldo & draft-tanpa-nomor, `endDate>=startDate`); 2 permission (`accounting.bank_reconciliations` read+manage); numbering `bank_reconciliation` (BR, tahunan); helper `cash-movement.ts` menurunkan arah in/out per rekening dari `cash_transactions` posted (termasuk transfer dua sisi) + daftar id yang sudah tercocok; service `bank-statement-service.ts` (impor JSON array + guard rekening-aktif & anti-baris-identik, list keyset, match manual + validasi arah+nominal & anti-rangkap transaksi + unmatch, blokir bila rekonsiliasi final) & `reconciliation-service.ts` (create + tarik baris statement rentang yang belum tertugaskan, auto-match tolerance±N hari 1-ke-1, finalize: semua-harus-cocok + saldo-statement-akhir==saldo-buku-GL [selisih!=0 -> BUSINESS_RULE] + snapshot bookBalance, terminal; list/get + ringkasan match/unmatch/net); 6 route `/api/{bank-statement-lines[/{id}/match],reconciliations[/{id}[/auto-match|/finalize]]}`; rekonsiliasi bersifat administratif tanpa jurnal (keputusan 4H); periode closed tidak memblokir. Migrasi `0012_bank_reconciliation.sql` diterapkan (rename + journal idx 12) + seed 2 permission (59->61) + `scripts/test-reconciliation.ts` PASS 24 asersi dengan rollback penuh (FY2045 terisolasi: impor 3 baris, match manual + guard arah/nominal BUSINESS_RULE, unmatch, create tarik 3 baris, finalize-ditolak saat baris belum cocok BUSINESS_RULE, auto-match 3, finalize sukses status final + docNo diawali BR + snapshot bookBalanceStart 0.00/bookBalanceEnd 2.150.000 == saldo statement, lock final (finalize/auto-match/match-manual ulang BUSINESS_RULE), filter baca matched=true, dokumen kedua tarik 0 baris + guard selisih saldo BUSINESS_RULE; tsc/lint/build 60 route nol). Sisa 4H: `payments`/`payment_allocations` (AR/AP Tahap 5/6) + tes permanen Vitest (10A) |
| 4I | Anggaran dan laporan arus kas | 🟡 (4I selesai kode: skema `finance.ts` `budgets` (header per tahun fiskal, `branchId` nullable, enum status draft/approved, docNo diisi saat approve, check approved-butuh-nomor+penanda & draft-tanpa-nomor) & `budget_lines` (nominal per akun per periode/ bulan + `costCenterId` nullable, unique parsial tanpa-CC, check `amount>=0`); 2 permission (`accounting.budgets` read+manage); numbering `budget` (BGT, tahunan); service `budget-service.ts` (create draf header+baris, update header, replace-lines, approve draft->approved mengunci, list/get) + guard akun daun-postable/periode-milik-FY-yang-sama/duplikat-baris/cabang-aktif; laporan `budgetRealization` (realisasi = mutasi jurnal `posted`+`reversed` akun pada rentang periode baris, sisi bertanda per tipe akun, filter cabang+pusat biaya) & `cashFlowStatement` (metode LANGSUNG dari `cash_transactions` posted, section operating/investing/financing dari tipe akun lawan, transfer internal dikecualikan, direkonsiliasi ke perubahan saldo GL kas/bank + baris "pergerakan lain"); 6 route `/api/{budgets[/{id}[/lines|/approve]],reports/budget-realization,reports/cash-flow}`; migrasi `0011_budgets.sql` diterapkan + seed 2 permission (57→59) + `scripts/test-budget.ts` PASS 30 asersi dengan rollback penuh (FY2043 terisolasi: create draf header+baris, guard duplikat-baris/akun-induk-nonpostable/periode-lintas-FY, update+replace-lines saat draft, realisasi 4100 Cr=3.000.000 var -2.000.000 & 5220 Dr=800.000 var -200.000 total 6.000.000/3.800.000, arus kas langsung operating net 2.200.000 transfer-0 rekonsiliasi GL cocok & pergerakan-lain 0, approve draft->approved nomor BGT + lock update/replace/approve-ulang; tsc/lint/build nol). Sisa: tes permanen Vitest di 10A; metode tidak langsung arus kas & enforcement anggaran menyusul setelah AR/AP (Tahap 5/6) dan approval workflow (3J)) |
| 5 | Inventory dan Procurement | ✅ (5A–5H selesai) |
| 5A | Master persediaan: produk, kategori, satuan, konversi satuan | ✅ (skema `inventory.ts` + `0013_inventory_masters.sql` DI-MIGRATE (4 tabel + index/FK/check terverifikasi lahir) + 6 permission DI-SEED (61->67) terhubung `super_admin` + `scripts/test-inventory.ts` PASS 29 asersi rollback penuh (guard duplikat kode/SKU CONFLICT, siklus/diri-sendiri BUSINESS_RULE, induk/satuan/kategori tak ada VALIDATION_FAILED, nonaktif-masih-dipakai CONFLICT [kategori 1 produk / satuan 2 rujukan], kategori nonaktif utk produk CONFLICT, satuan nonaktif utk produk BUSINESS_RULE, SKU imutabel, no-change updatedAt, filter daftar, izin FORBIDDEN; tsc/lint/build 68 route nol). Rincian: produk `category_id` nullable + `base_unit_id` wajib + `can_purchase`/`can_sell`; TANPA kolom stok/harga/biaya — stok dari transaksi, FIFO (settings `costing_method=FIFO`/`allow_negative_stock=false` sudah di-seed); warehouse/locations ditunda ke 5B; category-service advisory-lock hirarki + guard siklus; unit-service `assertActiveUnit`; 8 route `/api/{products,product-categories,units,unit-conversions}[/{id}]`. Sisa: tes permanen Vitest 10A) |
| 5B | Gudang & lokasi (warehouse, locations) | ✅ (skema `inventory.ts` + `0014_inventory_warehouses.sql` DI-MIGRATE (2 tabel `warehouses`+`warehouse_locations` + FK/index/check terverifikasi lahir) + 2 permission DI-SEED (67->69) terhubung `super_admin` + `scripts/test-warehouse.ts` PASS 23 asersi rollback penuh). Keputusan: gudang selalu terikat 1 cabang aktif (branchId NOT NULL, `assertActiveBranch` FOR SHARE: tak ada→VALIDATION_FAILED / nonaktif→BUSINESS_RULE); lokasi datar & opsional (`code` unique PER GUDANG — kode sama di gudang beda boleh); blok-nonaktif-gudang-punya-lokasi-aktif CONFLICT; gudang/lokasi/cabang imutabel pd update (kode gudang, kode+gudang lokasi); lokasi boleh nonaktif → gudang lalu boleh nonaktif; lokasi-di-gudang-nonaktif BUSINESS_RULE; no-change updatedAt; filter daftar; NOT_FOUND; FORBIDDEN. Lokasi ikut 2 izin `inventory.warehouses` (konsisten konversi-ikut-satuan 5A); TANPA kolom stok — stok muncul di stock ledger 5E (product+warehouse+location). 4 route `/api/{warehouses[/{id}],warehouse-locations[/{id}]}`; cabang disisipkan langsung via tx.insert dlm tes agar ter-rollback (createBranch tak terima externalTx); tsc/lint/build 72 route nol. Sisa: tes permanen Vitest 10A) |
| 5C | Mesin stock ledger + biaya FIFO (append-only) | ✅ (skema `inventory.ts`: 2 enum (`stock_movement_direction` in/out, `stock_source_type` opening/goods_receipt/goods_issue/transfer/adjustment) + 3 tabel `stock_movements` (append-only; qty numeric(18,3)>0, unitCost(18,4) hanya utk `in` via check, totalCost(18,2), `reverseOfId` self-FK, index product+warehouse+date), `stock_cost_layers` (qtyReceived/Remaining(18,3), unitCost(18,4), check 0<=remaining<=received), `stock_layer_consumptions` (issue->layer, qty>0); 2 permission `inventory.stock.read/manage`; Zod `postStockMovementInputSchema` (refine: `in` wajib unitCost) + query posisi/jarak; service `stock-service.ts` (`postStockMovement` in buat layer / out konsumsi FIFO terlama `FOR UPDATE` + guard stok negatif ditolak BUSINESS_RULE, blended unitCost HALF_UP 4dp; `getStockPosition` agregat onHand+valuation+layerRemaining; `listStockMovements`); `0015_stock_ledger.sql` DI-MIGRATE (rename + journal idx 15; 2 enum + 3 tabel + trigger imutabilitas `erp_stock_movements_immutable` + 4 trigger UPDATE/DELETE/TRUNCATE terverifikasi lahir) + 2 permission DI-SEED (69->71) terhubung `super_admin` + `scripts/test-stock.ts` PASS 16 asersi rollback penuh (FIFO 10@1000+5@1200 -> keluar12 blended 1033.3333 total 12400.00, posisi 3.000/3600.00, lalu in 2@500 di lokasi -> onHand 5.000; guard stok negatif BUSINESS_RULE, ledger append-only UPDATE+DELETE (cek rantai `cause` drizzle QueryFailedError), gudang tak ada VALIDATION_FAILED, lokasi-bukan-milik-gudang/gudang-nonaktif/produk-nonaktif BUSINESS_RULE, jejak 4 baris, izin read+manage FORBIDDEN). Keputusan: layer FIFO per produk+gudang (lokasi dicatat tapi tak mempartisi biaya); source ref generik (enum+sourceId nullable+sourceDocNo, FK konkret di 5D); koreksi via pergerakan penyeimbang (ledger imutabel). tsc/lint/build 0. Sisa: dokumen fisik 5D + tes Vitest 10A) |
| 5D | Dokumen stok fisik (header+baris, state machine) | ✅ (skema `inventory.ts`: 2 enum (`stock_document_type` receipt/issue/transfer/adjustment/opname, `stock_document_status` draft/posted/reversed/cancelled) + 2 tabel `stock_documents` (header polimorfik; `docNo` unique terisi saat post; `branchId` NOT NULL; check `stock_documents_posted_docno_chk` posted-butuh-nomor + `stock_documents_warehouse_chk` kombinasi gudang per jenis termasuk transfer asal≠tujuan) & `stock_document_lines` (productId, from/toLocationId, direction nullable, qty(18,3)>=0, unitCost(18,4) null-or->=0); 2 permission `inventory.documents.read/manage` DI-SEED (71->73) terhubung `super_admin`; aturan numbering GR/GI/TR/ADJ/OP (tahunan); service `document-service.ts` (create draf header+baris, post: kunci header FOR UPDATE + validasi bentuk fail-closed + `nextDocumentNumber` + delegasi SETIAP pergerakan ke mesin FIFO 5C `postStockMovement` (receipt in, issue out, transfer out→in bewarna biaya lapisan, adjustment in/out, opname selisih counted vs posisi→gain in `latestLayerCost`/loss out FIFO), cancel draf→cancelled, reverse posted→reversed via pergerakan penyeimbang `reverseOfId`, list filter type/status/cabang/gudang + get); 5 route `/api/stock-documents[/{id}[/post|/cancel|/reverse]]`; migrasi `0016_stock_documents.sql` DI-MIGRATE (exit 0; rename + journal idx 16; 2 enum + 2 tabel + FK/index/check + trigger imutabilitas `erp_stock_documents_immutable` ( kunci jenis/cabang/tanggal/gudang/nomor pasca-draf) & `erp_stock_document_lines_immutable` (baris non-draf tak boleh ubah/hapus) + 2 truncate guard terverifikasi lahir) + `scripts/test-documents.ts` PASS 26 asersi rollback penuh (satu transaksi; GR/GI FIFO, transfer bewarna 4000.00, adjustment, opname gain A9 val 15000.00 + loss C3 val 300.00, cancel draf, post-cancelled BUSINESS_RULE, reverse D 8→5 + reverse-ulang BUSINESS_RULE, guard UPDATE/DELETE non-draf (cek rantai `cause`), receipt-tanpa-biaya & transfer-gudang-sama VALIDATION_FAILED, lokasi-salah-gudang BUSINESS_RULE, list filter receipt+posted mengecualikan reversed, get NOT_FOUND, izin read+manage FORBIDDEN). Keputusan: bentuk polimorfik 1 header+1 lines; koreksi cancel saat draf + auto-reverse saat posted; `branchId` di header + validasi semua gudang satu cabang aktif. tsc/lint/build 0. Sisa: penjurnalan GL dokumen (→ 5G/6), integrasi approval 3J, tes permanen Vitest 10A) |
| 5E | Batch / serial / expiry (mesin FEFO di atas dokumen 5D) | 🟡 (skema `inventory.ts`: enum `product_tracking` (none/batch/serial/both) + kolom `products.tracking`/`needsExpiry`; 2 tabel `stock_batches` (productId NOT NULL, batchNo, expiryDate nullable, unique product+batchNo, index expiry, check trim>0) & `stock_serials` (productId, batchId nullable, serialNo unique global, status enum `serial_status` in_stock/issued/returned default in_stock, warehouseId/movementId nullable, index product+status, check trim>0); kolom `batchId` di `stock_movements`, `batchId`+`expiryDate` snapshot di `stock_cost_layers` (+ index `stock_cost_layers_fefo_idx` product+wh+expiry+date+id), `batchNo`/`batchExpiryDate`/`batchId`/`serialNumbers`(jsonb) di `stock_document_lines`. Zod: `productTrackingValues`, `batchNoSchema`, `serialNoSchema`, baris dokumen + batch/serial, input mesin + `batchId`, produk + tracking/needsExpiry. `product-service`: plumbing tracking/needsExpiry + guard ubah tracking/needsExpiry HANYA sebelum produk punya pergerakan (BUSINESS_RULE). `stock-service.postStockMovement`: validasi batch (ada, milik produk, `out` batch eksplisit expired -> BUSINESS_RULE), `batchId` di common+layer+`expiryDate` snapshot, urutan FEFO `expiryDate ASC NULLS LAST, movementDate, id` + filter LEWATI layer expired (`expiryDate is null or >= movementDate`), constraint antrian ke batch bila batchId eksplisit, REVERSAL (`reverseOfId` terisi) DIBEBASKAN dari aturan expiry. `document-service.ts` (post/cancel/reverse/list/get + batch inline lahir di baris GR/adjust-in lewat `ensureBatchForInbound`, tolak terima batch expired & expiry-conflict; serial: `registerSerials` in / `markSerialsIssued` out / `moveSerialsTo` transfer / opname set-diff gain+loss; reverse meneruskan `batchId` + serial per kepemilikan pergerakan; re-validasi bentuk fail-closed saat post). 0 permission baru (naik izin documents/products). migrasi `0017_stock_batch_serial.sql` DI-MIGRATE (exit 0; rename `0017_certain_lightspeed`+journal idx 17; 2 enum + 2 tabel + ALTER products/movements/cost_layers/document_lines + FK/unique/index + 2 truncate guard `erp_forbid_truncate`; batch/serial TIDAK dibuat immutable karena status diubah mesin). `scripts/test-batch-serial.ts` PASS 18 asersi rollback penuh (needsExpiry tanpa tanggal VALIDATION_FAILED, GR batch expired BUSINESS_RULE, 2 batch inline + expiry, FEFO normal B-EARLY -2 val1300, skip-expired B-LATE -2 val900, issue eksplisit expired BUSINESS_RULE, opname per batch val700, guard ubah tracking BUSINESS_RULE, reverse batch expired bypass onHand 0, serial qty-mismatch VALIDATION_FAILED, GR 2 unit in_stock, issue S-001 issued, issue ulang BUSINESS_RULE, serial duplikat VALIDATION_FAILED, produk none tolak batch VALIDATION_FAILED, cancel draf). Regresi `scripts/test-documents.ts` tetap PASS 26 asersi. tsc/lint/build 0. SISA: laporan batch/expiry + tes Vitest permanen (5H/10A)) |
| 5F | Procurement berpusat PO (master + lifecycle + GR-dari-PO) | ✅ (skema baru `procurement.ts` + `0018_procurement_master_po.sql` DI-MIGRATE (rename `0018_empty_tinkerer`+journal idx 18; exit 0; 1 enum `purchase_order_status` (draft/pending_approval/approved/posted/cancelled) + 4 tabel `payment_terms` (code unique, dueInDays>0), `suppliers` (code unique, currency char(3) FK default IDR, paymentTermsId FK nullable), `purchase_orders` (docNo unique, supplier/branch/currency FK, exchangeRate(18,6), totalBase(18,2), check docno hanya posted, posted-butuh-rate>0, currency upper/len3, cancelled-butuh-penanda+alasan) & `purchase_order_lines` (poId FK cascade, lineNo>=1 unique po+line, productId FK, qty(18,3)>0, unitPrice(18,4)>=0, amountForeign/baseAmount(18,2), quantityReceived(18,3)) + FK/index/check + guard terverifikasi lahir: 4 truncate `erp_forbid_truncate` + imutabilitas `erp_purchase_orders_immutable` (kunci supplier/cabang/tanggal/valas pasca-draf; status/docNo/kurs/totalBase/cap-waktu tetap boleh ditulis mesin) + `erp_purchase_order_lines_immutable` (kunci komposisi produk/qty/harga/valas non-draf; baseAmount saat post & quantityReceived saat GR tetap boleh) — header `approved->posted` dan GR pasca-post lolos guard); 9 permission `purchasing.*` DI-SEED (73->82) terhubung `super_admin`; aturan numbering `purchase_order` (PO, tahunan, 5); helper `resolveRateToBase` ( Kurs ke mata uang dasar; base==code→1.000000; else rate≤tanggal DESC; tak ada→BUSINESS_RULE) + `_refs` (assertActiveCurrency FOR SHARE, requirePurchasableProduct canPurchase, assertActiveBranch, assertReceivingWarehouse milik-cabang); service: `payment-terms-service`/`supplier-service` CRUD master (nonaktif≠hapus), `po-service` lifecycle create(draf)+update(hanya draf, delete-reinsert baris)+cancel+submit(`submitApproval` docType `purchase_order`, amount=taksiran totalBase mengvalidasi kurs awal)+approve(tuntut approval_request approved)+post(snapshot kurs, hitung baseAmount/totalBase, `nextDocumentNumber`) + `requirePostedPurchaseOrder`/`loadOpenPoLineQuantities` (sisa=ordered−received, unitCostBase=baseAmount/qty dp4), `gr-from-po-service.createReceiptFromPo` orkestrasi mesin stok 5D/5E (`createStockDocument` receipt + `postStockDocument`, biaya=unitCostBase PO, over-receipt BUSINESS_RULE, `quantityReceived` via aritmetika numeric DB, batch/serial inline); 11 route `/api/purchasing/{payment-terms,suppliers,purchase-orders}[/{id}[/submit|/approve|/post|/cancel|/receipts]]`; `scripts/test-purchasing.ts` PASS 23 asersi rollback penuh (satu transaksi; master IDR, draf→submit→approve→post docNo PO- kurs 1.000000 totalBase 10000.00, GR 4/10 onHand 4.000 val 4000.00 biaya-PO, quantityReceived 4.000, over-receipt 7>6 BUSINESS_RULE, USD tanpa kurs BUSINESS_RULE, GR batch inline (B-2026+expiry) onHand 5.000 val 10000.00, guard UPDATE baris/header non-draf (cek rantai `cause`), cancel draf + cancel-posted BUSINESS_RULE, FORBIDDEN read/manage, NOT_FOUND); keputusan terkunci: (1) post PO WAJIB approval_request approved — tanpa alur cocok BUSINESS_RULE, (2) GR menghargai lapisan biaya PO (bukan harga standar), (3) toleransi over-receipt 0, (4) PPN & invoice-off-PO & PPV ditunda ke 5G. tsc/lint/build nol. SISA: jurnal GR/IR+AP+FX (5G), laporan/validasi (5H), tes Vitest permanen (10A)) |
| 5G | Tagihan pemasok, three-way match, AP, pembayaran+alokasi, jurnal GR/IR+FX | ✅ (skema `payables.ts` + `0019_ap_grir.sql` DI-MIGRATE (rename `0019_fluffy_archangel`+journal idx 19; 2 enum `supplier_invoice_status`/`ap_payment_status` (draft/posted/reversed/cancelled) + 4 tabel `supplier_invoices` (docNo, supplierId/branchId/poId FK, currency+exchangeRate(18,6), invoiceDate/dueDate, amountForeign/totalBase(18,2), journalEntryId, status, check docno & posted-butuh-rate/total), `supplier_invoice_lines` (invoiceId cascade, lineNo unique, productId/poLineId nullable, quantityBilling(18,3)>0, unitPrice(18,4)>=0, amountForeign(18,2), amountBase nullable), `ap_payments` (docNo, supplierId/branchId FK, currency, paymentDate, amountForeign/amountBase(18,2), bankAccountId FK, journalEntryId, check docno/posted/amount>0), `ap_payment_allocations` (paymentId cascade, invoiceId FK, amountBase/Foreign>0, unique payment+invoice) + journal_entry_lines ALTER FX (currency/exchangeRate/amountBase nullable) + 4 truncate guard + imutabilitas `erp_supplier_invoices_immutable`/`erp_supplier_invoice_lines_immutable`/`erp_ap_payments_immutable`/`erp_ap_payment_allocations_immutable`; MIGRASI KOREKTIF `0020_ap_grir_docno_chk_fix.sql` DI-MIGRATE (drop+add `supplier_invoices_docno_chk` & `ap_payments_docno_chk` → docNo boleh untuk status reversed: draft/cancelled⇒null, posted/reversed⇒not-null); 5 permission `purchasing.ap.{read,manage}`+`purchasing.payments.{read,manage}`+`purchasing.grir.read` DI-SEED (82->87) terhubung `super_admin`; config `company_settings` 3 kunci `inventory_account_id`(1300)/`grir_account_id`(2115)/`ap_account_id`(2110) via `ap-account-config.resolveApAccountIds` fail-closed + seed-coa idempotent menambah 2115; helper `resolveRateToBase`; service: `gr-from-po-service` kini memposting jurnal GR Dr Inventory/Cr GR-IR (reuse `createSystemDraft`+`postJournal` source `purchase_receipt`), `invoice-service` (create draf+three-way match qty≤diterima & toleransi harga 0.01 vs PO → BUSINESS_RULE, post Dr GR-IR/Cr AP source `supplier_invoice`, cancel draf, reverse posted→reverseJournal, `listOpenInvoices`+`loadOpenInvoicesForSupplier` FIFO, `getAllocatedBaseByInvoice`), `ap-payment-service` (create draf validasi supplier/cabang/bank-GL/mata-uang, post resolveRate→amountBase + alokasi FIFO (over-payment/leftover>0→BUSINESS_RULE) + jurnal Dr AP/Cr Bank source `ap_payment` + insert alokasi, cancel draf, reverse→reverseJournal+hapus alokasi); 11 route `/api/purchasing/{invoices,payments}[/{id}[/post|/cancel|/reverse]]` + `suppliers/[id]/open-invoices`; `scripts/test-ap-grir.ts` PASS 30 asersi rollback penuh (FY2041+config in-tx; siklus penuh GR Dr1300/Cr2115 6000 → invoice match Dr2115/Cr2110 6000 → bayar Dr2110/Cr1111 6000 FIFO 1 alokasi → AP kosong; guard invoice-posted-ubah-supplier & alokasi-langsung (cek `cause`), reversal pembayaran→alokasi 0+invoice terbuka lagi, reversal invoice→reversed, mismatch harga(1100≠1000)/qty(6>5) BUSINESS_RULE, over-payment BUSINESS_RULE, cancel draf+cancel-posted BUSINESS_RULE, FORBIDDEN/NOT_FOUND). Regresi `test-purchasing.ts` PASS 23 (ditambah FY+config akun+journals.post untuk jurnal GR), `test-documents` 26, `test-batch-serial` 18, `test-journals` rollback OK; tsc/lint/build 0 (11 route baru). Keputusan terkunci: (1) three-way match harga TERKUNCI ke PO (toleransi 0.01, tanpa PPV), (2) TANPA invoice off-PO (wajib poId), (3) PPN/pendapatan-pendapatan ditunda, (4) jurnal selalu dalam mata uang dasar (kolom FX baris jurnal hanya referensi). SISA: laporan+rekonsiliasi subledger-GL (5H), tes Vitest permanen (10A)) |
| 5H | Laporan & rekonsiliasi persediaan/pembelian | ✅ (kolom `products.reorder_point` numeric(18,3) nullable + check `>=0`; migrasi `0021_product_reorder_point.sql` DI-MIGRATE; 1 permission `purchasing.reports.read` DI-SEED (total 90) terhubung `super_admin`; plumbing reorderPoint di Zod schemas + product-service; 4 laporan inventory read-only (`stockCard` kartu stok+saldo berjalan, `inventoryValuation` valuasi lapisan FIFO per produk+gudang, `reorderReport` produk stok < reorder point, `expirySchedule` jadwal kedaluwarsa FEFO) izin `inventory.stock.read`; 3 laporan purchasing read-only (`apAging` bucket current/1-30/31-60/61-90/90+ dari sisa invoice posted, `purchaseReport` ringkasan PO/GR/invoice/payment per supplier, `apGlReconciliation` invariant subledger==GL utk AP/GR-IR/Inventory dari jurnal posted+reversed) izin `purchasing.ap.read`/`purchasing.reports.read`; 7 route GET `/api/reports/{stock-card,inventory-valuation,reorder,expiry-schedule,ap-aging,purchase,ap-reconciliation}`; `scripts/test-purchase-flow.ts` PASS 17 asersi rollback penuh (kartu stok 2 pergerakan saldo 11/11000, valuasi 2 lapisan 11000, reorder point 20 onHand 11 saran 9, aging 31-60 = 5000, purchase report PO 2/18000 GR 11/11000 inv 2/11000 pay 1/6000 outstanding 5000, rekonsiliasi 3 akun selisih 0, expiry lapisan B 29-hari+expired tersaring); `scripts/test-ap-reconciliation.ts` PASS 25 asersi rollback penuh (4 tahap invariant recon: terima→0/6000/6000, tagih→4000/2000/6000, bayar→2000/2000, reversal→4000/2000); regresi `test-ap-grir.ts` 30, `test-purchasing.ts` 23; tsc/lint/build nol (34 route). Keputusan terkunci: (1) laporan selalu sumber ledger posted (movements/layers/invoices/payments), (2) rekonsiliasi memakai jurnal posted+reversed (saling meniadakan), (3) inventory subledger==GL hanya valid tanpa issue (engine stok tak posting GL untuk pengeluaran), (4) aging berbasis hari sejak dueDate vs asOf). SISA: tes permanen Vitest 10A) |
| 6 | Sales dan CRM | ✅ (6A–6F selesai) |
| 6A | Permission CRM+Sales, numbering, config akun AR | ✅ (2 permission registry: `crm/permissions.ts` ~11 kode read/manage + `sales/permissions.ts` ~9 kode incl. `sales.ar.read`/`sales.reports.read`, di-spread ke `allPermissions` dan DI-SEED (total →132) terhubung `super_admin`; aturan numbering `sales_quotation`(SQ)/`sales_order`(SO)/`sales_delivery`(DLV)/`sales_return`(SRT)/`sales_credit_note`(CN)/`customer_payment`(CMP) tahunan (customer_invoice INV per-cabang sudah ada dari Tahap 3); helper `ar-account-config.resolveArAccountIds` baca 5 kunci `company_settings` (`ar/revenue/cogs/tax_payable/inventory_account_id`) fail-closed (aktif+postable+tipe benar); tsc/lint nol, belum DB gate — permission menunggu tabel siap) |
| 6B | Skema CRM (`0022_crm_core.sql`) | ✅ (`src/db/schema/crm.ts`: 5 enum (`crm_account_type` prospect/customer/partner, `crm_lead_status`, `crm_opportunity_status`, `crm_activity_type`, `crm_task_status`) + 13 tabel (`crm_accounts`, `crm_contacts`, `crm_leads`, `crm_pipeline_stages`, `crm_opportunities`, `crm_activities`, `crm_tasks`, `crm_notes`, `crm_segments`, `crm_account_segments` PK komposit, `customers` 1:1 `crmAccountId` unique + `creditLimit(18,2)` + `priceListId`, `price_lists`, `price_list_items`); master CRM mudah diubah — TANPA trigger imutabilitas dokumen finansial; migrasi `0022` DI-MIGRATE + `db:seed` permission + smoke SELECT tiap tabel) |
| 6C | Service + route CRM | ✅ (12 service `src/modules/crm/*` (account/contact/lead+pipeline/opportunity+moveStage/activity/task/note/segment/customer/price-list), `convertLead` bikin account+customer+contact 1 transaksi; ~30 route `/api/crm/*`; pola mirror 5A/5B create→read→update(nonaktif≠hapus)→list keyset→guard duplikat/izin/rujukan; `scripts/test-crm.ts` PASS 58 asersi rollback penuh (satu transaksi; CONFLICT duplikat, NOT_FOUND, FORBIDDEN, convertLead, closeOpportunity→moveStage BUSINESS_RULE); gate DB hijau) |
| 6D | Skema penjualan + AR (`0023_sales_schema.sql`) | ✅ (`src/db/schema/sales.ts` (4 enum status + `sales_quotations`/`_lines`, `sales_orders`/`_lines` `quantityDelivered`, `sales_deliveries`/`_lines` `unitCost`/`cogsAmount`, `sales_returns`/`_lines`) + `src/db/schema/receivables.ts` (3 enum + `customer_invoices`/`_lines`, `customer_payments`, `customer_payment_allocations`, `sales_credit_notes`/`_lines`); guard docNo `draft/cancelled⇒null; posted/reversed⇒not-null` (pelajaran 0020), check posted-butuh-rate/total/journal, imutabilitas header+baris non-draf, `dates_chk dueDate>=invoiceDate`, `total= subtotal+tax`; migrasi `0023` DI-MIGRATE + verifikasi tabel/FK/check) |
| 6E | Alur penjualan + AR + jurnal | ✅ (service `quotation`(create/send/accept), `so`(create→submitApproval docType `sales_order`→approve[Butuh approvalRequests approved + SoD approver≠pengaju]→post[snapshot kurs + credit-limit: Σ invoice posted − Σ alokasi payment posted + SO ≤ limit → BUSINESS_RULE]), `delivery`(post: konsumsi FIFO via `postStockMovement` + jurnal Dr COGS/Cr Inventory + `quantityDelivered`), `return`(goods receipt kembali + reverse COGS), `invoice`(post: Dr AR/Cr Revenue + Cr TaxPayable + `createTaxTransaction` PPN output), `payment`(post: Dr Bank/Cr AR + alokasi FIFO urut dueDate), `credit-note`(Dr Revenue/Cr AR); 25+ route `/api/sales/*` + `/api/receivables/*`; `scripts/test-sales-flow.ts` PASS 35 asersi rollback penuh + regresi `test-crm` 58. BUG diperbaiki lewat gerbang: (1) `payment-service` arah jurnal AR dibalik Dr Bank/Cr AR (kas masuk — mirror keliru dari AP), (2) `so-service` SQL `SUM(amount_base)` ambigu (42702) → `ca.amount_base`, (3) `so-service` `tx.execute` mengembalikan QueryResult obyek (`.rows`) bukan array → `{} is not iterable`, (4) `invoice-service` `cmp(dueDate, invoiceDate)` memasukkan tanggal ke helper Decimal → bandingkan string ISO) |
| 6F | Laporan Sales/AR + rekonsiliasi | ✅ (`report-schemas.ts` (`arAgingQuerySchema`/`salesReportQuerySchema`/`arReconciliationQuerySchema`) + `report-service.ts`: `arAging` (invoice posted − alokasi payment posted − credit note posted, bucket current/1-30/31-60/61-90/90+ berdasar `daysOverdue` vs `asOf`, izin `sales.ar.read`), `salesReport` (agregasi per pelanggan SO/delivery/invoice/credit/payment + outstanding, izin `sales.reports.read`), `arGlReconciliation` (invariant `Σ invoice posted − Σ payment posted − Σ credit note posted == GL net akun AR (debit−kredit)` sumber jurnal posted+reversed, mirror AP 5H); 3 route GET `/api/reports/{ar-aging,sales,ar-reconciliation}`; `scripts/test-sales-reconciliation.ts` PASS 20 asersi rollback penuh (recon 4 tahap: awal 0 → invoice 222000 → bayar 0 → credit note −20000, tiap tahap matched; aging 1 baris→0 baris; report totals; sanity GL AR net) + regresi `test-sales-flow` 35 + `test-crm` 58; tsc/lint nol. Keputusan: baris rekonsiliasi Inventory TIDAK di-assert di fixture Sales terisolasi — stok opening via `postStockMovement` tak menulis jurnal GL (kewenangan saldo-awal 4F), hanya invariant AR yang dijamin di tahap ini) |
| 7 | HR dan Payroll | ✅ (7A–7F selesai) |
| 7A | Permission HR+Payroll, registri, numbering, config akun GL payroll | ✅ (22 permission `hr/*` (positions/employees/contracts/documents/shifts/attendance/leaves/overtime/evaluations/training read+manage + `hr.self.view` + `hr.reports.read`) + 16 permission `payroll/*` (structures/components/statutory/periods/runs read+manage + `runs.post` + adjustments/payslips read+manage + `self.payslip` + `reports.read`) di-spread ke `allPermissions` dan DI-SEED (total 132→170) terhubung `super_admin`; data personalia (`hr.*`) dipisah dari remunerasi (`payroll.*`) sesuai keputusan 7A; 7 aturan numbering `employee`(EMP)/`employment_contract`(KTR)/`leave_request`(CVT)/`overtime_request`(OTR)/`payroll_period`(PRD)/`payroll_run`(PR, bulanan)/`payslip`(PS, bulanan); helper `payroll-account-config` baca 6 kunci `company_settings` (`salary_expense`/`bpjs_expense`/`payroll_payable`/`pph21_payable`/`bpjs_payable`/`other_deduction_payable_account_id`) fail-closed; tsc/lint nol) |
| 7B | Skema HR + FK `users.employee_id` (`0024_hr_schema.sql`) | ✅ (`src/db/schema/hr.ts`: enum status karyawan/kontrak/absensi/cuti/lembur/dokumen/evaluasi/pelatihan + tabel jabatan, karyawan (1:1 `userId` unique, `managerId` self-ref), dokumen, kontrak, shift, absensi (unique karyawan+tanggal), jenis cuti + saldo cuti (unique karyawan/jenis/tahun), pengajuan cuti, pengajuan lembur, evaluasi kinerja, program & pendaftaran pelatihan; master/operasional — dinonaktifkan bukan dihapus, TANPA trigger imutabilitas finansial; kolom `users.employee_id`; migrasi `0024` DI-MIGRATE + `db:seed` + smoke SELECT tiap tabel) |
| 7C | Service + route HR + self-service | ✅ (service `src/modules/hr/*` position/employee/contract/document/shift/attendance/leave(+saldo)/overtime/evaluation/training + employee self-service (resolve user sesi → karyawan lewat `resolveOwnEmployee`); route `/api/hr/*`; pola mirror 5A/5B/6C create→read→update(nonaktif≠hapus)→list keyset→guard duplikat/izin/rujukan + persetujuan cuti/lembur; `scripts/test-hr.ts` PASS 70 asersi rollback penuh (CONFLICT duplikat, NOT_FOUND, FORBIDDEN, lifecycle absensi/cuti/lembur; gate DB hijau) |
| 7D | Skema payroll (`0025_payroll_schema.sql`) | ✅ (`src/db/schema/payroll.ts`: struktur & komponen gaji (earning/deduction; basis fixed/rate/att present; flag `includeInTaxBase`/`includeInBpjsBase`), kompensasi karyawan berlaku-tanggal + nilai komponen + penyesuaian, `statutory_rules` (kind pph21/bpjs_*, party employee/employer, tarif, `source` wajib — tidak mengarang angka regulasi), periode payroll (draft/finalized/posted/closed), run + item + komponen run (snapshot basis), slip gaji; guard docNo/status; migrasi `0025` DI-MIGRATE + smoke verifikasi tabel/FK/check) |
| 7E | Mesin payroll + jurnal + route | ✅ (mesin KONFIGURATIF: `calculation` aritmetika desimal (ruleBase pph21→taxBase, bpjs_*→bpjsBase, employer BPJS jadi baris komponen sendiri), `journal-builder` akrual (Dr beban gaji+BPJS / Cr utang gaji net + PPh21 + BPJS + potongan lain) selalu seimbang, `run-service` lifecycle create→calculate→approve (SoD: pembuat≠approver)→post (jurnal + slip issued + periode posted)→cancel/reverse (slip void), self-service slip; route `/api/payroll/*`; `scripts/test-payroll-flow.ts` PASS 32 asersi rollback penuh (satu transaksi; FY2035 + 6 akun GL + 6 settings in-tx; actorB grants super_admin reuse untuk SoD; gross 11.500.000 / deductions 1.420.000 / net 10.080.000; jurnal seimbang 12.050.000; guard BUSINESS_RULE/FORBIDDEN lifecycle; gate DB hijau) |
| 7F | Laporan HR/Payroll + rekonsiliasi GL | ✅ (`payroll/report-service` (izin `payroll.reports.read`): `payrollCostByDepartment` (beban per departemen: gross/potongan/net/pajak/BPJS pekerja+pemberi/potongan lain/totalCost=gross+BPJS pemberi), `payslipRegister`, `payrollGlReconciliation` (invariant subledger run `posted` == GL net akun payroll dari jurnal `posted`+`reversed`, mirror AR/AP 5H/6F — run reversed ternet 0 di kedua sisi); `hr/report-service` (izin `hr.reports.read`): `headcountByDepartment`, `attendanceSummary` (rekap per status + lembur), `leaveBalancesReport` (sisa=total−pakai, string desimal); 6 route GET `/api/reports/{payroll-by-department,payslip-register,payroll-reconciliation,hr-headcount,hr-attendance,hr-leave-balances}`; `scripts/test-payroll-reconciliation.ts` PASS 24 asersi rollback penuh (recon `balanced`+tiap baris `matched` saat posted & tetap matched nol pasca-reverse; byDept/slip register/headcount/attendance/leave; regresi `test-payroll-flow` 32, `test-hr` 70, `test-sales-flow` 35, `test-sales-reconciliation` 20, `test-crm` 58; tsc/lint nol). SISA: tes permanen Vitest 10A) |
| 8 | Aset, Proyek, Reporting, background jobs | ✅ (8A–8E selesai) |
| 8A | Permission Aset/Proyek/Reporting, numbering, config akun aset | ✅ (`assets/permissions.ts` (categories/register/acquisitions/depreciation(+`post` SoD)/disposal/revaluation/reports), `projects/permissions.ts`, `reporting/permissions.ts` di-spread ke `allPermissions` + DI-SEED (total →197) terhubung `super_admin`; aturan numbering `fixed_asset`(FA)/`asset_acquisition`(ACQ)/`depreciation_run`(DRP, bulanan)/`asset_disposal`(DSP)/`asset_revaluation`(RVY)/`project`(PRJ)/`export_job`(EXP); helper `asset-account-config` (cost/accum-dep/dep-expense/disposal-loss/disposal-gain/cash) fail-closed; tsc/lint nol) |
| 8B | Aset tetap: skema + mesin + rute + laporan | ✅ (`src/db/schema/assets.ts` + migrasi `0026_assets` DI-MIGRATE: enum metode penyusutan (straight_line/declining_balance/units_of_production)/status aset/lifecycle run + tabel categories, fixed_assets, acquisitions, depreciation_schedules, depreciation_runs(+items), transfers, maintenance, disposals, revaluations, usage_entries; guard numeric>=0 + docNo status + imutabilitas pasca-post; service category/register/acquisition(standalone Dr Aset/Cr Bank-Kas-Utang reuse `createSystemDraft`+`postJournal`)/depreciation-engine 3 metode (money.ts HALF_UP)/run create→calculate→approve(SoD)→post→reverse/transfer/disposal/revaluasi; 28 route `/api/assets/*`; `assetGlReconciliation` (invariant subledger==GL); `scripts/test-asset-flow.ts` PASS 39 + `test-asset-reconciliation.ts` PASS 22 rollback penuh; gate DB hijau) |
| 8C | Proyek = cost center + profitabilitas | ✅ (`src/db/schema/projects.ts` + migrasi `0027_projects` DI-MIGRATE: projects (taut/buat 1 cost center, guard 1:1), tasks, assignments, milestones, budgets; expense DICATAT via baris jurnal ber-tag `costCenterId` (tanpa tabel expense — keputusan "proyek = cost center"); service CRUD + link cost-center + `projectProfitability` (pendapatan/beban/margin dari baris jurnal `posted`+`reversed` ber-tag cc, variance vs budget reuse pola 4I); route `/api/projects/*` + `/api/reports/project-profitability`; `scripts/test-project-flow.ts` PASS 34 + regresi `test-tax-cost.ts` PASS 23 rollback penuh. BUG nyata diperbaiki di gerbang: `reverseJournal` kini MENyalin `costCenterId` (dan dimensi analitik lain) ke baris terbalik — sebelumnya baris reversal kehilangan tag cc sehingga profitabilitas/reconciliation salah net) |
| 8D | Dashboard + Ekspor CSV + tabel job (antrean Postgres) | ✅ (`src/db/schema/jobs.ts` `job_runs` + migrasi `0028_jobs` DI-MIGRATE (enum `job_type`/`job_status`, payload/result jsonb, artifactText/contentType/fileName, attempts/maxAttempts/runAt/claimedAt/finishedAt/lastError, idempotencyKey, index status+runAt, unique parsial idempotensi, check attempts & artifact) + `0029` DI-MIGRATE (tambah `created_at`/`updated_at` konvensi `timestamps()`); `job-service`: `enqueueExport`/`listJobs`/`getJob`/`getJobArtifact`/`cancelJob`/`runNextJob` + klaim `FOR UPDATE SKIP LOCKED` + retry backoff eksponensial + dead-letter `failed`; registri handler exhaustif `Record<JobType, JobHandler>`; `reporting/export-catalog.ts` 27 laporan (type-erase hasil laporan -> CSV, reuse service existing, tanpa duplikasi query) + `csv.ts`; `dashboard-service` 8 dashboard (executive/finance/cash-flow/sales/purchasing/inventory/hr/payroll) menyusun ulang laporan dalam SATU transaksi snapshot; 13 route (`/api/reports/export[/jobId]` download, `/api/jobs[/{id}[/cancel]]`, `/api/dashboard/*`); `scripts/test-jobs-export.ts` rollback penuh hijau. BUG klaim diperbaiki: `now()` (waktu awal transaksi beku) -> `clock_timestamp()` agar job instan yang enqueue+klaim serumah transaksi langsung jatuh tempo) |
| 8E | Worker + rewiring beban berat (payroll.run) | ✅ (tanpa skema baru; migrasi `0030_familiar_yellowjacket` DI-MIGRATE `ALTER TYPE job_type ADD VALUE 'payroll.run'`; handler `payroll.run` memindahkan kalkulasi massal ke antrean (`runPayrollRun` memanggil `calculateRun`), `enqueuePayrollRun` (izin `payroll.runs.manage`, idempotensi default `payroll.run:<runId>`); `POST /api/payroll/runs` create run -> auto-enqueue kalkulasi (run tetap `draft` sampai worker selesai; aksi `calculate` manual dipertahankan); `runNextJob` digeneralisasi per-jenis via `JOB_EXECUTOR_PERMISSION` (`Record<JobType, PermissionCode>`) + `claimNextJob` filter jenis -> spesialisasi worker (worker payroll tak mengklaim job ekspor; `noGrants` ditolak sebelum klaim); `scripts/worker.ts` daemon poll `runNextJob` + heartbeat + graceful stop SIGINT/SIGTERM + `package.json` script `jobs:worker`; `scripts/test-worker.ts` PASS 27 asersi rollback penuh + regresi `test-jobs-export.ts` hijau + `test-payroll-flow.ts` PASS 32; tsc/lint nol. CATATAN OPERASIONAL: worker adalah proses LONG-RUNNING tersendiri (VM/container/Fly/Railway), BUKAN proses serverless Vercel — bangunkan terjadwal (cron/scrub) yang memanggil satu siklus `runNextJob` bila tanpa daemon; konkurensi aman oleh SKIP LOCKED) |
| 9 | Integrasi AI | 🟡 (9A–9C selesai; 9D–9F ⬜) |
| 9A | Keputusan provider + kuota/harga + kill-switch | ✅ (verifikasi sumber resmi Google Okt 2026: free tier hanya Flash/Flash-Lite dan **konten dipakai untuk pelatihan** — karena itu asisten WAJIB minimisasi data (hanya kirim metadata laporan + angka agregat, tanpa PII/baris jurnal); provider dipilih dari `ai_settings.provider` (`gemini`\|`fake`\|`none`); kill-switch dua lapis = `ai_settings.enabled` (fungsional, selalu ditegakkan) AND `AI_ENABLED` (env, guard egress GLOBAL yang hanya wajib saat provider nyata Gemini dipakai — provider offline/fake tak menyentuh jaringan); model/limit KONFIGURATIF di `ai_settings` (bukan hard-code) karena kuota berubah-ubah; env `GEMINI_API_KEY`/`GROQ_API_KEY` sudah ada) |
| 9B | Substrat AI: skema + provider + kuota + izin | ✅ (`src/db/schema/ai.ts` `ai_settings` (singleton dijaga unique index) + `ai_requests` (log METADATA saja — TANPA prompt/response) + migrasi `0031_funny_princess_powerful` DI-MIGRATE (enum `ai_provider`/`ai_request_status`, index `(user_id,created_at)`, guard token/limit); abstraksi `provider.ts` (interface `AiProvider`, `AiError` klas `config/bad_request/upstream_rate_limit/transient/timeout`, `resolveProvider`) — `providers/gemini.ts` REST free-tier via `fetch` (tanpa SDK baru, `AbortController` timeout, retry≤2 hanya transient/429-upstream, token dari `usageMetadata`), `providers/fake.ts` deterministik tanpa jaringan; `quota.ts` rate-limit/kuota per pengguna best-effort (menghitung panggilan yang benar-benar menyentuh provider), `usage-log.ts`, `settings-service.ts` + route `GET/PUT /api/ai/settings`; 3 permission `ai.{settings.read,settings.manage,assistant.use}` DI-SEED (total →200) terhubung `super_admin`; `scripts/test-ai-assistant.ts` (fake) + tsc/lint nol. `ai.requests.read` (dasbor 9F) sengaja BELUM dibuat — tanpa kode mati) |
| 9C | Asisten bahasa-alami → laporan (registri + intent + otorisasi) | ✅ (`assistant-service.ts` alur satu arah deterministik sesuai bag-18: klasifikasi intent (JSON ketat via provider, katalog = **hanya laporan yang diizinkan actor** hasil filter `can()` atas `EXPORT_ENTRIES`) → validasi parameter dengan `entry.parseQuery` skema laporan sumber → **cek otorisasi ULANG di server** (jangan percaya model) → angka NYATA dari `entry.build` service laporan (sumber kebenaran) → ringkasan AI atas data yang sudah di-`redact.ts` (buang id/PII/kolom nama-personal, TOP_N=8, clamp 120 char). **Tanpa SQL bebas; AI tidak menghitung.** `prompt.ts` (sistem klasifikasi & ringkasan: "angka sudah disediakan, jangan mengarang"), route `POST /api/ai/assistant/report-query`; reuse katalog ekspor 8D (tanpa definisi ulang laporan). `scripts/test-ai-assistant.ts` PASS 33 asersi rollback penuh (provider fake diinjeksi, FY UJIFY2040 + 2 jurnal; guard izin, kill-switch, batas panjang, filter katalog per-izin, intent none/unknown/query-invalid, kegagalan provider tanpa efek ERP, kuota 429, unit redact) + regresi `test-jobs-export.ts` PASS 62. BUG kill-switch diperbaiki di gerbang: `AI_ENABLED=false` (default) semula mengunci SEMUA jalur termasuk provider offline/fake tanpa jaringan — dipisah: `ai_settings.enabled` saklar fungsional, `AI_ENABLED` hanya guard egress Gemini) |
| 10 | Hardening | ⬜ |
| UI | Track antarmuka (paralel, U1 sampai U6) | ⬜ (baru) |

## Pemeriksaan kesehatan repo (jalankan dulu sebelum melanjutkan)

`bunx tsc --noEmit`, `bun run lint`, `bun run build`; cek apakah `src/app/api/audit-logs/route.ts` dan mesin persetujuan sudah ada; jalankan skrip uji tertunda (`scripts/test-numbering.ts`, `test-fiscal.ts`, `test-departments.ts`, `test-audit-read.ts`) dan blok uji trigger 4B-2. Laporkan hasilnya sebelum menulis kode baru.

## Tahap 3 (sisa)

- **3I-3**: `GET /api/audit-logs` (keyset, `{ data, meta: { nextCursor } }`), izin `core.audit_logs.read`.
- **3J**: service persetujuan atas `approval_workflows/steps/requests/actions`: definisi alur per jenis dokumen (rentang nilai, cabang), pengajuan, tindakan approve/reject per langkah, pemisahan tugas (pengaju tidak menyetujui sendiri), audit. Dipakai dokumen dari Tahap 5.
- **Utang teknis Core**: cek "cabang aktif" pada penugasan role di modul pengguna; reset password dan verifikasi email (butuh layanan email); service lampiran (object storage) dan notifikasi; pemakaian `idempotency_keys` di tingkat API.

## Tahap 4: Akuntansi inti

Keputusan yang sudah disetujui: COA pohon (hanya akun daun `is_postable` yang dijurnal, dinonaktifkan bukan dihapus, tipe tetap setelah dipakai); jurnal hanya mata uang dasar `numeric(18,2)` dulu; status `draft/posted/reversed/cancelled` dengan koreksi hanya lewat reversal; nomor jurnal diambil saat posting (`nextDocumentNumber("journal_entry")`, draf tidak bernomor); imutabilitas di database (trigger 4B-2) dan di service; periode `open` boleh diposting, `soft_closed` butuh `accounting.journals.post_closed_period`, `closed` ditolak (periode dipilih dari tanggal, periode ke-13 eksplisit); dedup posting lewat `source_type/source_id/source_event` + unique parsial; buku besar diturunkan dari baris jurnal `posted` dan `reversed` tanpa tabel saldo; tanpa persetujuan jurnal manual di Tahap 4; starter COA berupa seed demo yang ditandai; jurnal penutup tahun di 4F.

- **4C Bagan akun**
  - 4C-1 skema Zod (`create`, `update` strict tanpa `code` dan `type`, query daftar).
  - 4C-2 service. **Usulan aturan (minta persetujuan saya)**: tipe anak sama dengan induk; induk tidak boleh `is_postable`; akun yang punya anak tidak boleh dijadikan postable; akun yang sudah dipakai baris jurnal tidak boleh dijadikan non-postable; tidak bisa menonaktifkan akun yang masih punya anak aktif; cegah siklus induk; audit `account.create/update`.
  - 4C-3 route `/api/chart-accounts` (+`[id]`), izin `accounting.accounts.read/manage`.
  - 4C-4 seed COA demo lima kelas (Aset, Liabilitas, Ekuitas, Pendapatan, Beban), idempotent, ditandai demo.
- **4D Jurnal dan mesin posting**
  - 4D-1 skema Zod jurnal.
  - 4D-2 service: buat draf, ubah draf (mengganti seluruh baris), batalkan draf (alasan wajib), detail, daftar (keyset). Validasi: minimal 2 baris, satu sisi per baris > 0, akun ada/aktif/postable, cabang dan departemen aktif. Total dihitung dengan aritmetika desimal (periksa util uang di `src/lib`; bila belum ada, buat berbasis `decimal.js` setelah meminta persetujuan menambah dependency).
  - 4D-3 **posting** (satu transaksi): kunci header `FOR UPDATE` → cek izin (dan `post_closed_period` bila `soft_closed`) → pilih periode → isi total header → `nextDocumentNumber` → status `posted` + `period_id`, `posted_at`, `posted_by` → audit `journal.post`; idempotensi lewat `idempotency_key` dan unique sumber.
  - 4D-4 **reversal**: buat draf reversal (sisi dibalik, `reversal_of_id`, alasan) → posting reversal **lebih dulu** → baru jurnal asal menjadi `reversed` (urutan dipaksa trigger) → audit `journal.reverse`.
  - 4D-5 route `/api/journals` (+`[id]`, `/post`, `/cancel`, `/reverse`). Keputusan untuk saya: apakah pembuat jurnal boleh memposting jurnalnya sendiri.
  - 4D-6 tes otomatis permanen untuk invarian akuntansi.
- **4E Buku besar dan laporan** (`accounting.reports.read`): buku besar per akun dengan saldo berjalan (filter tanggal, cabang, departemen), neraca saldo, laba rugi, neraca. Sumber: baris jurnal `posted` dan `reversed`; nilai string desimal; filter periode konsisten.
- **4F Saldo awal dan penutupan**: saldo awal sebagai jurnal khusus (`source_type = opening_balance`), pengaturan akun laba ditahan di `company_settings`, jurnal penutup tahun fiskal, dan pengisian pemeriksaan di `changePeriodStatus` (jurnal draf menghalangi penutupan; urutan antar tahun fiskal).
- **4G Pajak dan pusat biaya** *(baru)*: konfigurasi pajak (tarif dengan tanggal efektif dan sumber resmi, tidak mengarang tarif), `tax_transactions`, `cost_centers`, kolom `cost_center_id` nullable di baris jurnal, dan laporan per pusat biaya.
- **4H Kas, bank, pembayaran** *(baru)*: `bank_accounts`, transaksi kas/bank, tabel pembayaran dan alokasi pembayaran (dipakai AR/AP di Tahap 5 dan 6), impor mutasi bank, rekonsiliasi bank.
- **4I Anggaran dan arus kas** *(baru)*: `budgets` dan `budget_lines`, laporan realisasi vs anggaran, laporan arus kas (metode ditentukan dan disetujui lebih dulu).

## Tahap 5: Inventory dan Procurement

- 5A: permission inventory dan purchasing, keputusan blueprint (FEFO untuk produk ber-expiry, konversi satuan, aturan batch/serial), persetujuan sebelum skema.
- 5B: skema master (kategori, satuan, konversi, produk, gudang, lokasi, supplier, termin pembayaran).
- 5C: service dan route master data.
- 5D: skema stok (`stock_movements`, `stock_ledger_entries` append-only, `stock_cost_layers`, konsumsi layer, `stock_balances`, batch, serial) dan trigger pengaman.
- 5E: mesin stok: penerimaan dan pengeluaran barang, konsumsi FIFO (dan FEFO), kebijakan stok negatif, transfer (dua transaksi konsisten), penyesuaian, opname.
- 5F: dokumen pembelian (PR, RFQ, quotation, PO dengan state machine, persetujuan memakai mesin 3J, penerimaan dari PO).
- 5G: tagihan pemasok, pencocokan tiga arah, AP, pembayaran dan alokasi, jurnal (GR/IR), kolom mata uang asing di baris jurnal (migrasi nullable).
- 5H: laporan (kartu stok, valuasi, reorder, aging AP, pembelian) dan tes rekonsiliasi subledger dengan GL.

## Tahap 6: Sales dan CRM

- 6A: permission dan keputusan (kebijakan batas kredit, price list, komisi).
- 6B: skema CRM (`crm_accounts`, kontak, lead, opportunity, pipeline, aktivitas, tugas, catatan, segmen), `customers` 1:1 dengan `crm_accounts`, price list.
- 6C: service dan route CRM.
- 6D: skema penjualan (quotation, SO, delivery, return, credit note, invoice, receipt dan alokasi).
- 6E: alur penjualan: quotation → SO → persetujuan → pengiriman (keluar stok FIFO + jurnal HPP) → faktur (AR + pajak) → penerimaan pembayaran; retur dan credit note; idempotensi.
- 6F: aging AR, target dan komisi (bila dibutuhkan), laporan penjualan, rekonsiliasi AR dengan GL.

## Tahap 7: HR dan Payroll

- 7A: permission dan keputusan (akses data personal dan gaji), **verifikasi sumber regulasi resmi** beserta tanggal efektif sebelum menerapkan aturan.
- 7B: skema HR (jabatan, karyawan, dokumen, kontrak, shift, absensi, cuti dan saldo, lembur, onboarding, evaluasi, pelatihan) dan FK `users.employee_id`.
- 7C: service dan route HR, termasuk employee self-service.
- 7D: skema payroll (struktur dan komponen gaji, gaji karyawan berlaku-tanggal, `statutory_rules`, periode, run, item, komponen, penyesuaian, slip gaji).
- 7E: mesin payroll (aritmetika desimal, pembulatan konsisten, tinjauan, persetujuan, snapshot slip gaji, jurnal), desain pemrosesan batch.
- 7F: laporan HR dan payroll, rekonsiliasi jurnal payroll.

## Tahap 8: Aset, Proyek, Reporting, Background jobs

- 8A: permission dan keputusan metode penyusutan.
- 8B: aset tetap (register, perolehan dari tagihan pemasok, penyusutan, jadwal, run dan jurnal, transfer, perawatan, pelepasan, revaluasi bila perlu).
- 8C: proyek (master, tugas, anggaran, biaya, penugasan, progres, profitabilitas lewat pusat biaya).
- 8D: dashboard (eksekutif, keuangan, penjualan, persediaan, pembelian, HR, payroll, arus kas) dan ekspor CSV/Excel/PDF (`export_jobs`).
- 8E: background jobs: putuskan antrean (Redis atau antrean berbasis Postgres) dan worker; pindahkan pekerjaan berat (payroll massal, impor/ekspor, laporan berat).

## Tahap 9: Integrasi AI

- 9A: keputusan dan verifikasi kuota, model, harga, dan ketentuan data Gemini terbaru dari sumber resmi.
- 9B: abstraksi provider (interface, Gemini, Groq belakangan), `ai_settings`, `ai_requests`, rate limit, timeout, retry aman, saklar nonaktif.
- 9C: registri laporan yang diizinkan, klasifikasi intent, validasi parameter, otorisasi, service deterministik. Tanpa SQL bebas.
- 9D: asisten bisnis finance, inventory, dan sales (ringkasan, tren, anomali berbasis aturan deterministik, penjelasan oleh AI).
- 9E: asisten HR dan CRM (hanya draf, tanpa keputusan atau pengiriman otomatis).
- 9F: kuota, dasbor pemakaian, logging tanpa data sensitif, tes batas izin dan kegagalan provider.

## Tahap 10: Hardening

- 10A: infrastruktur tes (Vitest, Playwright), tes invarian akuntansi/inventori/payroll, otorisasi, transaksi.
- 10B: tinjauan keamanan (secure headers, CSRF, rate limit, audit IDOR, keamanan unggahan, secret).
- 10C: performa (tinjau indeks dan rencana query, paginasi, manajemen koneksi) dan partisi `audit_logs` bulanan (ditunda dari Tahap 3).
- 10D: operasi (backup dan latihan restore, monitoring, error tracking, structured logging, health check, deploy Vercel, rollback, runbook).
- 10E: dokumentasi penggunaan dan operasional, serta pemeriksaan akhir terhadap bagian 18.

## Track UI (paralel, mengikuti backend tiap tahap)

- U1: fondasi: app shell (sidebar menurut permission, header, breadcrumb), halaman login/logout, komponen bersama (DataTable server-side, form RHF + Zod, dialog konfirmasi, toast, state loading/empty/error).
- U2: halaman Core (pengguna, role dan permission, profil perusahaan, pengaturan, cabang, departemen, tahun fiskal dan periode, mata uang dan kurs, audit log).
- U3: halaman akuntansi (bagan akun, jurnal, posting dan reversal, buku besar, laporan, saldo awal).
- U4: halaman inventory dan procurement.
- U5: halaman sales dan CRM.
- U6: halaman HR, payroll, aset, proyek, dashboard, dan antarmuka asisten AI.

---

# 16. FORMAT KERJA DAN OUTPUT

Untuk setiap langkah:

### Tujuan
Fitur yang dibuat dan ketergantungannya (singkat).

### Perubahan file
Daftar path file yang dibuat atau diubah, dengan ringkasan isi dan alasan desain yang penting.

### Perintah yang dijalankan
Perintah beserta keluaran ringkas yang faktual. Perintah yang perlu persetujuan (bagian 2.2) ditampilkan dulu dan ditunggu jawabannya.

### Verifikasi
Hasil yang benar-benar didapat dari eksekusi (`tsc`, `lint`, `build`, tes). Bila saya yang harus menjalankan sesuatu, berikan langkah dan hasil yang diharapkan.

### Status dan persetujuan
Apa yang selesai, apa yang belum, dan keputusan yang perlu saya setujui. Perbarui tabel status di bagian 15 bila tahap berubah.

---

# 17. LARANGAN IMPLEMENTASI

Jangan:
- membuat seluruh aplikasi dalam satu file;
- memakai `any` secara sembarangan atau mengabaikan error TypeScript;
- memakai dummy data untuk menyamarkan fitur yang belum selesai;
- membuat endpoint tanpa validasi, atau mengandalkan frontend untuk otorisasi;
- membiarkan AI mengeksekusi SQL bebas;
- mengubah saldo keuangan atau stok tanpa transaksi yang sah;
- memakai floating-point untuk uang;
- menghapus histori transaksi yang sudah diposting;
- menambah dependency hanya karena populer;
- menyimpan secret di source;
- mengklaim fitur selesai padahal baru UI, atau mengklaim tes lulus tanpa keluaran nyata;
- menulis ulang seluruh file tanpa kebutuhan, atau menimpa file yang belum dibaca;
- menjalankan migrasi, seed, instalasi dependency, push, deploy, atau aksi destruktif tanpa persetujuan eksplisit;
- memakai `export const dynamic`/`revalidate`/`runtime` di route handler (konflik dengan `cacheComponents`).

Bila ada kebutuhan yang belum jelas, identifikasi dulu dan ajukan pertanyaan yang benar-benar diperlukan. Jangan mengambil keputusan besar secara diam-diam.

---

# 18. KRITERIA SELESAI

ERP baru boleh dianggap siap untuk evaluasi produksi apabila: modul yang disepakati terimplementasi; alur bisnis berjalan dari awal sampai akhir; integritas database terjaga; accounting dan inventory konsisten; payroll dapat diverifikasi terhadap aturan berlaku; otorisasi diuji di sisi server; audit trail berfungsi; AI memakai data yang diotorisasi; penanganan error dan kegagalan tersedia; pengujian kritis dijalankan dan hasilnya terverifikasi; backup, restore, monitoring, dan deployment siap; tidak ada tombol atau fitur kritis yang sekadar placeholder; dokumentasi penggunaan dan operasional tersedia.

Jangan mengklaim kesiapan produksi hanya karena aplikasi berhasil dibuka atau dashboard terlihat bagus.

---

# 19. INSTRUKSI PERTAMA

Proyek **sudah berjalan** (jangan mulai dari Tahap 0, dan jangan mengulang tahap yang sudah ✅).

1. Baca `docs/HANDOFF.md` dan bagian 15 dokumen ini.
2. Jalankan pemeriksaan kesehatan repo (bagian 15) dan laporkan hasilnya, termasuk apa yang belum ada atau gagal.
3. Setelah repo dipastikan sehat, lanjutkan ke **Tahap 4C-1** (skema Zod bagan akun). Sebelum menulis kode, sajikan aturan bisnis bagan akun (bagian 15, Tahap 4C) untuk saya setujui.
4. Setelah itu kerjakan hanya langkah yang sudah saya setujui, satu per satu.

Ingat: saya ingin menghemat token, mengontrol semua perubahan yang menyentuh database dan dependency, dan membangun ERP yang benar-benar terintegrasi.

---

# 20. LAMPIRAN: KEPUTUSAN TERKUNCI DAN KONVENSI RINGKAS

Detail lengkap ada di `docs/HANDOFF.md`. Ringkasnya:

- Database Neon (pooled untuk aplikasi, direct untuk migrasi), bun, Windows PowerShell, FIFO, multi-currency aktif dengan dasar IDR (jurnal Tahap 4 hanya mata uang dasar), batch/serial aktif, stok negatif ditolak, retensi audit 7 tahun, Better Auth, UUID v4, `timestamptz` UTC, tanggal akuntansi bertipe `date` mode string.
- Berkas schema Drizzle memakai import relatif. Nama tabel `accounts` sudah dipakai Better Auth (bagan akun bernama `chart_accounts`).
- Keputusan 5E-batch (terkunci): `products.tracking` enum (none/batch/serial/both) + `needsExpiry`, hanya boleh berubah sebelum produk punya pergerakan; batch **dilahirkan inline** di baris penerimaan (tanpa endpoint master batch); serial **wajib daftar nomor per baris** (qty == jumlah serial); aturan expiry ketat saat post — konsumsi FEFO auto **melewati** batch expired, batch eksplisit expired **ditolak**, penerimaan batch sudah expired **ditolak**, tetapi pergerakan **reversal dibebaskan** dari aturan expiry; laporan batch/expiry ditunda ke 5H.
- Pola service: `assertCan` → transaksi → kunci (`FOR UPDATE`/`FOR SHARE`/advisory lock) → tulis → `audit.log(..., tx)` di transaksi yang sama; tanpa perubahan berarti tanpa tulisan dan tanpa audit; master data dinonaktifkan, tidak dihapus.
- Pola route: `apiHandler`, `requireActor()`, `id` bukan UUID dijawab 404, body JSON divalidasi Zod `strictObject`, bentuk respons `{ data }`, `{ data, meta }`, dan error `{ error: { code, message, details?, requestId } }`.
- Penomoran: `nextDocumentNumber(tx, docType, { date, branchId? })` di dalam transaksi bisnis; aturan di `NUMBERING_RULES`.
- Permission: sumber tunggal `src/modules/permissions.ts` (42 permission saat ini); modul baru menambah daftarnya di sana.