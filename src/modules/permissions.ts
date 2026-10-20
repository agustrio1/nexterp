import { accountingPermissions } from "@/modules/accounting/permissions";
import { aiPermissions } from "@/modules/ai/permissions";
import { assetsPermissions } from "@/modules/assets/permissions";
import { corePermissions } from "@/modules/core/permissions";
import { crmPermissions } from "@/modules/crm/permissions";
import { hrPermissions } from "@/modules/hr/permissions";
import { inventoryPermissions } from "@/modules/inventory/permissions";
import { payrollPermissions } from "@/modules/payroll/permissions";
import { projectsPermissions } from "@/modules/projects/permissions";
import { purchasingPermissions } from "@/modules/purchasing/permissions";
import { reportingPermissions } from "@/modules/reporting/permissions";
import { salesPermissions } from "@/modules/sales/permissions";

/**
 * Registri permission seluruh modul. Modul baru menambahkan daftarnya di sini.
 * Seed membaca daftar ini; tipe PermissionCode diturunkan darinya.
 */
export const allPermissions = [
  ...corePermissions,
  ...accountingPermissions,
  ...inventoryPermissions,
  ...purchasingPermissions,
  ...crmPermissions,
  ...salesPermissions,
  ...hrPermissions,
  ...payrollPermissions,
  ...assetsPermissions,
  ...projectsPermissions,
  ...reportingPermissions,
  ...aiPermissions,
] as const;

export type PermissionCode = (typeof allPermissions)[number]["code"];