import { asc, eq } from "drizzle-orm";

import { companyProfile, companySettings, chartAccounts } from "@/db/schema";
import {
  EDITABLE_SETTING_KEYS,
  type SaveCompanyProfileInput,
  type UpdateSettingsInput,
} from "@/modules/organization/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden } from "@/server/errors";

type Reader = Pick<typeof db, "select">;

/** Single-tenant: profil perusahaan selalu berada di baris dengan id = 1. */
const PROFILE_ID = 1;

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/* ------------------------------------------------------------------ */
/* Profil perusahaan                                                   */
/* ------------------------------------------------------------------ */

type ProfileEditable = {
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

const PROFILE_FIELDS = [
  "legalName",
  "tradeName",
  "taxId",
  "address",
  "city",
  "province",
  "postalCode",
  "phone",
  "email",
  "website",
] as const satisfies readonly (keyof ProfileEditable)[];

const profileColumns = {
  legalName: companyProfile.legalName,
  tradeName: companyProfile.tradeName,
  taxId: companyProfile.taxId,
  address: companyProfile.address,
  city: companyProfile.city,
  province: companyProfile.province,
  postalCode: companyProfile.postalCode,
  phone: companyProfile.phone,
  email: companyProfile.email,
  website: companyProfile.website,
  logoStorageKey: companyProfile.logoStorageKey,
  updatedAt: companyProfile.updatedAt,
};

/** PUT: field yang tidak dikirim dianggap kosong (null). */
function toValues(input: SaveCompanyProfileInput): ProfileEditable {
  return {
    legalName: input.legalName,
    tradeName: input.tradeName ?? null,
    taxId: input.taxId ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    province: input.province ?? null,
    postalCode: input.postalCode ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
  };
}

/** Hanya field yang bisa diedit (untuk audit dan perbandingan). */
function pickEditable(row: ProfileEditable): ProfileEditable {
  return {
    legalName: row.legalName,
    tradeName: row.tradeName,
    taxId: row.taxId,
    address: row.address,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    phone: row.phone,
    email: row.email,
    website: row.website,
  };
}

async function loadProfile(reader: Reader) {
  const [row] = await reader
    .select(profileColumns)
    .from(companyProfile)
    .where(eq(companyProfile.id, PROFILE_ID))
    .limit(1);
  return row;
}

async function requireProfile(reader: Reader) {
  const row = await loadProfile(reader);
  if (!row) throw new Error("Profil perusahaan tidak ditemukan setelah disimpan.");
  return row;
}

/** Mengembalikan null bila profil belum pernah disimpan. */
export async function getCompanyProfile(actor: AuthContext) {
  assertCan(actor, "core.company.read");
  return (await loadProfile(db)) ?? null;
}

/** Membuat profil (simpan pertama) atau menimpanya. Tanpa perubahan = tanpa tulisan dan tanpa audit. */
export async function saveCompanyProfile(actor: AuthContext, input: SaveCompanyProfileInput) {
  assertCan(actor, "core.company.update");
  const values = toValues(input);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select(profileColumns)
      .from(companyProfile)
      .where(eq(companyProfile.id, PROFILE_ID))
      .for("update");

    if (!existing) {
      const [created] = await tx
        .insert(companyProfile)
        .values({
          id: PROFILE_ID,
          ...values,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .onConflictDoNothing()
        .returning({ id: companyProfile.id });

      if (!created) {
        throw conflict("Profil perusahaan sedang disimpan oleh pengguna lain. Coba lagi.");
      }

      await audit.log(
        {
          action: "company.profile.create",
          entityType: "company_profile",
          entityId: String(PROFILE_ID),
          actorId: actor.userId,
          after: values,
        },
        tx,
      );

      return requireProfile(tx);
    }

    const before = pickEditable(existing);
    const changed = PROFILE_FIELDS.some((field) => before[field] !== values[field]);
    if (!changed) return existing;

    await tx
      .update(companyProfile)
      .set({ ...values, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(companyProfile.id, PROFILE_ID));

    await audit.log(
      {
        action: "company.profile.update",
        entityType: "company_profile",
        entityId: String(PROFILE_ID),
        actorId: actor.userId,
        before,
        after: values,
      },
      tx,
    );

    return requireProfile(tx);
  });
}

/* ------------------------------------------------------------------ */
/* Pengaturan aplikasi                                                 */
/* ------------------------------------------------------------------ */

function isEditableSetting(key: string): boolean {
  return (EDITABLE_SETTING_KEYS as readonly string[]).includes(key);
}

async function loadSettings(reader: Reader) {
  const rows = await reader
    .select({
      key: companySettings.key,
      value: companySettings.value,
      description: companySettings.description,
      updatedAt: companySettings.updatedAt,
    })
    .from(companySettings)
    .orderBy(asc(companySettings.key));

  return rows.map((row) => ({ ...row, editable: isEditableSetting(row.key) }));
}

/** Seluruh pengaturan; editable = false berarti hanya dibaca (base_currency, costing_method). */
export async function getSettings(actor: AuthContext) {
  assertCan(actor, "core.settings.read");
  return loadSettings(db);
}

/** Hanya key yang nilainya berubah yang ditulis dan diaudit. */
export async function updateSettings(actor: AuthContext, input: UpdateSettingsInput) {
  assertCan(actor, "core.settings.update");

  return db.transaction(async (tx) => {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    // Urutan tetap (sesuai daftar key) agar penguncian baris konsisten dan bebas deadlock.
    for (const key of EDITABLE_SETTING_KEYS) {
      const next = input[key];
      if (next === undefined) continue;

      const [current] = await tx
        .select({ value: companySettings.value })
        .from(companySettings)
        .where(eq(companySettings.key, key))
        .for("update");

      if (!current) {
        throw businessRule(`Pengaturan "${key}" belum diinisialisasi. Jalankan seed terlebih dahulu.`);
      }
      if (current.value === next) continue;

      // Akun laba ditahan harus merujuk akun ekuitas yang postable & aktif.
      if (key === "retained_earnings_account_id") {
        const [account] = await tx
          .select({
            id: chartAccounts.id,
            code: chartAccounts.code,
            type: chartAccounts.type,
            isPostable: chartAccounts.isPostable,
            isActive: chartAccounts.isActive,
          })
          .from(chartAccounts)
          .where(eq(chartAccounts.id, String(next)))
          .limit(1);
        if (!account) {
          throw businessRule("Akun laba ditahan tidak ditemukan.");
        }
        if (account.type !== "equity" || !account.isPostable || !account.isActive) {
          throw businessRule(
            "Akun laba ditahan harus akun ekuitas yang postable dan aktif.",
          );
        }
      }

      await tx
        .update(companySettings)
        .set({ value: next, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(companySettings.key, key));

      before[key] = current.value;
      after[key] = next;
    }

    if (Object.keys(after).length > 0) {
      await audit.log(
        {
          action: "settings.update",
          entityType: "settings",
          entityId: "company_settings",
          actorId: actor.userId,
          before,
          after,
        },
        tx,
      );
    }

    return loadSettings(tx);
  });
}