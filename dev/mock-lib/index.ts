// Browser stand-in for @seelen-ui/lib, used only by `npm run preview` so the
// widget can be developed without Seelen UI running. Never bundled into the
// real widget. Google endpoints are faked, so no network or sign-in happens.
//
// Query params: scenario=setup|signin|agenda, lang=zh-CN|en, theme=dark|light

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "agenda";
const lang = params.get("lang") ?? "zh-CN";
const theme = params.get("theme") ?? "dark";

const vars =
  theme === "light"
    ? { "--color-background": "#f3f3f3", "--color-foreground": "#1b1b1b", "--color-accent": "#005fb8" }
    : { "--color-background": "#202020", "--color-foreground": "#ffffff", "--color-accent": "#4cc2ff" };
for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);

// ------------------------------------------------------------------ data files

const files = new Map<string, string>();
const FAR_FUTURE = Date.now() + 365 * 24 * 3600 * 1000;
if (scenario === "agenda") {
  files.set("auth.json", JSON.stringify({ refreshToken: "mock-rt", accessToken: "mock-at", expiresAt: FAR_FUTURE }));
}

export const SeelenCommand = {
  ReadFile: "read_data_file",
  WriteFile: "write_data_file",
  TriggerWidget: "trigger_widget",
} as const;

export async function invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case SeelenCommand.ReadFile: {
      const value = files.get(String(args.filename));
      if (value === undefined) throw new Error("file not found");
      return value;
    }
    case SeelenCommand.WriteFile:
      files.set(String(args.filename), String(args.content));
      return null;
    default:
      console.info("[mock] invoke", command, args);
      return null;
  }
}

// ------------------------------------------------------------------ settings

let config: Record<string, unknown> = {
  clientId: scenario === "setup" ? "" : "mock-client.apps.googleusercontent.com",
  clientSecret: scenario === "setup" ? "" : "mock-secret",
  authResponse: "",
  refreshMinutes: 10,
  showDeclined: false,
};
const listeners = new Set<(s: Settings) => void>();

export class Settings {
  inner = { language: lang, startOfWeek: params.get("weekStart") ?? "Monday" };
  static async getAsync(): Promise<Settings> {
    return new Settings();
  }
  static async onChange(cb: (s: Settings) => void): Promise<() => void> {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }
  getCurrentWidgetConfig(): Record<string, unknown> {
    return { enabled: true, ...config };
  }
}

// ------------------------------------------------------------------ widget

const triggerListeners: Array<(payload: unknown) => void> = [];
let hidden = false;

export class Widget {
  static readonly self = new Widget();
  readonly id = "@uranus92/gcal-agenda";
  async init(): Promise<void> {}
  async ready(): Promise<void> {}
  onTrigger(cb: (payload: unknown) => void): void {
    triggerListeners.push(cb);
  }
  hide(): void {
    hidden = true;
    console.info("[mock] widget.hide()");
  }
}

// ------------------------------------------------------------------ fake Google

const openedUrls: string[] = [];
window.open = ((url: string) => {
  openedUrls.push(String(url));
  console.info("[mock] window.open", url);
  return null;
}) as typeof window.open;

const day = (offset: number, h = 0, m = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, h, m);
};
const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const now = new Date();
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

