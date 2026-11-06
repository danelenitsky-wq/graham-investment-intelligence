import type { NextRequest } from "next/server";
import { STRATEGIES, type Strategy } from "@/lib/decision";
import { isLocale } from "@/lib/i18n";
import { reportToMarkdown } from "@/lib/decision";
import { getSecurityAnalysis } from "@/server/analysis";
import { getDecisionSnapshot, researchReport } from "@/server/decision";

/**
 * Research report as Markdown, generated with deterministic templates.
 *   ?locale=he|en          (default he)
 *   ?strategy=DEFENSIVE|ENTERPRISING|NET_NET
 *   ?snapshot=<id>         the archived report of a saved snapshot
 * Read-only: served from stored data, no provider request is made.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/securities/[securityId]/report">) {
  const { securityId } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const loc = sp.get("locale");
  const locale = isLocale(loc) ? loc : "he";
  const headers = { "Cache-Control": "no-store", "Content-Type": "text/markdown; charset=utf-8" };
  const snapshotId = sp.get("snapshot");
  if (snapshotId) {
    const s = await getDecisionSnapshot(snapshotId);
    const md = s && s.snapshot.security.id === securityId ? s.reports[locale] : null;
    if (!md) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(md, { headers: { ...headers, "Content-Disposition": `attachment; filename="${s!.snapshot.security.ticker}-${s!.snapshot.createdAt.slice(0, 10)}-${locale}.md"` } });
  }
  const st = sp.get("strategy");
  const strategy = STRATEGIES.includes(st as Strategy) ? (st as Strategy) : null;
  const a = await getSecurityAnalysis(securityId, { strategy });
  if (!a) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const md = reportToMarkdown(researchReport(a, locale));
  return new Response(md, { headers: { ...headers, "Content-Disposition": `attachment; filename="${a.security.ticker}-report-${locale}.md"` } });
}
