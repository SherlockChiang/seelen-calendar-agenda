import { dayOffset, type TimeLabel } from "./agenda.ts";

const en = {
  refresh: "Refresh",
  openCalendar: "Open Google Calendar",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  goToday: "Today",
  signOut: "Sign out",
  allDay: "All day",
  now: "Now",
  today: "Today",
  tomorrow: "Tomorrow",
  yesterday: "Yesterday",
  noEvents: "No events",
  updatedAt: (time: string) => `Updated ${time}`,
  loading: "Loading…",
  setupTitle: "Connect Google Calendar",
  setupStep1: "Create a Desktop OAuth client in Google Cloud Console (Calendar API enabled).",
  setupStep2: "Paste its Client ID and Client secret into this widget's settings in Seelen, then Save.",
  openSettings: "Open Seelen settings",
  signInTitle: "Sign in to Google",
  signInButton: "Sign in with Google",
  signInStep1: "Approve access in the browser window that opens.",
  signInStep2: "The browser then shows a page that won't load (127.0.0.1). Copy its full address.",
  signInStep3: "Paste it into “Authorization response” in this widget's settings and Save.",
  waitingForPaste: "Waiting for the pasted address…",
  errSignInExpired: "Sign-in expired or was not started here. Click “Sign in with Google” again.",
  errStateMismatch: "That address belongs to a different sign-in attempt. Start again.",
  errDenied: (e: string) => `Google sign-in was cancelled (${e}).`,
  errInvalidPaste: "The pasted text doesn't contain an authorization code.",
  errReauth: "Google access was revoked or expired. Sign in again.",
  errNetwork: "Can't reach Google. Showing cached events.",
  errPartial: (names: string) => `Couldn't load: ${names}`,
  untitled: "(No title)",
};

type Strings = typeof en;

const zh: Strings = {
  refresh: "刷新",
  openCalendar: "打开 Google 日历",
  prevMonth: "上个月",
  nextMonth: "下个月",
  goToday: "回到今天",
  signOut: "退出登录",
  allDay: "全天",
  now: "进行中",
  today: "今天",
  tomorrow: "明天",
  yesterday: "昨天",
  noEvents: "没有日程",
  updatedAt: (time) => `${time} 更新`,
  loading: "加载中…",
  setupTitle: "连接 Google 日历",
  setupStep1: "在 Google Cloud Console 创建“桌面应用”类型的 OAuth 客户端，并启用 Calendar API。",
  setupStep2: "在 Seelen 设置中把客户端 ID 和客户端密钥填入本小组件的设置项，然后点“保存”。",
  openSettings: "打开 Seelen 设置",
  signInTitle: "登录 Google",
  signInButton: "使用 Google 登录",
  signInStep1: "在弹出的浏览器窗口中同意授权。",
  signInStep2: "随后浏览器会打开一个无法加载的页面（127.0.0.1），复制它的完整地址。",
  signInStep3: "把地址粘贴到本小组件设置中的“授权回调地址”，然后点“保存”。",
  waitingForPaste: "等待粘贴回调地址…",
  errSignInExpired: "登录已过期或不是从这里发起的，请重新点击“使用 Google 登录”。",
  errStateMismatch: "该地址属于另一次登录尝试，请重新登录。",
  errDenied: (e) => `已取消 Google 登录（${e}）。`,
  errInvalidPaste: "粘贴的内容里没有找到授权码。",
  errReauth: "Google 授权已失效，请重新登录。",
  errNetwork: "无法连接 Google，显示的是缓存日程。",
  errPartial: (names) => `以下日历加载失败：${names}`,
  untitled: "（无标题）",
};

export interface Locale {
  tag: string;
  t: Strings;
}

export function resolveLocale(language: string | null | undefined): Locale {
  const tag = language || navigator.language || "en";
  return { tag, t: tag.toLowerCase().startsWith("zh") ? zh : en };
}

export function formatTime(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale.tag, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

export function formatTimeLabel(label: TimeLabel, locale: Locale): string {
  switch (label.kind) {
    case "allDay":
      return locale.t.allDay;
    case "range":
      return label.start === label.end
        ? formatTime(label.start, locale)
        : `${formatTime(label.start, locale)} – ${formatTime(label.end, locale)}`;
    case "startsAt":
      return `${formatTime(label.start, locale)} →`;
    case "endsAt":
      return `→ ${formatTime(label.end, locale)}`;
  }
}

/** "2026年11月" / "November 2026" */
export function formatMonthTitle(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale.tag, { year: "numeric", month: "long" }).format(month);
}

/** Narrow weekday names starting at `weekStart` (0 = Sunday): 一 二 三 … / M T W … */
export function weekdayNames(weekStart: number, locale: Locale): string[] {
  const fmt = new Intl.DateTimeFormat(locale.tag, { weekday: "narrow" });
  // 2026-11-01 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 10, 1 + ((weekStart + i) % 7))));
}

/** Heading for the selected day: "11月3日 周二" plus "今天" / "明天" / "昨天" when it applies. */
export function formatDayHeading(day: number, now: number, locale: Locale): { date: string; relative: string } {
  const date = new Intl.DateTimeFormat(locale.tag, { month: "short", day: "numeric", weekday: "short" }).format(day);
  const offset = dayOffset(day, now);
  const relative = offset === 0 ? locale.t.today : offset === 1 ? locale.t.tomorrow : offset === -1 ? locale.t.yesterday : "";
  return { date, relative };
}
