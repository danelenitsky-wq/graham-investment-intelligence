/**
 * Access control for the single-user installation (pure, testable).
 *
 * The app has no user accounts. Anyone who can reach the server can read the
 * portfolio, change settings and spend the free API quotas (Refresh Now), so
 * a deployment reachable from a network must be protected. When
 * APP_PASSWORD is set, every page, Server Function and API route requires
 * HTTP Basic credentials. In production (NODE_ENV=production) the app refuses
 * to serve without APP_PASSWORD unless APP_AUTH_DISABLED="true" is set
 * explicitly (for a machine that only listens on localhost).
 */
import { createHash, timingSafeEqual } from "node:crypto";

export interface AccessConfig {
  username: string;
  password: string | null;
  disabled: boolean;
  production: boolean;
}

export type AccessDecision = "ALLOW" | "CHALLENGE" | "MISCONFIGURED";

/** Paths with their own protection or that must stay reachable for probes. */
export const PUBLIC_PATHS = ["/api/health", "/api/cron/"];

export function accessConfigFromEnv(e: Record<string, string | undefined> = process.env): AccessConfig {
  return {
    username: e.APP_USERNAME?.trim() || "graham",
    password: e.APP_PASSWORD ? e.APP_PASSWORD : null,
    disabled: e.APP_AUTH_DISABLED === "true",
    production: e.NODE_ENV === "production",
  };
}

/** Constant-time string comparison (hashing first equalizes the lengths). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function parseBasic(header: string | null): { user: string; pass: string } | null {
  if (!header || !header.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

export function decideAccess(pathname: string, authorization: string | null, cfg: AccessConfig): AccessDecision {
  if (PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p))) return "ALLOW";
  if (cfg.disabled) return "ALLOW";
  if (!cfg.password) return cfg.production ? "MISCONFIGURED" : "ALLOW";
  const creds = parseBasic(authorization);
  if (!creds) return "CHALLENGE";
  // Evaluate both comparisons so timing does not reveal which one failed.
  const userOk = safeEqual(creds.user, cfg.username);
  const passOk = safeEqual(creds.pass, cfg.password);
  return userOk && passOk ? "ALLOW" : "CHALLENGE";
}
