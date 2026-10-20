/**
 * Daftar permission modul Integrasi AI (Tahap 9A-9F). Format: modul.resource.aksi.
 * `ai.requests.read` (dasbor pemakaian 9F) dibuat bersamaan endpoint agregasi `ai_requests`
 * sehingga tidak ada kode mati. `ai.assistant.use` menjadi gerbang endpoint tanya-jawab
 * laporan & analisis; izin baca laporan/analisis sumber tetap diperiksa terpisah (defense-in-depth).
 */
export const aiPermissions = [
  { code: "ai.settings.read", description: "Melihat konfigurasi & kuota AI" },
  { code: "ai.settings.manage", description: "Mengubah provider, model, saklar, dan limit AI" },
  { code: "ai.assistant.use", description: "Menggunakan asisten laporan & analisis berbasis bahasa alami" },
  { code: "ai.requests.read", description: "Melihat dasbor pemakaian & log permintaan AI" },
] as const;

export type AiPermissionCode = (typeof aiPermissions)[number]["code"];
