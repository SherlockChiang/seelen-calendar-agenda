import { invoke, SeelenCommand, Settings, Widget } from "@seelen-ui/lib";
import {
  type AgendaEvent,
  addLocalDays,
  addMonths,
  dayColors,
  isSafeCalendarLink,
  itemsForDay,
  monthGrid,
  startOfLocalDay,
  startOfMonth,
  weekStartIndex,
} from "./agenda.ts";
import { CalendarApiError, fetchAgendaEvents } from "./calendar.ts";
import {
  formatDayHeading,
  formatMonthTitle,
  formatTime,
  formatTimeLabel,
  type Locale,
  resolveLocale,
  weekdayNames,
} from "./i18n.ts";
import {
  buildAuthUrl,
  createPendingAuth,
  exchangeCode,
  isPendingAuthUsable,
  OAuthError,
  parseAuthResponse,
  type PendingAuth,
  refreshAccessToken,
  revokeToken,
  type StoredTokens,
} from "./oauth.ts";
import { readJson, removeJson, writeJson } from "./store.ts";

const AUTH_FILE = "auth.json";
const PENDING_FILE = "pending-auth.json";
const CACHE_FILE = "cache.json";

interface Config {
  clientId: string;
  clientSecret: string;
  authResponse: string;
  refreshMinutes: number;
  showDeclined: boolean;
}

/** Events for one month's 6-week grid. */
interface MonthData {
  events: AgendaEvent[];
  fetchedAt: number;
  failedCalendars: string[];
}

/** The current month is persisted so the popup has something to show instantly. */
interface SavedCache extends MonthData {
  month: number;
}

type Message = { text: string; tone: "error" | "info" } | null;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function readConfig(settings: Settings): Config {
  const raw = settings.getCurrentWidgetConfig();
  return {
    clientId: String(raw.clientId ?? "").trim(),
    clientSecret: String(raw.clientSecret ?? "").trim(),
    authResponse: String(raw.authResponse ?? ""),
    refreshMinutes: clamp(raw.refreshMinutes, 1, 240, 10),
    showDeclined: !!raw.showDeclined,
  };
}

// ---------------------------------------------------------------- state

const widget = Widget.self;
let settings = await Settings.getAsync();
let config = readConfig(settings);
let locale: Locale = resolveLocale(settings.inner.language);
let weekStart = weekStartIndex(settings.inner.startOfWeek);
let tokens = await readJson<StoredTokens>(AUTH_FILE);
const months = new Map<number, MonthData>();
const monthLoads = new Map<number, Promise<void>>();
let viewMonth = startOfMonth(Date.now());
let selectedDay = startOfLocalDay(Date.now());
let message: Message = null;
let busy = false;
let waitingForPaste = isPendingAuthUsable(await readJson<PendingAuth>(PENDING_FILE), Date.now());

const saved = await readJson<SavedCache>(CACHE_FILE);
if (saved && typeof saved.month === "number" && Array.isArray(saved.events)) {
  months.set(saved.month, { events: saved.events, fetchedAt: saved.fetchedAt, failedCalendars: saved.failedCalendars ?? [] });
}

// ---------------------------------------------------------------- auth

async function getAccessToken(force = false): Promise<string> {
  if (!tokens) throw new OAuthError("Not signed in", "not_signed_in");
  if (!force && tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  tokens = await refreshAccessToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokens,
    now: Date.now(),
  });
  await writeJson(AUTH_FILE, tokens);
  return tokens.accessToken;
}

async function startSignIn(): Promise<void> {
  const pending = createPendingAuth(Date.now());
  await writeJson(PENDING_FILE, pending);
  waitingForPaste = true;
  message = null;
  render();
  // Seelen routes window.open for http(s) to the default browser.
  window.open(await buildAuthUrl(config.clientId, pending), "_blank");
}

/**
 * `fromUserEdit` is true when the setting just changed. On startup a stale
 * pasted value is only honoured if it matches the pending sign-in, and never
 * produces an error.
 */
