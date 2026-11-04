import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Never import this from a Client Component: API keys
 * must not reach the browser bundle ("server-only" enforces that at build time).
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SEC_USER_AGENT: z.string().min(1).optional(),
  TIINGO_API_KEY: z.string().min(1).optional(),
  TIINGO_PLAN: z.enum(["free", "power", "commercial"]).optional(),
  FMP_API_KEY: z.string().min(1).optional(),
  FMP_PLAN: z.enum(["basic", "starter", "premium", "ultimate", "enterprise"]).optional(),
  /** Shared secret for the daily filings check endpoint (/api/cron/check-filings). */
  CRON_SECRET: z.string().min(16).optional(),
  ENABLE_DEV_FIXTURES: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    SEC_USER_AGENT: process.env.SEC_USER_AGENT || undefined,
    TIINGO_API_KEY: process.env.TIINGO_API_KEY || undefined,
    TIINGO_PLAN: process.env.TIINGO_PLAN?.toLowerCase() || undefined,
    FMP_API_KEY: process.env.FMP_API_KEY || undefined,
    FMP_PLAN: process.env.FMP_PLAN?.toLowerCase() || undefined,
    CRON_SECRET: process.env.CRON_SECRET || undefined,
    ENABLE_DEV_FIXTURES: process.env.ENABLE_DEV_FIXTURES || undefined,
  });
  if (!parsed.success) {
    throw new Error(`Invalid server environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  cached = parsed.data;
  return cached;
}
