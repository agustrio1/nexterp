import { z } from "zod";

import { notFound, validationFailed } from "@/server/errors";

const idSchema = z.uuid();

/** Baca body JSON; error 422 bila tidak valid. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
}

/** Baca parameter dinamis { id } sebagai uuid; id salah format => 404 (bukan 500). */
export async function readId(context: { params: Promise<{ id: string }> }, label = "Data"): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound(`${label} tidak ditemukan.`);
  return parsed.data;
}
