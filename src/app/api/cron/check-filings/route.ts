import type { NextRequest } from "next/server";
import { env } from "@/server/env";
import { checkAllFilings } from "@/server/filings";

/**
 * Daily new-filing check for every followed security. Call once a day from a
 * scheduler (cron, Vercel Cron, GitHub Actions…) with
 *   Authorization: Bearer $CRON_SECRET
 * Disabled (404) until CRON_SECRET is configured.
 */
export async function GET(req: NextRequest) {
  // Reading the request first keeps this handler dynamic (never prerendered at build time).
  const auth = req.headers.get("authorization");
  const secret = env().CRON_SECRET;
  if (!secret) return Response.json({ error: "NOT_CONFIGURED" }, { status: 404 });
  if (auth !== `Bearer ${secret}`) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const results = await checkAllFilings();
  const count = (s: string) => results.filter((r) => r.status === s).length;
  return Response.json(
    { checked: results.length, newFilings: count("NEW_FILING"), failed: count("FAILED"), results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
