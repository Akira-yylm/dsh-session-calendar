# Session calendar

> An unofficial DeepSeek Harness (DSH) plugin. Not affiliated with DeepSeek. 中文 → [README.md](README.md)

Adds a **Session calendar** row just below the **Free session** row in the left sidebar. Clicking it opens a small month calendar beside the sidebar: pick a day, and every session created that day is listed below the grid, grouped by the workspace it belongs to, in the same order as the sidebar. Clicking a row opens that session.

## Usage

1. Click **Session calendar** under **New session** / **Free session** in the left sidebar.
2. The calendar opens to the right of the sidebar: month grid on top, that day's sessions below.
3. Days with sessions carry a dot; click a day to list them.
4. `‹` / `›` page months (landing on that month's earliest day with sessions); **Today** returns.
5. Sessions are grouped in sidebar workspace order, each row showing title and creation time.
6. Click a row to open that session; the window closes.
7. Dismiss with the row again, a click outside, `Esc`, or a window resize.

## Install

Requires DSH 0.2.2-rc.5 or a later 0.2.x.

### Install in DSH (recommended)

1. Sidebar → **Plugins** → **Add plugin**.
2. Paste this line and install:

```sh
github:Akira-yylm/dsh-session-calendar#v1.0.3
```

3. The bundle is enabled by default; restart DSH if the page says `restart-required`, then refresh. The **Session calendar** row appears under **Free session**.

### From GitHub

To let Plugin Manager treat the install as an **updatable** Git plugin, or to pin an exact commit, replace the tag with the full 40-char commit SHA:

```sh
github:Akira-yylm/dsh-session-calendar#<full 40-char commit SHA>
```

A tag (such as `#v1.0.3`) or a branch name also installs, but is never treated as updatable. Find a release's full SHA with `git rev-parse v1.0.3`.

### From the command line

```sh
dsh plugin --profile <profile> add "github:Akira-yylm/dsh-session-calendar#v1.0.3"
```

### From a local checkout

`git clone`, then **Add plugin** → choose the directory (linked install). Refresh after editing.

## Upgrade

Third-party Git plugins have no one-click updater: remove the old version, install the new commit.

> Once published to npm, the plugin page gains a Versions section with an Update button.

## Data and privacy

- One same-origin **read-only** Host route: `GET /dsh-session-calendar/created.json`, reading each session's `createdAt` from `sessionPersistence.list()`.
- Never opens session log bodies, writes no files, makes no external requests, uploads nothing.
- Titles, workspaces, ordering, and archived state come from the page's existing session/workspace data.
- Nothing leaves the machine; no leftovers after removal: no config, cache, or database.

## Limitations

- Days use the **browser's local time zone**; sessions stay on the day they were **created**.
- Subagent, blank, and archived sessions are hidden by the same rules the sidebar uses.
- Sessions outside any registered workspace fall back to a folder-name group.
- The grid shows the current month only; paging lands on the earliest day with sessions.
- In very narrow windows the card may cover the sidebar; use its × to dismiss.
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