async function consumeAuthResponse(value: string, fromUserEdit: boolean): Promise<void> {
  const report = (text: string) => {
    if (fromUserEdit) message = { text, tone: "error" };
  };
  if (!value.trim()) return;

  const parsed = parseAuthResponse(value);
  const pending = await readJson<PendingAuth>(PENDING_FILE);

  if (parsed.kind === "invalid") return report(locale.t.errInvalidPaste);
  if (parsed.kind === "error") {
    if (fromUserEdit) {
      await removeJson(PENDING_FILE);
      waitingForPaste = false;
    }
    return report(locale.t.errDenied(parsed.error));
  }
  if (!isPendingAuthUsable(pending, Date.now())) return report(locale.t.errSignInExpired);
  if (parsed.state === null && !fromUserEdit) return;
  if (parsed.state !== null && parsed.state !== pending.state) return report(locale.t.errStateMismatch);

  busy = true;
  render();
  try {
    tokens = await exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code: parsed.code,
      pending,
      now: Date.now(),
    });
    await writeJson(AUTH_FILE, tokens);
    await removeJson(PENDING_FILE);
    waitingForPaste = false;
    message = null;
  } catch (e) {
    message = { text: e instanceof Error ? e.message : String(e), tone: "error" };
  } finally {
    busy = false;
  }
  render();
  if (tokens) await loadMonth(viewMonth, true);
}

async function signOut(): Promise<void> {
  const old = tokens;
  tokens = null;
  months.clear();
  message = null;
  await removeJson(AUTH_FILE);
  await removeJson(CACHE_FILE);
  render();
  if (old) await revokeToken(old.refreshToken);
}

// ---------------------------------------------------------------- data

async function fetchMonth(month: number, forceToken: boolean): Promise<MonthData> {
  const grid = monthGrid(month, weekStart);
  const now = Date.now();
  const result = await fetchAgendaEvents({
    accessToken: await getAccessToken(forceToken),
    timeMin: grid[0],
    timeMax: addLocalDays(grid[grid.length - 1], 1),
    showDeclined: config.showDeclined,
  });
  return { ...result, fetchedAt: now };
}

async function doLoadMonth(month: number): Promise<void> {
  busy = true;
  render();
  try {
    let data: MonthData;
    try {
      data = await fetchMonth(month, false);
    } catch (e) {
      // Access token revoked server-side before its expiry: refresh once and retry.
      if (!(e instanceof CalendarApiError && e.status === 401)) throw e;
      data = await fetchMonth(month, true);
    }
    months.set(month, data);
    if (month === startOfMonth(Date.now())) await writeJson(CACHE_FILE, { month, ...data } satisfies SavedCache);
    message = data.failedCalendars.length
      ? { text: locale.t.errPartial(data.failedCalendars.join(", ")), tone: "error" }
      : null;
  } catch (e) {
    if (e instanceof OAuthError && e.code === "invalid_grant") {
      tokens = null;
      await removeJson(AUTH_FILE);
      message = { text: locale.t.errReauth, tone: "error" };
    } else if (e instanceof TypeError) {
      // fetch() rejects with TypeError on network failure.
      message = { text: locale.t.errNetwork, tone: "error" };
    } else {
      message = { text: e instanceof Error ? e.message : String(e), tone: "error" };
    }
  } finally {
    busy = false;
    render();
  }
}

/** Fetches a month unless a fresh copy is cached (or `force`). Concurrent calls share one request. */
function loadMonth(month: number, force: boolean): Promise<void> {
  if (!tokens || !config.clientId || !config.clientSecret) return Promise.resolve();
  const cached = months.get(month);
  if (!force && cached && Date.now() - cached.fetchedAt < config.refreshMinutes * 60_000) return Promise.resolve();
  let load = monthLoads.get(month);
  if (!load) {
    load = doLoadMonth(month).finally(() => monthLoads.delete(month));
    monthLoads.set(month, load);
  }
  return load;
}

// ---------------------------------------------------------------- navigation

function selectDay(day: number): void {
  selectedDay = startOfLocalDay(day);
  const month = startOfMonth(selectedDay);
  const monthChanged = month !== viewMonth;
  viewMonth = month;
  render();
  if (monthChanged) void loadMonth(viewMonth, false);
}

function showMonth(month: number): void {
  const today = startOfLocalDay(Date.now());
  selectDay(startOfMonth(today) === month ? today : month);
}

function goToday(): void {
  selectDay(Date.now());
  void loadMonth(viewMonth, false);
}

// ---------------------------------------------------------------- view

type Child = Node | string | null | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; title?: string; onclick?: () => void } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.title) el.title = props.title;
  if (props.onclick) el.addEventListener("click", props.onclick);
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue;
    el.append(c); // strings become text nodes, never HTML
  }
  return el;
}

