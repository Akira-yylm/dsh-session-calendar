# Session calendar

[![Socket Badge](https://badge.socket.dev/npm/package/@akira-yylm/session-calendar)](https://socket.dev/npm/package/@akira-yylm/session-calendar)

> An unofficial DeepSeek Harness (DSH) plugin. Not affiliated with DeepSeek. 中文 → [README.md](README.md)

Adds **one `Session calendar` button** just below the **Free session** row in the left sidebar: **transparent with a neutral hairline** while the calendar is closed (only its calendar mark is brand blue), and a **very light blue wash** (15%, plus a 45% hairline) once the calendar is open — the colour means "this calendar is showing". It opens a month calendar beside the sidebar, where a picked day lists its sessions grouped by workspace (the same groups the sidebar uses), and the **first/latest switch lives at the top of that calendar**.

| Switch in the calendar | How a session is filed onto a day |
|---|---|
| **First** | the time the session's conversation **began** |
| **Latest** | the time you last sent a message in it — a session you returned to today shows up today |

Clicking a row opens that session, and the switch remembers your last choice.

## Usage

1. Under **New session** / **Free session** sits **one `Session calendar` button** — transparent with a neutral hairline while closed, a 15% brand-blue wash plus a 45% hairline while open, spanning the row width; it becomes a 36px icon button in the collapsed rail.
2. Clicking it opens the calendar to the right of the sidebar, **vertically centred** in the window (about 360px wide, 38px day cells). Its height is fixed (up to 720px), so switching days scrolls only the list and never shifts the grid under your pointer; on a busy day the list scrolls with each group heading pinned.
3. **Switching rules**: in the card header, right of the month navigation, a small **First / Latest** segmented switch re-groups in place; the choice is remembered, and pressing the sidebar button again dismisses the card.
4. A day with sessions is framed in **the colours of the workspaces involved under the active rule** (solid for one, a gradient for several), with one dot per workspace below; hovering names them and their counts.
5. `‹` / `›` page months (landing on that month's earliest day with sessions); **Today** returns.
6. Sessions are grouped in sidebar workspace order; the group glyph and every row's hairline use that workspace's colour, and each row shows title plus the time the active rule uses. The list header names the rule (by first prompt / by latest).
7. Click a row to open that session in the conversation area; **the calendar stays open**, so you can keep picking from the same day.
8. Dismiss with the active button again, a click outside, `Esc`, or a window resize.

## Workspace colours

The calendar dots, each day's frame, the group glyph, and each session row's hairline share **one colour per workspace**, so the month grid itself says which workspace created sessions on which day.

- One workspace that day: the frame is that solid colour.
- Several workspaces: the frame is a 135° gradient through their colours in workspace order.
- **Today** is marked by an accent-coloured date number and **the picked day** by a tinted fill plus bolder type; neither overrides the data colour.

Eight base colours, in family order:

`#FC757B` `#F97F5F` `#FAA26F` `#FDCD94` `#FEE199` `#B0D6A9` `#65BDBA` `#3C9BC9`

Assignment (N = number of workspaces, taken in registry order, stable across days):

| Case | Rule | Example |
|---|---|---|
| 8 is divisible by N (1, 2, 4, 8) | step evenly through the eight | 4 workspaces → colours **1, 3, 5, 7** |
| otherwise (3, 5, 6, 7, …) | resample the family to the smallest length divisible by N, then take evenly spaced picks including both ends | 3 workspaces → picks **1, 5, 9** of a nine-stop family |

The ninth stop is interpolated between the two ends `#FC757B` and `#3C9BC9` (for three workspaces the middle one is `#FED797`). A directory that is not a registered workspace groups under a neutral grey and always sorts last.

## Install

Requires DSH 0.2.2-rc.5 or a later 0.2.x.

### Install in DSH (recommended)

1. Sidebar → **Plugins** → **Add plugin**.
2. Paste the package name and install:

```sh
@akira-yylm/session-calendar
```

3. The bundle is enabled by default; restart DSH if the page says `restart-required`, then refresh. The **Session calendar** row appears under **Free session**.

An npm install gains a **Versions** section in the plugin page, so upgrades are one **Update** click.

### From GitHub

To bypass npm, or to pin an exact commit, install from the repository instead:

```sh
github:Akira-yylm/dsh-session-calendar#v1.1.0
```

To let Plugin Manager treat the install as an **updatable** Git plugin, replace the tag with the full 40-char commit SHA (`git rev-parse v1.1.0`); a tag or branch also installs, but never follows updates.

> Git installs can be very slow from mainland China; prefer the npm method above.

### From the command line

```sh
dsh plugin --profile <profile> add @akira-yylm/session-calendar
```

### From a local checkout

`git clone`, then **Add plugin** → choose the directory (linked install). Refresh after editing.

## Upgrade

- **npm install**: click **Update** in the plugin page when a new version appears.
- **GitHub install**: no one-click updater; remove the old version and install the new commit.

## Data and privacy

- One same-origin **read-only** Host route: `GET /dsh-session-calendar/created.json`, reading each session's `createdAt` from `sessionPersistence.list()` plus the **head** of its log for the first user message (cached per session for the life of the process). The latest-prompt side needs no Host help: it reuses the page's own `SessionSummary.updatedAt`.
- Reads only that bounded slice (at most 256 leading events), never the whole body; writes no files, makes no external requests, uploads nothing.
- Titles, workspaces, ordering, and archived state come from the page's existing session/workspace data.
- Nothing leaves the machine; no leftovers after removal: no config, cache, or database.

## Limitations

- Days use the **browser's local time zone**.
  - switch **First** = the first user message in the session log (DSH reuses blank sessions, so an empty shell created days earlier that you start today counts as today).
  - switch **Latest** = your most recent message, taken from DSH's own `SessionSummary.updatedAt` (the newer of the session's creation and its last `user/message`).
  - Neither rule counts command or status records: for example the “去AI味” pill runs `/humanizer status` whenever a session is opened, and that must not move a session into today.
- Subagent, blank, and archived sessions are hidden by the same rules the sidebar uses.
- Sessions outside any registered workspace fall back to a folder-name group.
- The grid shows the current month only; paging lands on the earliest day with sessions.
- The card hugs the sidebar's right edge horizontally and centres itself vertically; in very narrow windows it may cover the sidebar (use × to dismiss), and in very short windows the whole card scrolls.
- The row lives inside the New-session row's slot, so it hides whenever DSH hides that row.

## Compatibility

- Tested on **DSH 0.2.2-rc.5 (macOS desktop)**. The manifest declares `engines.dsh: >=0.2.2-rc.5 <0.3.0`; DSH refuses to install or update outside that range.
- Plain Web UI plus one read-only Host route; not OS-specific. Windows / Linux untested.
- Inserts only its own `session-calendar` row; overrides no official row.

## Development

| File | Role |
|---|---|
| `index.js` | Host half: the read-only route |
| `client.js` | Client half: sidebar row + `shell.overlay` calendar card |
| `cordis.patch.yml` | Inserts the `session-calendar` row |
| `locale/zh.json`, `locale/en.json` | Plugin page title and description |
| `icon.svg` | 36×36 transparent icon |

Note: the `id` passed to `window.__ModuleLoader__.load({ id })` in `client.js` must equal the package name exactly, or the Host half loads while nothing appears in the UI.

With a linked local install, client changes appear after a refresh; Host changes need a DSH restart.

## License

[MIT](LICENSE) © 2026 Akira-yylm
