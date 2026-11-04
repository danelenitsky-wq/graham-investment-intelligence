import { NextResponse, type NextRequest } from "next/server";

const LOCALES = ["he", "en"];
const DEFAULT_LOCALE = "he"; // Hebrew (RTL) is the product default; English is one click away.

/** Redirect locale-less paths to the default locale. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) return;
  request.nextUrl.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
