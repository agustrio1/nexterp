/**
 * Daftar permission modul Integrasi AI (Tahap 9A-9C). Format: modul.resource.aksi.
 * `ai.requests.read` (dasbor pemakaian) sengaja BELUM dibuat — ditunda ke 9F agar
 * tidak ada kode mati. `ai.assistant.use` menjadi gerbang endpoint tanya-jawab laporan;
 * izin baca laporan sumber tetap diperiksa terpisah (defense-in-depth).
 */
export const aiPermissions = [
  { code: "ai.settings.read", description: "Melihat konfigurasi & kuota AI" },
  { code: "ai.settings.manage", description: "Mengubah provider, model, saklar, dan limit AI" },
  { code: "ai.assistant.use", description: "Menggunakan asisten laporan berbasis bahasa alami" },
] as const;

export type AiPermissionCode = (typeof aiPermissions)[number]["code"];
