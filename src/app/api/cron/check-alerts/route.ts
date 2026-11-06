import type { NextRequest } from "next/server";
import { env } from "@/server/env";
import { runAlertChecks } from "@/server/alerts";

/**
 * Scheduled alert check for every followed security. Call it from an external
 * scheduler (cron, launchd, GitHub Actions…) with
 *   Authorization: Bearer $CRON_SECRET
 * e.g. hourly during market hours; the free-plan request budgets cap what a run
 * fetches (?fetch=0 evaluates stored data only). Disabled (404) until
 * CRON_SECRET is configured. The app reports background monitoring as active
 * only after a run through this endpoint has completed.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = env().CRON_SECRET;
  if (!secret) return Response.json({ error: "NOT_CONFIGURED" }, { status: 404 });
  if (auth !== `Bearer ${secret}`) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const fetch = req.nextUrl.searchParams.get("fetch") !== "0";
  const summary = await runAlertChecks({ trigger: "SCHEDULED", fetch, maxProviderCalls: 40 });
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
