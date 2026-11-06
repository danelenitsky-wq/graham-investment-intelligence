import "server-only";
import { toMajorUnit, unitCurrency, type PriceUnit } from "@/lib/portfolio/currency";
import { calendarForExchange, localParts, sessionInfo } from "@/lib/market/calendar";
import { db } from "./db";

export const MANUAL_PRICE_SOURCE_KEY = "manual-price";

export async function manualPriceSource() {
  return db.dataSource.upsert({
    where: { key: MANUAL_PRICE_SOURCE_KEY },
    create: { key: MANUAL_PRICE_SOURCE_KEY, name: "Manual price update", kind: "MANUAL", description: "Prices typed in by the user, with the timestamp and source they gave." },
    update: {},
  });
}

export class ManualPriceError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "CURRENCY_MISMATCH" | "FUTURE_TIMESTAMP" | "INVALID") {
    super(code);
  }
}

/**
 * Record a manual price update. The value is stored as typed (with its unit)
 * and normalized to the major unit; the timestamp is the time the price
 * refers to (not the time it was typed), and the source label is required.
 */
export async function recordManualPrice(input: { securityId: string; price: number; unit: PriceUnit; timestamp: Date; sourceLabel: string; now?: Date }) {
  const now = input.now ?? new Date();
  const security = await db.security.findUnique({ where: { id: input.securityId }, include: { exchange: true } });
  if (!security) throw new ManualPriceError("NOT_FOUND");
  const tradingCurrency = security.exchange.currency === "ILA" ? "ILS" : security.exchange.currency;
  if (unitCurrency(input.unit) !== tradingCurrency) throw new ManualPriceError("CURRENCY_MISMATCH");
  if (!(input.price > 0) || !input.sourceLabel.trim()) throw new ManualPriceError("INVALID");
  if (input.timestamp.getTime() > now.getTime() + 5 * 60_000) throw new ManualPriceError("FUTURE_TIMESTAMP");
  const { amount, currency } = toMajorUnit(input.price, input.unit);
  const source = await manualPriceSource();
  const calendar = calendarForExchange(security.exchange.code, security.exchange.timezone);
  const session = sessionInfo(calendar, now);
  return db.quoteSnapshot.create({
    data: {
      securityId: security.id,
      sourceId: source.id,
      price: amount,
      currency,
      exchange: security.exchange.code,
      feed: "UNKNOWN",
      feedNote: `Manual: ${input.sourceLabel.trim()}`.slice(0, 200),
      sourceTimestamp: input.timestamp,
      retrievedAt: now,
      sessionState: session.state,
      sessionDate: localParts(input.timestamp, security.exchange.timezone).date,
      verificationStatus: "SINGLE_SOURCE",
      isManual: true,
      enteredPrice: input.price,
      enteredUnit: input.unit,
      sourceLabel: input.sourceLabel.trim().slice(0, 200),
    },
  });
}

export async function listManualPrices(take = 30) {
  return db.quoteSnapshot.findMany({ where: { isManual: true }, orderBy: { retrievedAt: "desc" }, take, include: { security: { include: { exchange: true } } } });
}
