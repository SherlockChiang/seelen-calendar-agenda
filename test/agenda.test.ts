import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgendaEvent,
  addLocalDays,
  addMonths,
  type CalendarInfo,
  dayColors,
  EVENT_COLORS,
  isSafeCalendarLink,
  itemsForDay,
  monthGrid,
  normalizeEvent,
  parseLocalDate,
  startOfMonth,
  weekStartIndex,
} from "../src/agenda.ts";

const cal: CalendarInfo = { id: "primary", name: "Me", color: "#123456" };
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

function ev(partial: Partial<AgendaEvent> & { start: number; end: number }): AgendaEvent {
  return {
    id: partial.id ?? `e${partial.start}`,
    calendarId: "primary",
    calendarName: "Me",
    title: partial.title ?? "Event",
    location: "",
    link: "",
    color: "#123456",
    allDay: false,
    ...partial,
  };
}

describe("normalizeEvent", () => {
  it("maps timed events", () => {
    const e = normalizeEvent(
      {
        id: "a",
        summary: " Standup ",
        start: { dateTime: "2026-11-02T09:00:00+08:00" },
        end: { dateTime: "2026-11-02T09:15:00+08:00" },
      },
      cal,
      { showDeclined: false },
    );
    assert.ok(e);
    assert.equal(e.title, "Standup");
    assert.equal(e.allDay, false);
    assert.equal(e.end - e.start, 15 * 60_000);
    assert.equal(e.color, "#123456");
  });

  it("maps all-day events to local midnights with exclusive end", () => {
    const e = normalizeEvent(
      { id: "b", start: { date: "2026-11-02" }, end: { date: "2026-11-04" } },
      cal,
      { showDeclined: false },
    );
    assert.ok(e);
    assert.equal(e.allDay, true);
    assert.equal(e.start, at(2026, 11, 2));
    assert.equal(e.end, at(2026, 11, 4));
  });

  it("prefers the event's own color over the calendar color", () => {
    const e = normalizeEvent({ id: "c", colorId: "11", start: { date: "2026-11-02" } }, cal, { showDeclined: false });
    assert.equal(e?.color, EVENT_COLORS["11"]);
  });

  it("drops cancelled, working-location and declined events", () => {
    const base = { start: { date: "2026-11-02" } };
    assert.equal(normalizeEvent({ id: "x", status: "cancelled", ...base }, cal, { showDeclined: true }), null);
    assert.equal(normalizeEvent({ id: "x", eventType: "workingLocation", ...base }, cal, { showDeclined: true }), null);
    const declined = { id: "x", attendees: [{ self: true, responseStatus: "declined" }], ...base };
    assert.equal(normalizeEvent(declined, cal, { showDeclined: false }), null);
    assert.ok(normalizeEvent(declined, cal, { showDeclined: true }));
  });

  it("rejects events without a usable start", () => {
    assert.equal(normalizeEvent({ id: "x" }, cal, { showDeclined: false }), null);
    assert.equal(normalizeEvent({ id: "x", start: { date: "garbage" } }, cal, { showDeclined: false }), null);
  });
});

