/**
 * Daftar permission modul CRM (Tahap 6A). Format: modul.resource.aksi.
 * CRM mencakup akun, kontak, lead, pipeline, opportunity, aktivitas, tugas,
 * catatan, segmen, pelanggan, dan daftar harga.
 */
export const crmPermissions = [
  { code: "crm.accounts.read", description: "Melihat akun CRM" },
  { code: "crm.accounts.manage", description: "Membuat/mengubah/menonaktifkan akun CRM" },
  { code: "crm.contacts.read", description: "Melihat kontak CRM" },
  { code: "crm.contacts.manage", description: "Membuat/mengubah/menonaktifkan kontak CRM" },
  { code: "crm.leads.read", description: "Melihat prospek (lead)" },
  { code: "crm.leads.manage", description: "Membuat/mengubah/mengonversi prospek" },
  { code: "crm.pipeline.read", description: "Melihat tahap pipeline" },
  { code: "crm.pipeline.manage", description: "Mengelola tahap pipeline" },
  { code: "crm.opportunities.read", description: "Melihat peluang (opportunity)" },
  { code: "crm.opportunities.manage", description: "Membuat/mengubah/memindahkan peluang" },
  { code: "crm.activities.read", description: "Melihat aktivitas CRM" },
  { code: "crm.activities.manage", description: "Mencatat aktivitas CRM" },
  { code: "crm.tasks.read", description: "Melihat tugas CRM" },
  { code: "crm.tasks.manage", description: "Membuat/mengubah/menyelesaikan tugas" },
  { code: "crm.notes.read", description: "Melihat catatan CRM" },
  { code: "crm.notes.manage", description: "Membuat/mengubah catatan CRM" },
  { code: "crm.segments.read", description: "Melihat segmen CRM" },
  { code: "crm.segments.manage", description: "Mengelola segmen CRM" },
  { code: "crm.customers.read", description: "Melihat master pelanggan" },
  { code: "crm.customers.manage", description: "Membuat/mengubah master pelanggan" },
  { code: "crm.price_lists.read", description: "Melihat daftar harga" },
  { code: "crm.price_lists.manage", description: "Mengelola daftar harga" },
] as const;

export type CrmPermissionCode = (typeof crmPermissions)[number]["code"];
