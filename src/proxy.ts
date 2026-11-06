import { NextResponse, type NextRequest } from "next/server";
import { accessConfigFromEnv, decideAccess } from "@/lib/security/access";

const LOCALES = ["he", "en"];
const DEFAULT_LOCALE = "he"; // Hebrew (RTL) is the product default; English is one click away.

/**
 * 1. Access control (HTTP Basic when APP_PASSWORD is set; see lib/security/access).
 * 2. Redirect locale-less page paths to the default locale.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const decision = decideAccess(pathname, request.headers.get("authorization"), accessConfigFromEnv());
  if (decision === "MISCONFIGURED") {
    return new NextResponse("APP_PASSWORD is not set. Set it (or APP_AUTH_DISABLED=true for a localhost-only machine) and restart.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (decision === "CHALLENGE") {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Graham Investment Intelligence", charset="UTF-8"', "Cache-Control": "no-store" },
    });
  }
  if (pathname.startsWith("/api/")) return;
  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) return;
  request.nextUrl.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  // Everything except build assets and static files. Static files are listed by
  // extension: ticker paths such as /he/stocks/NYSE/BRK.B contain a dot and
  // must stay protected.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)"],
};
