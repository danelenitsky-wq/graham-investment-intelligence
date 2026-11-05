import "server-only";
import { createHash } from "node:crypto";
import { FREE_PLAN_BUDGETS, rateLimiter, type RateBudget } from "./rate-limit";
import { ProviderError } from "./types";

/** Remove credentials from a URL before it is logged or stored. */
export function redactUrl(url: string, secretParams: string[] = ["token", "apikey", "api_key", "key"]): string {
  try {
    const u = new URL(url);
    for (const p of secretParams) if (u.searchParams.has(p)) u.searchParams.set(p, "REDACTED");
    return u.toString();
  } catch {
    return url.replace(/(token|apikey|api_key|key)=[^&]+/gi, "$1=REDACTED");
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Short, credential-scrubbed excerpt of an error body (long tokens are masked). */
export function bodySnippet(text: string): string {
  return text.replace(/[A-Za-z0-9_-]{24,}/g, "***").replace(/\s+/g, " ").trim().slice(0, 200);
}

export interface HttpResult {
  status: number;
  text: string;
  endpoint: string;
  payloadHash: string;
}

/** GET with timeout and limited retries on 429/5xx. Throws ProviderError. */
export async function httpGet(
  provider: string,
  url: string,
  init: { headers?: Record<string, string>; timeoutMs?: number; retries?: number; secretParams?: string[]; budget?: RateBudget | null } = {},
): Promise<HttpResult> {
  const endpoint = redactUrl(url, init.secretParams);
  const retries = init.retries ?? 2;
  const budget = init.budget === undefined ? FREE_PLAN_BUDGETS[provider] : init.budget;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (budget) {
      const waitMs = rateLimiter.take(provider, budget);
      if (waitMs !== null) {
        // Refuse locally rather than exceed the plan's documented limit.
        throw new ProviderError(provider, "RATE_LIMITED", `Local request budget for ${provider} is used up; retry in ${Math.ceil(waitMs / 1000)} s.`, null, endpoint);
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);
    try {
      const res = await fetch(url, { headers: init.headers, signal: controller.signal, cache: "no-store" });
      const text = await res.text();
      if (res.status === 404) throw new ProviderError(provider, "NOT_FOUND", `Not found: ${endpoint}`, 404, endpoint);
      if (res.status === 402)
        throw new ProviderError(provider, "NOT_ENTITLED", `Endpoint not included in the current subscription (402). ${bodySnippet(text)}`, 402, endpoint);
      if (res.status === 401 || res.status === 403)
        throw new ProviderError(provider, "HTTP_ERROR", `Access denied (${res.status}). Check credentials / plan / User-Agent. ${bodySnippet(text)}`, res.status, endpoint);
      if (res.status === 429 || res.status >= 500) {
        lastError = new ProviderError(provider, res.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR", `HTTP ${res.status}`, res.status, endpoint);
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new ProviderError(provider, "HTTP_ERROR", `HTTP ${res.status}`, res.status, endpoint);
      return { status: res.status, text, endpoint, payloadHash: sha256(text) };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      lastError = new ProviderError(provider, "NETWORK_ERROR", e instanceof Error ? e.message : String(e), null, endpoint);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export function parseJson<T>(provider: string, text: string, endpoint: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, "PARSE_ERROR", "Response was not valid JSON", null, endpoint);
  }
}