const EVENTS: Record<string, unknown[]> = {
  work: [
    { id: "w1", summary: "Project week", start: { date: ymd(day(0)) }, end: { date: ymd(day(3)) }, htmlLink: "https://www.google.com/calendar/event?eid=w1" },
    { id: "w2", summary: "Morning standup", start: { dateTime: iso(minutes(-180)) }, end: { dateTime: iso(minutes(-165)) } },
    { id: "w3", summary: "Design review", location: "Room 4B", start: { dateTime: iso(minutes(-30)) }, end: { dateTime: iso(minutes(30)) }, htmlLink: "https://www.google.com/calendar/event?eid=w3" },
    { id: "w4", summary: "1:1 sync", start: { dateTime: iso(minutes(180)) }, end: { dateTime: iso(minutes(210)) }, htmlLink: "https://www.google.com/calendar/event?eid=w4" },
    { id: "w5", summary: "Team lunch", location: "Canteen, 2/F", start: { dateTime: iso(day(1, 12)) }, end: { dateTime: iso(day(1, 13, 30)) } },
    { id: "w6", summary: "Declined meeting", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: iso(day(4, 10)) }, end: { dateTime: iso(day(4, 11)) } },
    { id: "w7", summary: "Cancelled", status: "cancelled", start: { dateTime: iso(day(2, 10)) }, end: { dateTime: iso(day(2, 11)) } },
  ],
  personal: [
    { id: "p1", summary: "Dentist", colorId: "11", start: { dateTime: iso(day(1, 9, 30)) }, end: { dateTime: iso(day(1, 10)) } },
    { id: "p2", summary: "Flight HKG → LHR", location: "HKG Terminal 1", start: { dateTime: iso(day(2, 21)) }, end: { dateTime: iso(day(3, 7)) } },
    // Untrusted invite text must render literally, and unsafe links must not be clickable.
    { id: "p3", summary: '<img src=x onerror="alert(1)"> raw HTML title', start: { dateTime: iso(day(5, 18)) }, end: { dateTime: iso(day(5, 19)) }, htmlLink: "javascript:alert(1)" },
    { id: "p4", summary: "", start: { date: ymd(day(6)) }, end: { date: ymd(day(7)) } },
    { id: "p5", summary: "Gym", colorId: "10", start: { dateTime: iso(day(-2, 7)) }, end: { dateTime: iso(day(-2, 8)) } },
    { id: "p6", summary: "Library returns due", start: { date: ymd(day(-9)) }, end: { date: ymd(day(-8)) } },
    { id: "p7", summary: "Concert", location: "City Hall", colorId: "3", start: { dateTime: iso(day(12, 20)) }, end: { dateTime: iso(day(12, 22)) } },
  ],
};

const realFetch = window.fetch.bind(window);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  await new Promise((r) => setTimeout(r, 250));
  if (url.origin === "https://oauth2.googleapis.com") {
    console.info("[mock] token endpoint", Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))));
    if (url.pathname === "/revoke") return json({});
    return json({ access_token: "mock-at-2", refresh_token: "mock-rt", expires_in: 3600 });
  }
  if (url.origin === "https://www.googleapis.com") {
    if (url.pathname.endsWith("/users/me/calendarList")) {
      return json({
        items: [
          { id: "work", summary: "Work", backgroundColor: "#4285f4", selected: true },
          { id: "personal", summary: "Personal", backgroundColor: "#33b679", selected: true },
          { id: "hidden", summary: "Unticked calendar", backgroundColor: "#f00", selected: false },
        ],
      });
    }
    const m = /\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (m) return json({ items: EVENTS[decodeURIComponent(m[1])] ?? [] });
    return json({ error: { message: "not mocked" } }, 404);
  }
  return realFetch(input, init);
}) as typeof window.fetch;

// ------------------------------------------------------------------ preview controls

declare global {
  interface Window {
    __preview: unknown;
  }
}

window.__preview = {
  files,
  openedUrls,
  get hidden() {
    return hidden;
  },
  /** Acts like clicking the date in the toolbar. */
  trigger() {
    hidden = false;
    for (const cb of triggerListeners) cb({ id: "@uranus92/gcal-agenda" });
  },
  setConfig(patch: Record<string, unknown>) {
    config = { ...config, ...patch };
    for (const cb of listeners) cb(new Settings());
  },
  /** Acts like the user pasting the 127.0.0.1 redirect into the widget's setting. */
  simulateRedirect() {
    const pending = JSON.parse(files.get("pending-auth.json") || "null");
    if (!pending) throw new Error("click 'Sign in with Google' first");
    const redirect = `${pending.redirectUri}?state=${pending.state}&code=4/0Amock-code&scope=calendar.readonly`;
    (window.__preview as { setConfig: (p: Record<string, unknown>) => void }).setConfig({ authResponse: redirect });
  },
};
