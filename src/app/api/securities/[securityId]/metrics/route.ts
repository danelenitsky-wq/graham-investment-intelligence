import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { getMetricProvenance } from "@/server/provenance";

/**
 * Every stored metric with provider, source URL, reporting period, filing
 * date, retrieval timestamp, currency, unit, verification and data status.
 * Read-only: no provider request is made (the quote is served from storage).
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/securities/[securityId]/metrics">) {
  const { securityId } = await ctx.params;
  if (!(await db.security.findUnique({ where: { id: securityId }, select: { id: true } }))) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(await getMetricProvenance(securityId), { headers: { "Cache-Control": "no-store" } });
}
