/**
 * Exchange trading calendars and session state (pure, no I/O).
 *
 * All instants are UTC `Date`s; all "local" values are in the exchange's IANA
 * timezone. The US calendar implements the NYSE/Nasdaq holiday and early-close
 * rules. Calendars we cannot compute reliably (TASE holidays follow the Hebrew
 * calendar and government announcements) are marked `verified: false`; their
 * session state is reported as UNKNOWN so the freshness engine never claims a
 * market is open or that a quote is the official last close.
 */

export type Ymd = string; // YYYY-MM-DD in exchange-local time

export interface ExchangeCalendar {
  id: string;
  timezone: string;
  /** Regular session, exchange-local HH:MM. */
  open: string;
  close: string;
  /** Days of week with no regular session (0 = Sunday). */
  weekend: number[];
  /** Full-day closures for a year: date → name. */
  holidays(year: number): Map<Ymd, string>;
  /** Shortened sessions for a year: date → local close HH:MM. */
  earlyCloses(year: number): Map<Ymd, string>;
  /** False when holidays are not modelled; session state is then UNKNOWN. */
  verified: boolean;
}

// ───────────────────────────── Date helpers ─────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (y: number, m: number, d: number): Ymd => `${y}-${pad(m)}-${pad(d)}`;

function dow(date: Ymd): number {
  return new Date(date + "T12:00:00Z").getUTCDay();
}

