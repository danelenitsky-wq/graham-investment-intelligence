import { after, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { checkFilings } from "@/server/filings";
import { getQuoteView } from "@/server/quotes";

const noStore = { "Cache-Control": "no-store" };

async function exists(id: string) {
  return Boolean(await db.security.findUnique({ where: { id }, select: { id: true } }));
}

/**
 * Latest quote for a security. GET honours the cache policy (used on page open
 * and by the 60 s auto refresh); it also schedules the daily new-filing check.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/quote/[securityId]">) {
  const { securityId } = await ctx.params;
  if (!(await exists(securityId))) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: noStore });
  const view = await getQuoteView(securityId);
  after(async () => {
    try {
      await checkFilings(securityId);
    } catch (e) {
      console.error("[filings] check failed", e);
    }
  });
  return Response.json(view, { headers: noStore });
}

/** Refresh Now: always makes a new provider request (2 s spam guard). */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/quote/[securityId]">) {
  const { securityId } = await ctx.params;
  if (!(await exists(securityId))) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: noStore });
  const view = await getQuoteView(securityId, { force: true });
  return Response.json(view, { headers: noStore });
}
