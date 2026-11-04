import { describe, expect, it } from "vitest";
import {
  TASE_CALENDAR,
  US_EQUITY_CALENDAR,
  calendarForExchange,
  easterSunday,
  isTradingDay,
  previousTradingDay,
  sessionInfo,
  zonedTimeToUtc,
} from "@/lib/market/calendar";

const cal = US_EQUITY_CALENDAR;
const at = (iso: string) => sessionInfo(cal, new Date(iso));

describe("US equity calendar — holidays", () => {
  it("computes Easter / Good Friday", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(cal.holidays(2026).get("2026-04-03")).toBe("Good Friday");
  });

  it("matches the published NYSE 2026 holiday list", () => {
    expect([...cal.holidays(2026).keys()].sort()).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-04-03",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03", // Independence Day (Saturday) observed Friday
      "2026-09-07",
      "2026-11-26",
      "2026-12-25",
    ]);
  });

  it("does not observe a Saturday New Year's Day on the previous Friday", () => {
    // 2022-01-01 was a Saturday; NYSE traded on Friday 2021-12-31.
    expect(isTradingDay(cal, "2021-12-31")).toBe(true);
    expect(cal.holidays(2022).has("2021-12-31")).toBe(false);
  });

  it("observes Sunday holidays on Monday and includes special closures", () => {
    expect(cal.holidays(2022).get("2022-12-26")).toBe("Christmas Day"); // Dec 25 2022 was a Sunday
    expect(isTradingDay(cal, "2025-01-09")).toBe(false); // National Day of Mourning
  });

  it("knows early closes", () => {
    expect(cal.earlyCloses(2026).get("2026-11-27")).toBe("13:00"); // day after Thanksgiving
    expect(cal.earlyCloses(2026).get("2026-12-24")).toBe("13:00");
    expect(cal.earlyCloses(2025).get("2025-07-03")).toBe("13:00");
    expect(cal.earlyCloses(2026).has("2026-07-03")).toBe(false); // that day is the holiday itself
  });

  it("finds the previous trading day across weekends and holidays", () => {
    expect(previousTradingDay(cal, "2026-04-06")).toBe("2026-04-02"); // Monday after Good Friday
    expect(previousTradingDay(cal, "2026-01-20")).toBe("2026-01-16"); // Tuesday after MLK day
  });
});

describe("timezone conversion", () => {
  it("handles EST and EDT", () => {
    expect(zonedTimeToUtc("2026-01-15", "09:30", "America/New_York").toISOString()).toBe("2026-01-15T14:30:00.000Z");
    expect(zonedTimeToUtc("2026-07-15", "16:00", "America/New_York").toISOString()).toBe("2026-07-15T20:00:00.000Z");
    // DST starts 2026-03-08: the open on Monday 03-09 is 13:30 UTC.
    expect(zonedTimeToUtc("2026-03-09", "09:30", "America/New_York").toISOString()).toBe("2026-03-09T13:30:00.000Z");
  });
});

describe("session state (market closures)", () => {
  it("is OPEN during regular hours", () => {
    const s = at("2026-11-04T15:00:00Z"); // Wed 10:00 ET
    expect(s.state).toBe("OPEN");
    expect(s.lastSessionDate).toBe("2026-11-03");
  });

  it("is CLOSED before the open and after the close", () => {
    expect(at("2026-11-04T13:00:00Z")).toMatchObject({ state: "CLOSED", closedReason: "BEFORE_OPEN", lastSessionDate: "2026-11-03" });
    const after = at("2026-11-04T21:30:00Z"); // 16:30 ET
    expect(after).toMatchObject({ state: "CLOSED", closedReason: "AFTER_CLOSE", lastSessionDate: "2026-11-04" });
    expect(after.lastSessionClose).toBe("2026-11-04T21:00:00.000Z");
  });

  it("is CLOSED on weekends, pointing at Friday's close and Monday's open", () => {
    const s = at("2026-11-07T17:00:00Z"); // Saturday
    expect(s).toMatchObject({ state: "CLOSED", closedReason: "WEEKEND", lastSessionDate: "2026-11-06" });
    expect(s.nextOpen).toBe("2026-11-09T14:30:00.000Z");
  });

  it("is CLOSED on holidays with the holiday name", () => {
    const s = at("2026-11-26T16:00:00Z"); // Thanksgiving
    expect(s).toMatchObject({ state: "CLOSED", closedReason: "HOLIDAY", holidayName: "Thanksgiving Day", lastSessionDate: "2026-11-25" });
  });

  it("closes at 13:00 on early-close days", () => {
    expect(at("2026-11-27T17:30:00Z").state).toBe("OPEN"); // 12:30 ET
    const s = at("2026-11-27T18:30:00Z"); // 13:30 ET
    expect(s).toMatchObject({ state: "CLOSED", closedReason: "AFTER_CLOSE", earlyClose: true });
    expect(s.lastSessionClose).toBe("2026-11-27T18:00:00.000Z");
  });

  it("reports UNKNOWN for calendars that are not modelled (TASE)", () => {
    expect(calendarForExchange("TASE")).toBe(TASE_CALENDAR);
    expect(sessionInfo(TASE_CALENDAR, new Date("2026-11-04T10:00:00Z")).state).toBe("UNKNOWN");
  });
});