export function addDays(date: Ymd, n: number): Ymd {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** n-th (1-based) weekday `wd` of month; n = -1 for the last one. */
function nthWeekday(year: number, month: number, wd: number, n: number): Ymd {
  if (n > 0) {
    const first = dow(ymd(year, month, 1));
    return ymd(year, month, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = dow(ymd(year, month, lastDay));
  return ymd(year, month, lastDay - ((last - wd + 7) % 7));
}

/** Gregorian Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year: number): Ymd {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** Saturday holidays are observed on Friday, Sunday holidays on Monday. */
function observed(date: Ymd): Ymd {
  const wd = dow(date);
  if (wd === 6) return addDays(date, -1);
  if (wd === 0) return addDays(date, 1);
  return date;
}

// ──────────────────────────── Timezone helpers ────────────────────────────

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  date: Ymd;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(instant: Date, tz: string): LocalParts {
  const p = Object.fromEntries(formatter(tz).formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}

function offsetMs(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const [y, m, d] = p.date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Exchange-local wall time → UTC instant (DST-aware). */
export function zonedTimeToUtc(date: Ymd, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// ─────────────────────────────── US equities ───────────────────────────────

/**
 * Unscheduled closures announced by NYSE (national days of mourning, etc.).
 * These cannot be computed; add new ones here when announced.
 */
export const US_SPECIAL_CLOSURES: Record<Ymd, string> = {
  "2018-12-05": "National Day of Mourning (George H.W. Bush)",
  "2025-01-09": "National Day of Mourning (Jimmy Carter)",
};

function usHolidays(year: number): Map<Ymd, string> {
  const h = new Map<Ymd, string>();
  // New Year's Day: a Saturday holiday is NOT observed on the preceding Friday (NYSE Rule 7.2).
  const ny = ymd(year, 1, 1);
  if (dow(ny) !== 6) h.set(observed(ny), "New Year's Day");
  h.set(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  h.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  h.set(addDays(easterSunday(year), -2), "Good Friday");
  h.set(nthWeekday(year, 5, 1, -1), "Memorial Day");
  if (year >= 2022) h.set(observed(ymd(year, 6, 19)), "Juneteenth");
  h.set(observed(ymd(year, 7, 4)), "Independence Day");
  h.set(nthWeekday(year, 9, 1, 1), "Labor Day");
  h.set(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  h.set(observed(ymd(year, 12, 25)), "Christmas Day");
  for (const [d, name] of Object.entries(US_SPECIAL_CLOSURES)) if (d.startsWith(String(year))) h.set(d, name);
  return h;
}

function usEarlyCloses(year: number): Map<Ymd, string> {
  const e = new Map<Ymd, string>();
  const holidays = usHolidays(year);
  const isSession = (d: Ymd) => ![0, 6].includes(dow(d)) && !holidays.has(d);
  // July 3 (when July 4 is a weekday holiday and July 3 is a session).
  const jul3 = ymd(year, 7, 3);
  if (isSession(jul3) && ![0, 6].includes(dow(ymd(year, 7, 4)))) e.set(jul3, "13:00");
  // Day after Thanksgiving.
  e.set(addDays(nthWeekday(year, 11, 4, 4), 1), "13:00");
  // Christmas Eve.
  const dec24 = ymd(year, 12, 24);
  if (isSession(dec24)) e.set(dec24, "13:00");
  return e;
}

function memo<T>(fn: (year: number) => T): (year: number) => T {
  const cache = new Map<number, T>();
  return (year) => {
    if (!cache.has(year)) cache.set(year, fn(year));
    return cache.get(year)!;
  };
}

export const US_EQUITY_CALENDAR: ExchangeCalendar = {
  id: "XNYS",
  timezone: "America/New_York",
  open: "09:30",
  close: "16:00",
  weekend: [0, 6],
  holidays: memo(usHolidays),
  earlyCloses: memo(usEarlyCloses),
  verified: true,
};

/**
 * Tel Aviv Stock Exchange. Trading days and holidays are NOT modelled (holidays
 * follow the Hebrew calendar and are set by TASE each year), so this calendar is
 * unverified: sessions report UNKNOWN instead of guessing.
 */
export const TASE_CALENDAR: ExchangeCalendar = {
  id: "XTAE",
  timezone: "Asia/Jerusalem",
  // Placeholders only: never used while `verified` is false.
  open: "00:00",
  close: "23:59",
  weekend: [],
  holidays: () => new Map(),
  earlyCloses: () => new Map(),
  verified: false,
};

const US_CODES = new Set(["NASDAQ", "NYSE", "NYSEAMERICAN", "NYSEARCA", "CBOE", "OTC"]);

export function calendarForExchange(exchangeCode: string, timezone?: string): ExchangeCalendar {
  if (US_CODES.has(exchangeCode.toUpperCase())) return US_EQUITY_CALENDAR;
  if (exchangeCode.toUpperCase() === "TASE") return TASE_CALENDAR;
  return { ...TASE_CALENDAR, id: exchangeCode, timezone: timezone ?? "UTC" };
}

// ───────────────────────────── Session state ─────────────────────────────

export type SessionState = "OPEN" | "CLOSED" | "UNKNOWN";
export type ClosedReason = "WEEKEND" | "HOLIDAY" | "BEFORE_OPEN" | "AFTER_CLOSE" | null;

export interface SessionInfo {
  calendarId: string;
  timezone: string;
  state: SessionState;
  closedReason: ClosedReason;
  holidayName: string | null;
  localDate: Ymd;
  /** Today's session bounds, when today is a trading day. */
  sessionOpen: string | null;
  sessionClose: string | null;
  earlyClose: boolean;
  /** Most recent session whose close is at or before `now`. */
  lastSessionDate: Ymd | null;
  lastSessionClose: string | null;
  /** Next session open after `now` (or today's open when before it). */
  nextOpen: string | null;
}

export function isTradingDay(cal: ExchangeCalendar, date: Ymd): boolean {
  const year = Number(date.slice(0, 4));
  return !cal.weekend.includes(dow(date)) && !cal.holidays(year).has(date);
}

export function sessionCloseTime(cal: ExchangeCalendar, date: Ymd): string {
  return cal.earlyCloses(Number(date.slice(0, 4))).get(date) ?? cal.close;
}

/** Most recent trading day strictly before `date`. */
export function previousTradingDay(cal: ExchangeCalendar, date: Ymd): Ymd {
  let d = addDays(date, -1);
  for (let i = 0; i < 15 && !isTradingDay(cal, d); i++) d = addDays(d, -1);
  return d;
}

export function nextTradingDay(cal: ExchangeCalendar, date: Ymd): Ymd {
  let d = addDays(date, 1);
  for (let i = 0; i < 15 && !isTradingDay(cal, d); i++) d = addDays(d, 1);
  return d;
}

export function sessionInfo(cal: ExchangeCalendar, now: Date): SessionInfo {
  const local = localParts(now, cal.timezone);
  const base = { calendarId: cal.id, timezone: cal.timezone, localDate: local.date };
  if (!cal.verified) {
    return { ...base, state: "UNKNOWN", closedReason: null, holidayName: null, sessionOpen: null, sessionClose: null, earlyClose: false, lastSessionDate: null, lastSessionClose: null, nextOpen: null };
  }
  const today = local.date;
  const holidayName = cal.holidays(Number(today.slice(0, 4))).get(today) ?? null;
  const trading = isTradingDay(cal, today);
  const nowMin = local.hour * 60 + local.minute + local.second / 60;
  const closeHm = sessionCloseTime(cal, today);
  const prevDay = previousTradingDay(cal, today);
  const prevClose = zonedTimeToUtc(prevDay, sessionCloseTime(cal, prevDay), cal.timezone).toISOString();
  const nextDay = nextTradingDay(cal, today);
  const nextOpenIso = zonedTimeToUtc(nextDay, cal.open, cal.timezone).toISOString();

  if (!trading) {
    return {
      ...base,
      state: "CLOSED",
      closedReason: holidayName ? "HOLIDAY" : "WEEKEND",
      holidayName,
      sessionOpen: null,
      sessionClose: null,
      earlyClose: false,
      lastSessionDate: prevDay,
      lastSessionClose: prevClose,
      nextOpen: nextOpenIso,
    };
  }
  const openIso = zonedTimeToUtc(today, cal.open, cal.timezone).toISOString();
  const closeIso = zonedTimeToUtc(today, closeHm, cal.timezone).toISOString();
  const earlyClose = closeHm !== cal.close;
  if (nowMin < toMinutes(cal.open)) {
    return { ...base, state: "CLOSED", closedReason: "BEFORE_OPEN", holidayName: null, sessionOpen: openIso, sessionClose: closeIso, earlyClose, lastSessionDate: prevDay, lastSessionClose: prevClose, nextOpen: openIso };
  }
  if (nowMin >= toMinutes(closeHm)) {
    return { ...base, state: "CLOSED", closedReason: "AFTER_CLOSE", holidayName: null, sessionOpen: openIso, sessionClose: closeIso, earlyClose, lastSessionDate: today, lastSessionClose: closeIso, nextOpen: nextOpenIso };
  }
  return { ...base, state: "OPEN", closedReason: null, holidayName: null, sessionOpen: openIso, sessionClose: closeIso, earlyClose, lastSessionDate: prevDay, lastSessionClose: prevClose, nextOpen: nextOpenIso };
}
