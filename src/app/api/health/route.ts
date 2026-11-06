import { NextResponse } from "next/server";
import { db } from "@/server/db";

/** Liveness + database connectivity probe. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "up", time: new Date().toISOString() });
  } catch (e) {
    // The driver message can include host names or connection details: log it, do not return it.
    console.error("[health] database check failed", e);
    return NextResponse.json({ status: "degraded", database: "down" }, { status: 503 });
  }
}
