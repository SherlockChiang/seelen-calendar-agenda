# Seelen store listing

Upload, in this order, on <https://seelen.io> (Resources → create a Widget):

| Field | File / text |
| --- | --- |
| Resource file | `dist/uranus92-gcal-agenda-store-v<version>.yml` (from `npm run bundle`) |
| Portrait (1:1) | `docs/store/portrait.png` |
| Banner (21:9) | `docs/store/banner.png` |
| Screenshots (16:9) | `docs/store/screenshot-en.png`, `docs/store/screenshot-zh.png` |

Images are rendered from the mock preview (fake events) by `scripts/store-assets.ps1` while `npm run preview` runs.

## Description (English)

Replaces the calendar that opens from the date in the top bar with one that shows your Google Calendar events.

- Month view with colored dots on days that have events
- Click a day to see its events; multi-day events are split per day, past ones dimmed, current ones marked "Now"
- Uses every calendar you have ticked in Google Calendar; read-only access
- Click an event to open it in Google Calendar

Setup: after installing, right-click the top bar → Modules, tick "Date (Google Calendar)" and untick "Calendar". You need your own Google OAuth client of type "Desktop app"; the full steps are in the README.

Source and setup guide: https://github.com/SherlockChiang/seelen-calendar-agenda

## 简介（中文）

把点击顶栏日期弹出的日历，换成能显示 Google 日历日程的版本。

- 月历中有日程的日子显示颜色点
- 点击某一天查看当天日程；跨天日程按天拆分，已结束的变淡，进行中的会标出
- 读取你在 Google 日历中勾选的所有日历，只读访问
- 点击日程在 Google 日历中打开

设置：安装后在顶栏右键 → 模块，勾选“日期（Google 日历）”，取消勾选“日历”。需要你自己的“桌面应用”类型 Google OAuth 客户端，完整步骤见 README。

源码与设置说明：https://github.com/SherlockChiang/seelen-calendar-agenda
