import { headers } from "next/headers";

import { auth } from "./auth";

/** Mengambil sesi saat ini di server (Server Component, Route Handler, Server Action). */
export async function getServerSession() {
  return auth.api.getSession({ headers: await headers() });
}