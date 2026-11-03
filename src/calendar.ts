// Google Calendar v3 REST calls. www.googleapis.com answers CORS preflights for
// the widget origin (http://tauri.localhost), so plain fetch works from the webview.

import { type AgendaEvent, type CalendarInfo, type GoogleEvent, normalizeEvent } from "./agenda.ts";

const API = "https://www.googleapis.com/calendar/v3";
const MAX_PAGES = 10;

export class CalendarApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CalendarApiError";
    this.status = status;
  }
}

interface CalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  selected?: boolean;
  hidden?: boolean;
}

async function getJson<T>(url: string, accessToken: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new CalendarApiError(body?.error?.message || `HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

/** Calendars the user has ticked in Google Calendar's sidebar. */
export async function listVisibleCalendars(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<CalendarInfo[]> {
  const out: CalendarInfo[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      minAccessRole: "reader",
      fields: "nextPageToken,items(id,summary,summaryOverride,backgroundColor,selected,hidden)",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await getJson<{ items?: CalendarListEntry[]; nextPageToken?: string }>(
      `${API}/users/me/calendarList?${params}`,
      accessToken,
      fetchImpl,
    );
    for (const c of json.items ?? []) {
      if (!c.selected || c.hidden) continue;
      out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || "#4285f4" });
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function listEvents(
  accessToken: string,
  calendar: CalendarInfo,
  timeMin: number,
  timeMax: number,
  showDeclined: boolean,
  fetchImpl: typeof fetch,
): Promise<AgendaEvent[]> {
  const out: AgendaEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      fields:
        "nextPageToken,items(id,status,summary,location,htmlLink,colorId,eventType,start,end,attendees(self,responseStatus))",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await getJson<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      `${API}/calendars/${encodeURIComponent(calendar.id)}/events?${params}`,
      accessToken,
      fetchImpl,
    );
    for (const raw of json.items ?? []) {
      const event = normalizeEvent(raw, calendar, { showDeclined });
      if (event) out.push(event);
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export interface FetchResult {
  events: AgendaEvent[];
  /** Calendars that failed individually; the rest still render. */
  failedCalendars: string[];
}

export async function fetchAgendaEvents(
  args: { accessToken: string; timeMin: number; timeMax: number; showDeclined: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<FetchResult> {
  const calendars = await listVisibleCalendars(args.accessToken, fetchImpl);
  const results = await Promise.allSettled(
    calendars.map((c) => listEvents(args.accessToken, c, args.timeMin, args.timeMax, args.showDeclined, fetchImpl)),
  );
  const events: AgendaEvent[] = [];
  const failedCalendars: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      events.push(...r.value);
    } else {
      // An expired token fails every calendar; surface it instead of an empty list.
      if (r.reason instanceof CalendarApiError && r.reason.status === 401) throw r.reason;
      failedCalendars.push(calendars[i].name);
    }
  });
  return { events, failedCalendars };
}
