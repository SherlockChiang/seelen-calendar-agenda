// Pure agenda logic: no DOM, no Seelen, no network. Tested with `node --test`.

/** Subset of a Google Calendar v3 Event resource that the widget reads. */
export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  colorId?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

export interface CalendarInfo {
  id: string;
  name: string;
  color: string;
}

export interface AgendaEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  location: string;
  link: string;
  color: string;
  allDay: boolean;
  /** Epoch ms. For all-day events, local midnight of the first day. */
  start: number;
  /** Epoch ms, exclusive. For all-day events, local midnight after the last day. */
  end: number;
}

export type TimeLabel =
  | { kind: "allDay" }
  | { kind: "range"; start: number; end: number }
  | { kind: "startsAt"; start: number }
  | { kind: "endsAt"; end: number };

export interface AgendaItem {
  event: AgendaEvent;
  time: TimeLabel;
  ongoing: boolean;
  ended: boolean;
}

/** Google's fixed event palette (GET /calendar/v3/colors → event). */
export const EVENT_COLORS: Readonly<Record<string, string>> = {
  "1": "#a4bdfc",
  "2": "#7ae7bf",
  "3": "#dbadff",
  "4": "#ff887c",
  "5": "#fbd75b",
  "6": "#ffb878",
  "7": "#46d6db",
  "8": "#e1e1e1",
  "9": "#5484ed",
  "10": "#51b749",
  "11": "#dc2127",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses "YYYY-MM-DD" as local midnight. Returns NaN when malformed. */
export function parseLocalDate(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Adds whole local days (DST-safe, unlike adding 24h multiples). */
export function addLocalDays(dayMs: number, days: number): number {
  const d = new Date(dayMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/**
 * Maps a raw Google event to an AgendaEvent, or null when it should not be shown
 * (cancelled, declined, working-location markers, or unparseable times).
 */
export function normalizeEvent(
  raw: GoogleEvent,
  calendar: CalendarInfo,
  options: { showDeclined: boolean },
): AgendaEvent | null {
  if (raw.status === "cancelled") return null;
  if (raw.eventType === "workingLocation") return null;
  if (!options.showDeclined && raw.attendees?.some((a) => a.self && a.responseStatus === "declined")) {
    return null;
  }

  let start: number;
  let end: number;
  let allDay: boolean;
  if (raw.start?.dateTime) {
    allDay = false;
    start = Date.parse(raw.start.dateTime);
    end = raw.end?.dateTime ? Date.parse(raw.end.dateTime) : start;
  } else if (raw.start?.date) {
    allDay = true;
    start = parseLocalDate(raw.start.date);
    end = raw.end?.date ? parseLocalDate(raw.end.date) : addLocalDays(start, 1);
  } else {
    return null;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end < start) end = start;

  return {
    id: raw.id,
    calendarId: calendar.id,
    calendarName: calendar.name,
    title: raw.summary?.trim() || "",
    location: raw.location?.trim() || "",
    link: raw.htmlLink || "",
    color: (raw.colorId && EVENT_COLORS[raw.colorId]) || calendar.color,
    allDay,
    start,
    end,
  };
}

function timeLabelForDay(event: AgendaEvent, dayStart: number, dayEnd: number): TimeLabel {
  if (event.allDay) return { kind: "allDay" };
  const startsToday = event.start >= dayStart;
  const endsToday = event.end <= dayEnd;
  if (startsToday && endsToday) return { kind: "range", start: event.start, end: event.end };
  if (startsToday) return { kind: "startsAt", start: event.start };
  if (endsToday) return { kind: "endsAt", end: event.end };
  return { kind: "allDay" };
}

function overlaps(event: AgendaEvent, dayStart: number, dayEnd: number): boolean {
  // Zero-length events (start === end) belong to the day they start on.
  if (event.start === event.end) return event.start >= dayStart && event.start < dayEnd;
  return event.start < dayEnd && event.end > dayStart;
}

/**
 * Events on one local day, all-day first then by start time. Events spanning
 * several days appear on each day they overlap, labelled `startsAt` / `endsAt`.
 */
export function itemsForDay(events: readonly AgendaEvent[], day: number, now: number): AgendaItem[] {
  const dayStart = startOfLocalDay(day);
  const dayEnd = addLocalDays(dayStart, 1);
  const items: AgendaItem[] = [];
  for (const event of dedupe(events)) {
    if (!overlaps(event, dayStart, dayEnd)) continue;
    items.push({
      event,
      time: timeLabelForDay(event, dayStart, dayEnd),
      ongoing: !event.allDay && event.start <= now && now < event.end,
      ended: event.start === event.end ? event.start < now : event.end <= now,
    });
  }
  return items.sort(compareItems);
}

/** Up to `max` distinct event colors per day, for the dots under the month grid. */
export function dayColors(events: readonly AgendaEvent[], days: readonly number[], max = 3): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const unique = dedupe(events);
  for (const day of days) {
    const dayEnd = addLocalDays(day, 1);
    const colors: string[] = [];
    for (const event of unique) {
      if (!overlaps(event, day, dayEnd) || colors.includes(event.color)) continue;
      colors.push(event.color);
      if (colors.length === max) break;
    }
    if (colors.length) out.set(day, colors);
  }
  return out;
}

/** Seelen's `startOfWeek` setting as a JS day index (0 = Sunday). Defaults to Monday. */
export function weekStartIndex(startOfWeek: string | null | undefined): number {
  const i = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(startOfWeek ?? "");
  return i === -1 ? 1 : i;
}

/** First day of the month containing `ms`, as local midnight. */
export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function addMonths(monthStart: number, months: number): number {
  const d = new Date(monthStart);
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime();
}

/** The 42 local midnights (6 weeks) shown for the month containing `ms`. */
export function monthGrid(ms: number, weekStart: number): number[] {
  const first = new Date(startOfMonth(ms));
  const lead = (first.getDay() - weekStart + 7) % 7;
  const gridStart = addLocalDays(first.getTime(), -lead);
  return Array.from({ length: 42 }, (_, i) => addLocalDays(gridStart, i));
}

function sortKey(item: AgendaItem): number {
  switch (item.time.kind) {
    case "allDay":
      return -Infinity;
    case "endsAt":
      return -1;
    case "range":
    case "startsAt":
      return item.time.start;
  }
}

function compareItems(a: AgendaItem, b: AgendaItem): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.event.title.localeCompare(b.event.title);
}

/** The same event can come back from two calendars (e.g. an invite on a shared calendar). */
function dedupe(events: readonly AgendaEvent[]): AgendaEvent[] {
  const seen = new Set<string>();
  const out: AgendaEvent[] = [];
  for (const e of events) {
    const key = `${e.id}|${e.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Day offset of `day` relative to the local day containing `now` (0 = today). */
export function dayOffset(day: number, now: number): number {
  return Math.round((startOfLocalDay(day) - startOfLocalDay(now)) / DAY_MS);
}

/**
 * Only open links that point at Google Calendar over https; event links come
 * from other people's invites and must not be trusted blindly.
 */
export function isSafeCalendarLink(link: string): boolean {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:") return false;
    return url.hostname === "calendar.google.com" || url.hostname === "www.google.com";
  } catch {
    return false;
  }
}
