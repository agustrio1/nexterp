import { z } from "zod";

import { normalizeError, validationFailed } from "@/server/errors";

/* ------------------------------------------------------------------ */
/* Parser: semua kegagalan menjadi AppError VALIDATION_FAILED          */
/* ------------------------------------------------------------------ */

/** Memvalidasi data apa pun terhadap schema. Melempar AppError bila tidak valid. */
export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw normalizeError(result.error);
  }
  return result.data;
}

/** Membaca dan memvalidasi body JSON. Body kosong atau bukan JSON ditolak. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  return parseWith(schema, json);
}

/** Memvalidasi query string. Bila satu kunci muncul berulang, nilai terakhir yang dipakai. */
export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.output<S> {
  const { searchParams } = new URL(request.url);
  return parseWith(schema, Object.fromEntries(searchParams));
}

/** Memvalidasi param rute. Menerima objek biasa maupun Promise (Next.js 15+). */
export async function parseParams<S extends z.ZodType>(
  params: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
  schema: S,
): Promise<z.output<S>> {
  return parseWith(schema, await params);
}

/* ------------------------------------------------------------------ */
/* Skema umum                                                          */
/* ------------------------------------------------------------------ */

export const uuidSchema = z.uuid("ID tidak valid.");

/** Param rute berbentuk /.../[id]. */
export const idParamsSchema = z.object({ id: uuidSchema });

/** Tanggal tanpa jam, format YYYY-MM-DD. */
export const isoDateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

/**
 * Nominal uang non-negatif sebagai string (sesuai numeric(18,2): maksimal 16 digit bulat,
 * 2 desimal). Selalu string supaya tidak melewati floating-point.
 */
export const moneyString = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Nominal harus angka non-negatif dengan maksimal 2 desimal.");

/** Seperti moneyString tetapi boleh negatif (mis. penyesuaian, selisih). */
export const signedMoneyString = z
  .string()
  .regex(/^-?\d{1,16}(\.\d{1,2})?$/, "Nominal harus angka dengan maksimal 2 desimal.");
