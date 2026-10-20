import { NextResponse } from "next/server";
import { z } from "zod";

import { createTask, listTasks } from "@/modules/crm/task-service";
import { createTaskSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

const listQuerySchema = z.object({
  accountId: z.uuid().optional(),
  status: z.string().optional(),
});

/** Daftar tugas, opsional ?accountId=&status=. Izin: crm.tasks.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const filters = listQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listTasks(actor, filters);
  return NextResponse.json({ data });
});

/** Membuat tugas baru. Izin: crm.tasks.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createTaskSchema.parse(body);
  const data = await createTask(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
