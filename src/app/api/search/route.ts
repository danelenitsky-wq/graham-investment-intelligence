import { NextResponse, type NextRequest } from "next/server";
import { searchSecurities, universeSize } from "@/server/securities";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const exchange = request.nextUrl.searchParams.get("exchange") ?? undefined;
  try {
    const [results, size] = await Promise.all([searchSecurities(q, { exchange, limit: 20 }), universeSize()]);
    return NextResponse.json({ results, universeEmpty: size === 0 });
  } catch (e) {
    console.error("[api/search]", e);
    return NextResponse.json({ error: "search_failed" }, { status: 500 });
  }
}
