import { NextResponse } from "next/server";
import { db } from "@/server/db";

/** Liveness + database connectivity probe. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "up", time: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ status: "degraded", database: "down", error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