// Static, trusted markup only.
const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  today:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7M6 10v9h12v-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  external:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function iconButton(icon: keyof typeof ICONS, title: string, onclick: () => void, spinning = false): HTMLButtonElement {
  const btn = h("button", { class: `ga-icon-btn${spinning ? " is-spinning" : ""}`, title, onclick: () => onclick() });
  btn.innerHTML = ICONS[icon];
  btn.setAttribute("aria-label", title);
  return btn;
}

function colorDot(color: string, className: string): HTMLElement {
  const dot = h("span", { class: className });
  dot.style.setProperty("--event-color", /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#4285f4");
  return dot;
}

/** Opens a URL in the default browser and closes the popup. */
function openExternal(url: string): void {
  window.open(url, "_blank");
  widget.hide();
}

/** Google Calendar's day view for a local date. */
function calendarDayUrl(day: number): string {
  const d = new Date(day);
  return `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** Opens Seelen settings on this widget's page (same route the settings sidebar uses). */
function openOwnSettings(): Promise<unknown> {
  return invoke(SeelenCommand.TriggerWidget, {
    payload: {
      id: "@seelen/settings" as never,
      customArgs: { route: `/widget?${new URLSearchParams({ id: widget.id })}` },
    },
  });
}

function renderMonthHeader(): HTMLElement {
  return h(
    "header",
    { class: "ga-cal-header" },
    h("span", { class: "ga-cal-title" }, formatMonthTitle(viewMonth, locale)),
    h(
      "div",
      { class: "ga-actions" },
      iconButton("prev", locale.t.prevMonth, () => showMonth(addMonths(viewMonth, -1))),
      iconButton("today", locale.t.goToday, () => goToday()),
      iconButton("next", locale.t.nextMonth, () => showMonth(addMonths(viewMonth, 1))),
    ),
  );
}

function renderGrid(now: number): HTMLElement {
  const grid = monthGrid(viewMonth, weekStart);
  const data = months.get(viewMonth);
  const colors = data && tokens ? dayColors(data.events, grid) : new Map<number, string[]>();
  const today = startOfLocalDay(now);
  const viewMonthIndex = new Date(viewMonth).getMonth();

  const cells: HTMLElement[] = weekdayNames(weekStart, locale).map((name) => h("span", { class: "ga-wd" }, name));
  for (const day of grid) {
    const classes = ["ga-cell"];
    if (new Date(day).getMonth() !== viewMonthIndex) classes.push("is-other-month");
    if (day === today) classes.push("is-today");
    if (day === selectedDay) classes.push("is-selected");
    const dots = h("span", { class: "ga-dots" });
    for (const c of colors.get(day) ?? []) dots.append(colorDot(c, "ga-mini-dot"));
    cells.push(
      h("button", { class: classes.join(" "), onclick: () => selectDay(day) }, h("span", {}, String(new Date(day).getDate())), dots),
    );
  }
  return h("div", { class: "ga-grid" }, ...cells);
}

function renderSetup(): HTMLElement {
  return h(
    "div",
    { class: "ga-panel" },
    h("h2", {}, locale.t.setupTitle),
    h("ol", {}, h("li", {}, locale.t.setupStep1), h("li", {}, locale.t.setupStep2)),
    h("button", { class: "ga-btn", onclick: () => void openOwnSettings() }, locale.t.openSettings),
  );
}

function renderSignIn(): HTMLElement {
  return h(
    "div",
    { class: "ga-panel" },
    h("h2", {}, locale.t.signInTitle),
    h("ol", {}, h("li", {}, locale.t.signInStep1), h("li", {}, locale.t.signInStep2), h("li", {}, locale.t.signInStep3)),
    h(
      "div",
      { class: "ga-panel-actions" },
      h("button", { class: "ga-btn ga-btn-primary", onclick: () => void startSignIn() }, locale.t.signInButton),
      h("button", { class: "ga-btn", onclick: () => void openOwnSettings() }, locale.t.openSettings),
    ),
    waitingForPaste && h("p", { class: "ga-muted" }, busy ? locale.t.loading : locale.t.waitingForPaste),
  );
}

function renderDayEvents(now: number): HTMLElement {
  const data = months.get(viewMonth);
  if (!data) return h("p", { class: "ga-empty ga-muted" }, locale.t.loading);

  const items = itemsForDay(data.events, selectedDay, now);
  if (items.length === 0) return h("p", { class: "ga-empty ga-muted" }, locale.t.noEvents);

  const list = h("ul", { class: "ga-items" });
  for (const item of items) {
    const ev = item.event;
    const clickable = isSafeCalendarLink(ev.link);
    const classes = ["ga-item"];
    if (item.ongoing) classes.push("is-ongoing");
    if (item.ended) classes.push("is-ended");
    if (clickable) classes.push("is-clickable");
    list.append(
      h(
        "li",
        { class: classes.join(" "), title: ev.calendarName, onclick: clickable ? () => openExternal(ev.link) : undefined },
        colorDot(ev.color, "ga-dot"),
        h(
          "div",
          { class: "ga-item-main" },
          h("div", { class: "ga-item-title" }, ev.title || locale.t.untitled),
          ev.location && h("div", { class: "ga-item-sub" }, ev.location),
        ),
        h(
          "div",
          { class: "ga-item-time" },
          item.ongoing ? h("span", { class: "ga-badge" }, locale.t.now) : null,
          formatTimeLabel(item.time, locale),
        ),
      ),
    );
  }
  return list;
}

function renderAgenda(now: number): HTMLElement {
  const heading = formatDayHeading(selectedDay, now, locale);
  const signedIn = !!tokens && !!config.clientId && !!config.clientSecret;
  let body: HTMLElement;
  if (!config.clientId || !config.clientSecret) body = renderSetup();
  else if (!tokens) body = renderSignIn();
  else body = renderDayEvents(now);

  return h(
    "section",
    { class: "ga-agenda" },
    h(
      "div",
      { class: "ga-agenda-head" },
      h(
        "div",
        { class: "ga-agenda-title" },
        h("span", {}, heading.date),
        heading.relative && h("span", { class: "ga-tag" }, heading.relative),
      ),
      h(
        "div",
        { class: "ga-actions" },
        signedIn && iconButton("refresh", locale.t.refresh, () => void loadMonth(viewMonth, true), busy),
        iconButton("external", locale.t.openCalendar, () => openExternal(calendarDayUrl(selectedDay))),
      ),
    ),
    h("div", { class: "ga-agenda-body" }, body),
  );
}

function renderFooter(): HTMLElement | null {
  const data = months.get(viewMonth);
  const parts: Child[] = [];
  if (message) parts.push(h("span", { class: `ga-msg is-${message.tone}` }, message.text));
  else if (tokens && data) parts.push(h("span", { class: "ga-muted" }, locale.t.updatedAt(formatTime(data.fetchedAt, locale))));
  if (tokens) parts.push(h("button", { class: "ga-link", onclick: () => void signOut() }, locale.t.signOut));
  return parts.length ? h("footer", { class: "ga-footer" }, ...parts) : null;
}

function render(): void {
  const now = Date.now();
  const root = document.getElementById("root")!;
  root.replaceChildren(renderMonthHeader(), renderGrid(now), renderAgenda(now));
  const footer = renderFooter();
  if (footer) root.append(footer);
}

// ---------------------------------------------------------------- boot

await widget.init({ autoSizeByContent: document.getElementById("root") });
render();

// Each time the toolbar opens the popup, start from today and refresh if stale.
widget.onTrigger(() => goToday());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") widget.hide();
});

await widget.ready();

await Settings.onChange(async (next) => {
  const prev = config;
  settings = next;
  config = readConfig(next);
  locale = resolveLocale(next.inner.language);
  const nextWeekStart = weekStartIndex(next.inner.startOfWeek);
  const gridChanged = nextWeekStart !== weekStart || prev.showDeclined !== config.showDeclined;
  weekStart = nextWeekStart;
  // Errors about credentials or a pasted address are stale once those are changed or cleared.
  if (
    prev.clientId !== config.clientId ||
    prev.clientSecret !== config.clientSecret ||
    (prev.authResponse !== config.authResponse && !config.authResponse.trim())
  ) {
    message = null;
  }
  if (gridChanged) months.clear();
  render();

  if (prev.authResponse !== config.authResponse) {
    await consumeAuthResponse(config.authResponse, true);
    render();
  }
  if (gridChanged || prev.clientId !== config.clientId || prev.clientSecret !== config.clientSecret) {
    void loadMonth(viewMonth, true);
  }
});

// Keeps "Now" badges, ended events and the today marker current while open.
setInterval(() => render(), 60_000);

await consumeAuthResponse(config.authResponse, false);
void loadMonth(viewMonth, false);
