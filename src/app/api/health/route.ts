import { sql } from "drizzle-orm";
import { connection, NextResponse } from "next/server";

import { db } from "@/server/db";

export async function GET() {
  // Tandai handler sebagai request-time: hasil tidak boleh dibekukan saat build.
  await connection();

  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({
      status: "ok",
      database: "up",
      time: new Date().toISOString(),
    });
  } catch (error) {
    // Detail error hanya di log server, tidak dikirim ke klien.
    console.error("[health] Pengecekan database gagal:", error);
    return NextResponse.json({ status: "error", database: "down" }, { status: 503 });
  }
}