describe("itemsForDay", () => {
  const now = at(2026, 11, 2, 10, 0);

  it("flags ended and ongoing events instead of hiding them", () => {
    const items = itemsForDay(
      [
        ev({ id: "past", start: at(2026, 11, 2, 8), end: at(2026, 11, 2, 9) }),
        ev({ id: "now", start: at(2026, 11, 2, 9, 30), end: at(2026, 11, 2, 10, 30) }),
        ev({ id: "later", start: at(2026, 11, 2, 15), end: at(2026, 11, 2, 16) }),
        ev({ id: "tomorrow", start: at(2026, 11, 3, 9), end: at(2026, 11, 3, 10) }),
      ],
      at(2026, 11, 2, 15),
      now,
    );
    assert.deepEqual(
      items.map((i) => [i.event.id, i.ended, i.ongoing]),
      [
        ["past", true, false],
        ["now", false, true],
        ["later", false, false],
      ],
    );
  });

  it("puts all-day events first and sorts by start time", () => {
    const items = itemsForDay(
      [
        ev({ id: "b", start: at(2026, 11, 3, 14), end: at(2026, 11, 3, 15) }),
        ev({ id: "a", start: at(2026, 11, 3, 9), end: at(2026, 11, 3, 10) }),
        ev({ id: "all", allDay: true, start: at(2026, 11, 3), end: at(2026, 11, 4) }),
      ],
      at(2026, 11, 3),
      now,
    );
    assert.deepEqual(
      items.map((i) => i.event.id),
      ["all", "a", "b"],
    );
  });

  it("splits multi-day timed events into start / middle / end labels", () => {
    const trip = [ev({ id: "trip", start: at(2026, 11, 2, 18), end: at(2026, 11, 4, 11) })];
    assert.deepEqual(
      [2, 3, 4, 5].map((d) => itemsForDay(trip, at(2026, 11, d), now)[0]?.time.kind),
      ["startsAt", "allDay", "endsAt", undefined],
    );
  });

  it("does not show an all-day event on the day after it ends", () => {
    const conf = [ev({ id: "conf", allDay: true, start: at(2026, 11, 1), end: at(2026, 11, 3) })];
    assert.equal(itemsForDay(conf, at(2026, 11, 2), now).length, 1);
    assert.equal(itemsForDay(conf, at(2026, 11, 3), now).length, 0);
  });

  it("dedupes the same event returned by two calendars", () => {
    const e = ev({ id: "shared", start: at(2026, 11, 2, 12), end: at(2026, 11, 2, 13) });
    assert.equal(itemsForDay([e, { ...e, calendarId: "other" }], at(2026, 11, 2), now).length, 1);
  });
});

describe("dayColors", () => {
  it("collects up to three distinct colors per day", () => {
    const day = at(2026, 11, 2);
    const events = ["#111111", "#222222", "#111111", "#333333", "#444444"].map((color, i) =>
      ev({ id: `e${i}`, color, start: at(2026, 11, 2, 9 + i), end: at(2026, 11, 2, 10 + i) }),
    );
    const colors = dayColors(events, [day, at(2026, 11, 3)]);
    assert.deepEqual(colors.get(day), ["#111111", "#222222", "#333333"]);
    assert.equal(colors.has(at(2026, 11, 3)), false);
  });
});

describe("month grid", () => {
  it("starts on the configured weekday and covers six weeks", () => {
    // 1 Nov 2026 is a Sunday.
    const monday = monthGrid(at(2026, 11, 17), weekStartIndex("Monday"));
    assert.equal(monday.length, 42);
    assert.equal(monday[0], at(2026, 10, 26));
    assert.equal(monday[6], at(2026, 11, 1));
    assert.equal(monday[41], at(2026, 12, 6));

    const sunday = monthGrid(at(2026, 11, 17), weekStartIndex("Sunday"));
    assert.equal(sunday[0], at(2026, 11, 1));
  });

  it("defaults to Monday and steps months across year ends", () => {
    assert.equal(weekStartIndex(undefined), 1);
    assert.equal(weekStartIndex("Saturday"), 6);
    assert.equal(startOfMonth(at(2026, 12, 31, 23)), at(2026, 12, 1));
    assert.equal(addMonths(at(2026, 12, 1), 1), at(2027, 1, 1));
    assert.equal(addMonths(at(2026, 1, 1), -1), at(2025, 12, 1));
  });
});

describe("date helpers", () => {
  it("adds local days across DST-free and month boundaries", () => {
    assert.equal(addLocalDays(at(2026, 10, 31), 1), at(2026, 11, 1));
    assert.equal(parseLocalDate("2026-02-30"), at(2026, 3, 2)); // Date rolls over, as Google never sends this
    assert.ok(Number.isNaN(parseLocalDate("2026-1-1")));
  });
});

describe("isSafeCalendarLink", () => {
  it("only allows https Google Calendar links", () => {
    assert.ok(isSafeCalendarLink("https://www.google.com/calendar/event?eid=abc"));
    assert.ok(isSafeCalendarLink("https://calendar.google.com/calendar/r"));
    assert.ok(!isSafeCalendarLink("http://www.google.com/calendar/event?eid=abc"));
    assert.ok(!isSafeCalendarLink("https://www.google.com.evil.example/calendar"));
    assert.ok(!isSafeCalendarLink("javascript:alert(1)"));
    assert.ok(!isSafeCalendarLink(""));
  });
});
