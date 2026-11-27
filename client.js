/**
 * Client half: the 「会话日历」 row under the sidebar's Free-session button and
 * the small month calendar it opens beside the left column.
 *
 * Placement: the sidebar's New-session row (and the Free-session row the
 * free-deepseek plugin stacks under it) is the `sidebar.session.action` HOC
 * seat. This layer registers with `order: -1`, so it is the outermost layer:
 * it receives the already-decorated row as `children`, renders it unchanged,
 * and appends its own row underneath. The wrapper mirrors the Free-session
 * row's column so the two rows stack exactly like the shell's own buttons, and
 * the row uses the same border and radius as the two rows above it.
 *
 * The window itself is a `shell.overlay` entry: that layer sits above every
 * column and outside their scroll containers, and its own root is click-through,
 * so only the card itself takes pointer events. The card is placed from the
 * trigger button's live bounding rect (our own element, never another
 * plugin's DOM) and closes on outside pointer-down, Escape, or a window resize.
 * Its surface follows the host's own floating-card recipe (`--dsw-specific-menu`
 * + `--dsw-elevation-prominent`), and the calendar grid follows the host date
 * picker's cell geometry and selection tokens.
 *
 * Data: the Client already owns Workspaces (`useWorkspaces`), Session rows and
 * titles (`useSessions`), so this half only fetches creation times from the
 * bundle's own Host route, then joins on `SessionId`. Days are bucketed in the
 * reader's browser time zone. Grouping follows the sidebar's Workspace order,
 * and a Session whose directory is no longer a registered Workspace falls back
 * to its folder-name group.
 */

window.__ModuleLoader__.load({
  id: '@akira-yylm/session-calendar',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Client locale namespace, also the registration `locale` for both seats. */
    const NS = 'sessionCalendar'
    /** Same-origin Host route that reports Session creation times. */
    const CREATED_PATH = '/dsh-session-calendar/created.json'
    /** Preferred card width in CSS pixels; narrow windows shrink it. */
    const CARD_WIDTH = 360
    /** Grid rows are fixed at six weeks so the card height never jumps. */
    const GRID_WEEKS = 6
    /**
     * The eight accent colours chosen for Workspaces, in family order:
     * coral → orange → peach → cream → green → teal → blue.
     */
    const PALETTE = ['#FC757B', '#F97F5F', '#FAA26F', '#FDCD94', '#FEE199', '#B0D6A9', '#65BDBA', '#3C9BC9']

    // ---------------------------------------------------------------------
    // Workspace colours.
    //
    // A Workspace keeps one colour so the dots on the calendar and the rows of
    // the day list agree. Which of the eight it gets depends on how many
    // Workspaces exist, so that N Workspaces are spread as far apart as the
    // family allows:
    //
    // - 8 divides N (1, 2, 4, 8): step through the eight, e.g. four
    //   Workspaces take colours 1, 3, 5, 7.
    // - otherwise the family is resampled at the smallest size that holds a
    //   whole number of picks (three Workspaces need nine stops), and the picks
    //   include both ends, e.g. 1, 5, 9 — the last one is the blue end.
    // ---------------------------------------------------------------------

    /** Parse `#RRGGBB` into `[r, g, b]`; invalid input falls back to black. */
    function toRgb(hex) {
      const value = String(hex).replace('#', '')
      if (value.length !== 6) return [0, 0, 0]
      const red = Number.parseInt(value.slice(0, 2), 16)
      const green = Number.parseInt(value.slice(2, 4), 16)
      const blue = Number.parseInt(value.slice(4, 6), 16)
      if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) return [0, 0, 0]
      return [red, green, blue]
    }

    /** Format `[r, g, b]` as `#RRGGBB`, matching the uppercase palette. */
    function toHex(rgb) {
      return '#' + rgb
        .map((channel) => {
          const clamped = Math.max(0, Math.min(255, Math.round(channel)))
          return clamped.toString(16).padStart(2, '0').toUpperCase()
        })
        .join('')
    }

    /**
     * Sample the family curve at `size` evenly spaced stops. The curve runs
     * through {@link PALETTE}, so `size === PALETTE.length` returns the eight
     * chosen colours unchanged and any other size is the same family resampled.
     */
    function familyStops(size) {
      const last = PALETTE.length - 1
      const stops = []
      for (let index = 0; index < size; index += 1) {
        const position = size <= 1 ? 0 : (index / (size - 1)) * last
        const lower = Math.min(Math.floor(position), last - 1)
        const fraction = position - lower
        const from = toRgb(PALETTE[lower])
        const to = toRgb(PALETTE[lower + 1])
        stops.push(toHex([
          from[0] + (to[0] - from[0]) * fraction,
          from[1] + (to[1] - from[1]) * fraction,
          from[2] + (to[2] - from[2]) * fraction,
        ]))
      }
      return stops
    }

    /** The colours for `count` Workspaces, in Workspace order. */
    function workspacePalette(count) {
      if (count <= 0) return []
      if (count <= PALETTE.length && PALETTE.length % count === 0) {
        const step = PALETTE.length / count
        const picked = []
        for (let index = 0; index < count; index += 1) picked.push(PALETTE[index * step])
        return picked
      }
      let size = PALETTE.length
      while (size % count !== 0) size += 1
      const stops = familyStops(size)
      const picked = []
      for (let index = 0; index < count; index += 1) {
        const position = count === 1 ? 0 : (index * (size - 1)) / (count - 1)
        picked.push(stops[Math.round(position)])
      }
      return picked
    }

    /** Memoised `workspacePalette`, because it runs on every render. */
    const paletteCache = new Map()
    function paletteFor(count) {
      if (!paletteCache.has(count)) paletteCache.set(count, workspacePalette(count))
      return paletteCache.get(count)
    }

    /**
     * The paint for one day's frame: the single colour when only one Workspace
     * created sessions that day, otherwise a gradient stopping at each of them.
     */
    /**
     * The picked day is filled with the same colours its frame uses — a solid
     * wash for one Workspace, an angular run around the cell's centre through
     * all of them when the day touches several — at this alpha.
     */
    function dayFill(colors) {
      if (colors.length === 0) return undefined
      const wash = (color) => 'color-mix(in srgb, ' + color + ' 50%, transparent)'
      if (colors.length === 1) return wash(colors[0])
      const step = 360 / colors.length
      const stops = colors.map((color, index) => wash(color) + ' ' + Math.round(index * step) + 'deg')
      stops.push(wash(colors[0]) + ' 360deg')
      return 'conic-gradient(from 0deg at 50% 50%, ' + stops.join(', ') + ')'
    }

    function dayRing(colors) {
      if (colors.length === 0) return undefined
      if (colors.length === 1) return colors[0]
      // A thin frame sits at one radius, so a radial run would show a single
      // colour there. Centring an angular gradient on the same point gives each
      // Workspace its own wedge around the cell instead.
      const step = 360 / colors.length
      const stops = colors.map((color, index) => color + ' ' + Math.round(index * step) + 'deg')
      stops.push(colors[0] + ' 360deg')
      return 'conic-gradient(from 0deg at 50% 50%, ' + stops.join(', ') + ')'
    }

    /** Distinct Workspace colour indexes a day needs dots for, in one row. */
    const MAX_DAY_DOTS = 8
    function dayColorIndexes(groups) {
      const indexes = []
      for (const group of groups) {
        if (!indexes.includes(group.colorIndex)) indexes.push(group.colorIndex)
      }
      indexes.sort((left, right) => {
        if (left < 0) return 1
        if (right < 0) return -1
        return left - right
      })
      return indexes.slice(0, MAX_DAY_DOTS)
    }

    // ---------------------------------------------------------------------
    // Copy. Chinese is also the runtime fallback when a seat omits `t`.
    // ---------------------------------------------------------------------

    const zh = {
      entry: '会话日历',
      panel: '会话日历',
      open: '打开会话日历',
      'mode.first': '首次',
      'mode.last': '最近',
      'mode.switch': '按第一次对话时间 / 按最近一次对话时间',
      close: '关闭会话日历',
      today: '今天',
      prevMonth: '上个月',
      nextMonth: '下个月',
      loading: '正在读取会话…',
      errorTitle: '读不到会话创建时间',
      errorBody: '会话日历需要宿主返回创建时间的接口。刷新页面后可以重试。',
      retry: '重试',
      untitled: '未命名会话',
      unknownWorkspace: '未归属工作区',
      emptyDay: '这一天没有创建会话',
      monthLabel: '{year}年{month}月',
      dayLabel: '{month}月{day}日 周{weekday}',
      dayWithCount: '{month}月{day}日，创建了 {count} 个会话',
      dayCount: '共 {count} 个会话',
      'weekday.0': '日',
      'weekday.1': '一',
      'weekday.2': '二',
      'weekday.3': '三',
      'weekday.4': '四',
      'weekday.5': '五',
      'weekday.6': '六',
      'month.0': '1',
      'month.1': '2',
      'month.2': '3',
      'month.3': '4',
      'month.4': '5',
      'month.5': '6',
      'month.6': '7',
      'month.7': '8',
      'month.8': '9',
      'month.9': '10',
      'month.10': '11',
      'month.11': '12',
    }

    const en = {
      entry: 'Session calendar',
      panel: 'Session calendar',
      open: 'Open the session calendar',
      'mode.first': 'First',
      'mode.last': 'Latest',
      'mode.switch': 'Group by first prompt or by latest conversation',
      close: 'Close the session calendar',
      today: 'Today',
      prevMonth: 'Previous month',
      nextMonth: 'Next month',
      loading: 'Reading sessions…',
      errorTitle: 'Session creation times are unavailable',
      errorBody: 'The calendar needs its host route that reports creation times. Reload the page and retry.',
      retry: 'Retry',
      untitled: 'Untitled session',
      unknownWorkspace: 'No workspace',
      emptyDay: 'No sessions were created on this day',
      monthLabel: '{monthName} {year}',
      dayLabel: '{weekday}, {monthName} {day}',
      dayWithCount: '{count} sessions were created on {monthName} {day}',
      dayCount: '{count} sessions',
      'weekday.0': 'Sun',
      'weekday.1': 'Mon',
      'weekday.2': 'Tue',
      'weekday.3': 'Wed',
      'weekday.4': 'Thu',
      'weekday.5': 'Fri',
      'weekday.6': 'Sat',
      'month.0': 'January',
      'month.1': 'February',
      'month.2': 'March',
      'month.3': 'April',
      'month.4': 'May',
      'month.5': 'June',
      'month.6': 'July',
      'month.7': 'August',
      'month.8': 'September',
      'month.9': 'October',
      'month.10': 'November',
      'month.11': 'December',
    }

    /** Translate with a fallback, so a missing seat `t` still renders copy. */
    function copyOf(t) {
      if (typeof t === 'function') return t
      return (key, params) => format(zh[key] === undefined ? key : zh[key], params)
    }

    /** Fill `{name}` placeholders; the Client locale uses the same syntax. */
    function format(template, params) {
      if (params === undefined) return template
      return String(template).replace(/\{(\w+)\}/g, (match, name) => {
        const value = params[name]
        return value === undefined ? match : String(value)
      })
    }

    // ---------------------------------------------------------------------
    // Shared open state between the sidebar row and the overlay entry.
    // ---------------------------------------------------------------------

    /**
     * Which end of a Session's span the sheet groups by. It outlives the sheet,
     * so reopening it keeps the reader's last choice; the switch lives inside
     * the card now, not on the sidebar row.
     */
    let lastMode = 'first'


    let shared = { open: false, anchor: null, trigger: null }
    const listeners = new Set()

    function readShared() {
      return shared
    }

    function publish(next) {
      shared = next
      for (const listener of listeners) listener()
    }

    function openWith(anchor, trigger) {
      publish({ open: true, anchor, trigger })
    }

    function closeShared() {
      if (shared.open) publish({ open: false, anchor: null, trigger: null })
    }

    function useShared() {
      const [value, setValue] = React.useState(readShared)
      React.useEffect(() => {
        const listener = () => { setValue(readShared()) }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }, [])
      return value
    }

    // ---------------------------------------------------------------------
    // Glyphs: stroke `currentColor`, sized by the seat that draws them.
    // ---------------------------------------------------------------------

    function glyphProps(size) {
      return {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      }
    }

    function CalendarGlyph({ size = 18 }) {
      return h(
        'svg',
        glyphProps(size),
        h('rect', {
          x: 3.4,
          y: 5.2,
          width: 17.2,
          height: 15.4,
          rx: 3.2,
          stroke: 'currentColor',
          strokeWidth: 1.6,
        }),
        h('path', {
          d: 'M3.9 9.6h16.2',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M8.4 3.4v2.9M15.6 3.4v2.9',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
        h('rect', { x: 10.1, y: 12.6, width: 3.9, height: 3.9, rx: 1.2, fill: 'currentColor' }),
        h('circle', { cx: 7.5, cy: 14.55, r: 0.95, fill: 'currentColor', opacity: 0.45 }),
        h('circle', { cx: 16.5, cy: 14.55, r: 0.95, fill: 'currentColor', opacity: 0.45 }),
      )
    }

    function ChevronGlyph({ size = 16, direction = 'left' }) {
      return h(
        'svg',
        glyphProps(size),
        h('path', {
          d: direction === 'left' ? 'M14.2 6.4 8.6 12l5.6 5.6' : 'M9.8 6.4 15.4 12l-5.6 5.6',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function CloseGlyph({ size = 14 }) {
      return h(
        'svg',
        glyphProps(size),
        h('path', {
          d: 'M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
      )
    }

    function FolderGlyph({ size = 12 }) {
      return h(
        'svg',
        glyphProps(size),
        h('path', {
          d: 'M3.6 6.6a1.8 1.8 0 0 1 1.8-1.8h3.3l1.9 2.2h7.9a1.8 1.8 0 0 1 1.8 1.8v8.1a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V6.6Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
      )
    }

    // ---------------------------------------------------------------------
    // Date helpers. Every bucket is a browser-local calendar day.
    // ---------------------------------------------------------------------

    function pad2(value) {
      return value < 10 ? '0' + String(value) : String(value)
    }

    function dayKeyOf(date) {
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
    }

    function monthStartOf(date) {
      return new Date(date.getFullYear(), date.getMonth(), 1)
    }

    function shiftMonth(date, delta) {
      return new Date(date.getFullYear(), date.getMonth() + delta, 1)
    }

    function sameMonth(left, right) {
      return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
    }

    /**
     * Six fixed weeks of `month`, starting on Sunday. Leading and trailing
     * slots are `null`, exactly as the host date picker leaves them blank, so a
     * neighbouring month is never clickable under this month's header.
     */
    function buildGrid(month) {
      const first = monthStartOf(month)
      const offset = first.getDay()
      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
      const cells = []
      for (let index = 0; index < GRID_WEEKS * 7; index += 1) {
        const day = index - offset + 1
        cells.push(day < 1 || day > daysInMonth
          ? null
          : new Date(month.getFullYear(), month.getMonth(), day))
      }
      return cells
    }

    function basenameOf(path) {
      const trimmed = String(path).replace(/[\\/]+$/, '')
      const parts = trimmed.split(/[\\/]/)
      return parts[parts.length - 1] || trimmed
    }

    /** The earliest day of `month` that has sessions, as a day key; else null. */
    function firstDayWithSessions(month, dayMap) {
      const prefix = month.getFullYear() + '-' + pad2(month.getMonth() + 1) + '-'
      let earliest = null
      for (const key of dayMap.keys()) {
        if (!key.startsWith(prefix)) continue
        if (earliest === null || key < earliest) earliest = key
      }
      return earliest
    }

    function clockOf(time) {
      const date = new Date(time)
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
    }

    // ---------------------------------------------------------------------
    // Data: creation times from the Host, titles and workspaces from the page.
    // ---------------------------------------------------------------------

    /** Last accepted Host payload, so reopening paints instantly. */
    let payloadCache = null

    /** One parsed time row, or null when the row is unusable. */
    function readRow(row) {
      if (row === null || typeof row !== 'object') return null
      if (typeof row.id !== 'string' || row.id === '') return null
      if (!Number.isFinite(row.startedAt) && !Number.isFinite(row.createdAt)) return null
      return row
    }

    /**
     * The time this Session lands on under `mode`:
     * - `first`: when its conversation began;
     * - `last`: when it was last talked to.
     *
     * DSH already tracks the last human prompt: `SessionSummary.updatedAt` is
     * the newer of the Session's creation and that prompt's time, and only a
     * `user/message` ever advances it — opening a Session, or a command the UI
     * runs while opening it, does not. Everything falls back to the Session
     * object's creation time.
     */
    function anchorOf(row, mode, info) {
      if (mode === 'last') {
        if (info !== undefined && info !== null && Number.isFinite(info.updatedAt)) return info.updatedAt
        if (Number.isFinite(row.lastConversationAt)) return row.lastConversationAt
      }
      return Number.isFinite(row.startedAt) ? row.startedAt : row.createdAt
    }

    /** Fetch the Host's creation-time rows; refreshes on open and on retry. */
    function useCreated() {
      const [state, setState] = React.useState(() => payloadCache === null
        ? { status: 'loading', error: '', rows: [] }
        : { status: 'ready', error: '', rows: payloadCache })
      const [attempt, setAttempt] = React.useState(0)
      React.useEffect(() => {
        let cancelled = false
        if (payloadCache === null) setState((previous) => ({ ...previous, status: 'loading', error: '' }))
        fetch(CREATED_PATH, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
          .then((body) => {
            if (cancelled) return
            if (body !== null && typeof body === 'object' && typeof body.error === 'string' && body.error !== '') {
              throw new Error(body.error)
            }
            const rows = (Array.isArray(body?.sessions) ? body.sessions : []).map(readRow).filter((row) => row !== null)
            payloadCache = rows
            setState({ status: 'ready', error: '', rows })
          })
          .catch((error) => {
            if (cancelled) return
            const message = error instanceof Error ? error.message : String(error)
            setState((previous) => {
              // A failed background refresh keeps the rows already on screen.
              if (previous.rows.length > 0) {
                console.warn('session-calendar: refresh failed:', message)
                return previous
              }
              return { status: 'error', error: message, rows: [] }
            })
          })
        return () => { cancelled = true }
      }, [attempt])
      return { ...state, retry: () => { setAttempt((value) => value + 1) } }
    }

    /** An always-empty snapshot source, so hook order survives a missing seat prop. */
    function useNothing() {
      return undefined
    }

    /**
     * Bucket creation rows into calendar days, each day grouped by Workspace in
     * the sidebar's own order. Returns `Map<'YYYY-MM-DD', { count, groups }>`.
     */
    function indexDays(rows, sessionList, workspaceSnapshot, t, mode) {
      const sessions = (sessionList !== undefined && sessionList !== null && sessionList.byId) || {}
      const workspaces = (workspaceSnapshot !== undefined
        && workspaceSnapshot !== null
        && Array.isArray(workspaceSnapshot.items))
        ? workspaceSnapshot.items
        : []
      // Archived Sessions are hidden from every Workspace grouping surface and
      // cannot be opened, so the calendar leaves them out exactly as the sidebar does.
      const archived = new Set(
        (workspaceSnapshot !== undefined
          && workspaceSnapshot !== null
          && Array.isArray(workspaceSnapshot.archivedSessionIds))
          ? workspaceSnapshot.archivedSessionIds
          : [],
      )
      const byPath = new Map()
      const orderOf = new Map()
      for (let index = 0; index < workspaces.length; index += 1) {
        const workspace = workspaces[index]
        if (workspace === null || typeof workspace !== 'object') continue
        byPath.set(workspace.path, workspace)
        orderOf.set(workspace.workspaceId, index)
      }
      const days = new Map()
      for (const row of rows) {
        const info = sessions[row.id]
        // The sidebar hides subagent Sessions and never-used blanks; so does this.
        if (info !== undefined && info !== null) {
          if (info.origin === 'subagent') continue
          if (info.blank === true) continue
        }
        if (archived.has(row.id)) continue
        const cwd = (typeof row.cwd === 'string' && row.cwd !== '')
          ? row.cwd
          : (info !== undefined && info !== null && typeof info.cwd === 'string' ? info.cwd : '')
        const workspace = cwd === '' ? undefined : byPath.get(cwd)
        const groupKey = workspace !== undefined
          ? String(workspace.workspaceId)
          : cwd === '' ? '' : 'path:' + cwd
        const groupTitle = workspace !== undefined
          ? workspace.title
          : cwd === '' ? t('unknownWorkspace') : basenameOf(cwd)
        const groupOrder = workspace !== undefined
          ? (orderOf.get(workspace.workspaceId) === undefined ? 0 : orderOf.get(workspace.workspaceId))
          : workspaces.length + 1
        // The colour follows the Workspace's place in the registry, so it is
        // the same on every day; a directory that is not a Workspace has none.
        const colorIndex = workspace !== undefined
          ? (orderOf.get(workspace.workspaceId) === undefined ? -1 : orderOf.get(workspace.workspaceId))
          : -1
        const when = anchorOf(row, mode, info)
        const day = dayKeyOf(new Date(when))
        let bucket = days.get(day)
        if (bucket === undefined) {
          bucket = { count: 0, groups: new Map() }
          days.set(day, bucket)
        }
        let group = bucket.groups.get(groupKey)
        if (group === undefined) {
          group = { key: groupKey, title: groupTitle, order: groupOrder, colorIndex, items: [] }
          bucket.groups.set(groupKey, group)
        }
        const live = info !== undefined && info !== null && typeof info.title === 'string' ? info.title.trim() : ''
        const stored = typeof row.title === 'string' ? row.title.trim() : ''
        const fallback = info !== undefined && info !== null && typeof info.displayTitle === 'string'
          ? info.displayTitle.trim()
          : ''
        group.items.push({
          id: row.id,
          title: live !== '' ? live : stored !== '' ? stored : fallback !== '' ? fallback : t('untitled'),
          time: when,
        })
        bucket.count += 1
      }
      for (const bucket of days.values()) {
        bucket.list = []
        for (const group of bucket.groups.values()) {
          group.items.sort((left, right) => left.time - right.time)
          bucket.list.push(group)
        }
        bucket.list.sort((left, right) => (left.order - right.order) || left.title.localeCompare(right.title))
        bucket.groups = undefined
      }
      return days
    }

    // ---------------------------------------------------------------------
    // Sidebar row: the outermost `sidebar.session.action` layer.
    // ---------------------------------------------------------------------

    function CalendarAction(props) {
      const { wide, children } = props
      const t = copyOf(props.t)
      const isWide = wide !== false
      const sharedState = useShared()
      const buttonRef = React.useRef(null)

      const toggle = () => {
        if (sharedState.open) {
          closeShared()
          return
        }
        const element = buttonRef.current
        const rect = element === null || element === undefined
          ? { right: isWide ? 268 : 56 }
          : element.getBoundingClientRect()
        // Only the horizontal anchor is needed: the card centres itself
        // vertically in the frame.
        openWith({ right: rect.right }, element)
      }

      return h(
        'div',
        { className: isWide ? 'sc-stack' : 'sc-stack sc-stackRail' },
        children,
        h(
          'button',
          {
            ref: buttonRef,
            type: 'button',
            className: isWide ? 'sc-launch' : 'sc-launch sc-launchRail',
            'aria-label': t('open'),
            'aria-expanded': sharedState.open ? 'true' : 'false',
            'aria-haspopup': 'dialog',
            'aria-controls': 'session-calendar-card',
            title: isWide ? undefined : t('entry'),
            onClick: toggle,
          },
          h(CalendarGlyph, { size: isWide ? 14 : 18 }),
          isWide ? h('span', { className: 'sc-launchLabel' }, t('entry')) : null,
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Overlay entry: the month calendar window.
    // ---------------------------------------------------------------------

    function CalendarOverlay(props) {
      const sharedState = useShared()
      if (!sharedState.open) return null
      return h(CalendarPanel, {
        t: copyOf(props.t),
        anchor: sharedState.anchor,
        openSession: props.openSession,
        useSessions: typeof props.useSessions === 'function' ? props.useSessions : useNothing,
        useWorkspaces: typeof props.useWorkspaces === 'function' ? props.useWorkspaces : useNothing,
      })
    }

    function CalendarPanel({ t, anchor, openSession, useSessions, useWorkspaces }) {
      const sessionList = useSessions((snapshot) => snapshot)
      const workspaceSnapshot = useWorkspaces((snapshot) => snapshot)
      const created = useCreated()
      const cardRef = React.useRef(null)
      // Captured before the shared sheet clears its trigger on close.
      const triggerRef = React.useRef(shared.trigger)
      const todayKey = dayKeyOf(new Date())
      const [month, setMonth] = React.useState(() => monthStartOf(new Date()))
      const [selected, setSelected] = React.useState(() => todayKey)
      const [mode, setMode] = React.useState(lastMode)
      const changeMode = (next) => {
        lastMode = next
        setMode(next)
      }

      const days = React.useMemo(
        () => indexDays(created.rows, sessionList, workspaceSnapshot, t, mode),
        [created.rows, sessionList, workspaceSnapshot, t, mode],
      )
      const workspaceCount = (workspaceSnapshot !== undefined
        && workspaceSnapshot !== null
        && Array.isArray(workspaceSnapshot.items))
        ? workspaceSnapshot.items.length
        : 0
      const palette = React.useMemo(() => paletteFor(workspaceCount), [workspaceCount])
      /** One Workspace's colour, or the quiet tertiary tone for an orphan group. */
      const colorOf = (colorIndex) => (colorIndex >= 0 && palette[colorIndex] !== undefined
        ? palette[colorIndex]
        : 'var(--dsw-alias-label-tertiary)')

      const geometry = React.useMemo(() => {
        const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth
        const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
        const width = Math.max(260, Math.min(CARD_WIDTH, viewportWidth - 24))
        // Horizontally the card hugs the sidebar's right edge; vertically the
        // stylesheet centres it in the frame with auto margins, so it never
        // hands off the bottom of a short window.
        const wantedLeft = anchor === null || anchor === undefined ? 268 : anchor.right + 10
        const left = Math.max(12, Math.min(wantedLeft, viewportWidth - width - 12))
        // The height is fixed: switching to a day with more or fewer sessions
        // must not resize the card, or the grid would slide under the pointer.
        const height = Math.max(260, Math.min(720, viewportHeight - 24))
        return { left, width, height }
      }, [anchor])

      React.useEffect(() => {
        const card = cardRef.current
        if (card !== null && card !== undefined && typeof card.focus === 'function') {
          card.focus({ preventScroll: true })
        }
        // Closing returns focus to the sidebar row.
        return () => {
          const trigger = triggerRef.current
          if (trigger === null || trigger === undefined || trigger.isConnected !== true) return
          try {
            trigger.focus({ preventScroll: true })
          } catch {
            // Focus restore is best-effort.
          }
        }
      }, [])

      /**
       * Header hover, driven by the pointer's own position.
       *
       * A quick pass over these controls could end with a `:hover`
       * recalculation one frame behind, so the highlight never showed. Asking
       * the document what is really under the pointer on every move is
       * idempotent: whichever control the pointer is over carries the class,
       * and a missed enter/leave cannot leave it stuck.
       */
      React.useEffect(() => {
        const card = cardRef.current
        if (card === null || card === undefined) return
        const selector = '.sc-navBtn, .sc-today, .sc-seg'
        let current = null
        const clear = () => {
          if (current === null) return
          current.classList.remove('sc-hot')
          current = null
        }
        const onMove = (event) => {
          const top = document.elementFromPoint(event.clientX, event.clientY)
          const hit = top !== null && typeof top.closest === 'function' ? top.closest(selector) : null
          const next = hit !== null && card.contains(hit) ? hit : null
          if (next === current) return
          clear()
          if (next !== null) {
            next.classList.add('sc-hot')
            current = next
          }
        }
        document.addEventListener('pointermove', onMove, true)
        return () => {
          document.removeEventListener('pointermove', onMove, true)
          clear()
        }
      }, [])

      React.useEffect(() => {
        const onPointerDown = (event) => {
          const card = cardRef.current
          const target = event.target
          if (card !== null && card !== undefined && target instanceof Node && card.contains(target)) return
          const trigger = shared.trigger
          if (trigger !== null && trigger !== undefined && target instanceof Node && trigger.contains(target)) return
          closeShared()
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          // Focus starts on the card, so a focused Escape belongs to it. When
          // focus wandered outside, the page's own Escape handling stays intact.
          const card = cardRef.current
          if (card !== null && card !== undefined && event.target instanceof Node && card.contains(event.target)) {
            event.stopPropagation()
          }
          closeShared()
        }
        const onResize = () => { closeShared() }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', onResize)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', onResize)
        }
      }, [])

      /**
       * Arrow keys walk the selection: left/right by a day, up/down by a week.
       * When the new date falls outside the shown month the month follows, so
       * the keyboard never gets stuck at a month boundary. Keys are only taken
       * while focus sits inside the card, so the conversation's own editor keeps
       * its arrow keys.
       */
      React.useEffect(() => {
        const onArrow = (event) => {
          if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
          const card = cardRef.current
          if (card === null || card === undefined) return
          const active = document.activeElement
          const inCard = active !== null && (active === card || card.contains(active))
          if (!inCard) return
          if (active instanceof HTMLElement
            && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
          const step = event.key === 'ArrowLeft' ? -1
            : event.key === 'ArrowRight' ? 1
              : event.key === 'ArrowUp' ? -7
                : event.key === 'ArrowDown' ? 7
                  : 0
          if (step === 0) return
          event.preventDefault()
          const parts = selected.split('-')
          const next = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + step)
          setSelected(dayKeyOf(next))
          if (!sameMonth(month, next)) setMonth(monthStartOf(next))
        }
        document.addEventListener('keydown', onArrow)
        return () => { document.removeEventListener('keydown', onArrow) }
      }, [selected, month])

      const cells = React.useMemo(() => buildGrid(month), [month])
      const bucket = days.get(selected)
      const groups = bucket === undefined ? [] : bucket.list
      const total = bucket === undefined ? 0 : bucket.count
      const selectedDate = new Date(selected + 'T00:00:00')
      const goToday = () => {
        const now = new Date()
        setMonth(monthStartOf(now))
        setSelected(dayKeyOf(now))
      }
      // A month step lands on that month's first day with sessions, so paging
      // never leaves the list pointing at a day outside the rendered grid.
      const goMonth = (delta) => {
        const next = shiftMonth(month, delta)
        setMonth(next)
        setSelected(firstDayWithSessions(next, days) || dayKeyOf(next))
      }
      // Opening a session leaves the calendar where it is: the window is a
      // browsing surface, so the reader can keep picking sessions from it.
      // Dismissing stays on the explicit paths (the row again, a click
      // outside, Escape, or a window resize).
      const openFromList = (sessionId) => {
        if (typeof openSession === 'function') openSession(sessionId)
      }

      const monthLabel = t('monthLabel', {
        year: month.getFullYear(),
        month: month.getMonth() + 1,
        monthName: t('month.' + month.getMonth()),
      })
      const dayLabel = t('dayLabel', {
        month: selectedDate.getMonth() + 1,
        day: selectedDate.getDate(),
        monthName: t('month.' + selectedDate.getMonth()),
        weekday: t('weekday.' + selectedDate.getDay()),
      })

      return h(
        'div',
        {
          ref: cardRef,
          id: 'session-calendar-card',
          className: 'sc-card',
          role: 'dialog',
          'data-mode': mode,
          'aria-label': t('panel') + ' · ' + t('mode.' + mode),
          tabIndex: -1,
          style: {
            left: geometry.left + 'px',
            width: geometry.width + 'px',
            height: geometry.height + 'px',
          },
        },
        h('div', { className: 'sc-title' }, monthLabel),
        h(
          'header',
          { className: 'sc-head' },
          h(
            'button',
            {
              type: 'button',
              className: 'sc-navBtn',
              'aria-label': t('prevMonth'),
              title: t('prevMonth'),
              onClick: () => { goMonth(-1) },
            },
            h(ChevronGlyph, { direction: 'left' }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sc-navBtn',
              'aria-label': t('nextMonth'),
              title: t('nextMonth'),
              onClick: () => { goMonth(1) },
            },
            h(ChevronGlyph, { direction: 'right' }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sc-today',
              onClick: goToday,
            },
            t('today'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sc-navBtn',
              'aria-label': t('close'),
              title: t('close'),
              onClick: closeShared,
            },
            h(CloseGlyph),
          ),
        ),
        h(
          'div',
          { className: 'sc-modes', role: 'group', 'aria-label': t('mode.switch') },
          ['first', 'last'].map((value) => h(
            'button',
            {
              key: value,
              type: 'button',
              className: 'sc-seg',
              'aria-pressed': mode === value ? 'true' : 'false',
              onClick: () => { changeMode(value) },
            },
            t('mode.' + value),
          )),
        ),
        h(
          'div',
          { className: 'sc-weekRow' },
          [0, 1, 2, 3, 4, 5, 6].map((index) => h('span', { key: index, className: 'sc-weekday' }, t('weekday.' + index))),
        ),
        h(
          'div',
          { className: 'sc-grid' },
          cells.map((date, index) => {
            if (date === null) return h('span', { key: 'blank-' + index, className: 'sc-cell sc-cellBlank' })
            const key = dayKeyOf(date)
            const entry = days.get(key)
            const count = entry === undefined ? 0 : entry.count
            const dotIndexes = entry === undefined ? [] : dayColorIndexes(entry.list)
            const dayColors = dotIndexes.map((index) => colorOf(index))
            const ring = dayRing(dayColors)
            const fill = key === selected ? dayFill(dayColors) : undefined
            const style = {}
            if (ring !== undefined) style['--sc-ring'] = ring
            if (fill !== undefined) style.background = fill
            const classes = ['sc-cell']
            if (count > 0) classes.push('sc-cellFilled')
            // Today and the picked day are independent marks, so a picked
            // today keeps both.
            if (key === todayKey) classes.push('sc-cellToday')
            if (key === selected) classes.push('sc-cellSelected')
            return h(
              'button',
              {
                key,
                type: 'button',
                className: classes.join(' '),
                'aria-pressed': key === selected ? 'true' : 'false',
                'aria-label': count > 0
                  ? t('dayWithCount', {
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    count,
                  })
                  : undefined,
                // The hover text names the Workspaces the coloured dots stand
                // for, so the colour is readable before the day is opened.
                title: entry === undefined
                  ? undefined
                  : entry.list.map((group) => group.title + ' · ' + group.items.length).join('\n'),
                style: Object.keys(style).length === 0 ? undefined : style,
                onClick: () => { setSelected(key) },
              },
              h('span', { className: 'sc-dayNum' }, String(date.getDate())),
              dotIndexes.length > 0
                ? h(
                  'span',
                  { className: 'sc-dots' },
                  dotIndexes.map((index) => h('span', {
                    key: index,
                    className: 'sc-dot',
                    style: { '--sc-dot': colorOf(index) },
                  })),
                )
                : null,
            )
          }),
        ),
        h('div', { className: 'sc-divider' }),
        created.status === 'error'
          ? h(
            'div',
            { className: 'sc-note', role: 'alert' },
            h('strong', null, t('errorTitle')),
            h('span', null, t('errorBody')),
            h('div', null, h('button', { type: 'button', className: 'sc-retry', onClick: created.retry }, t('retry'))),
          )
          : created.status !== 'ready'
            ? h('div', { className: 'sc-note', role: 'status' }, h('span', null, t('loading')))
            : h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'sc-dayHead' },
                h('span', { className: 'sc-dayLabel' }, dayLabel),
                total > 0 ? h('span', { className: 'sc-dayCount' }, t('dayCount', { count: total })) : null,
              ),
              h(
                'div',
                { className: 'sc-list' },
                groups.length === 0
                  ? h('div', { className: 'sc-note' }, h('span', null, t('emptyDay')))
                  : groups.map((group) => h(
                    'section',
                    {
                      key: group.key === '' ? '__none__' : group.key,
                      // The Workspace's own colour drives the group glyph and
                      // the hairline around each of its rows, so the day list
                      // and the calendar dots speak one colour language.
                      className: 'sc-group',
                      style: { '--sc-accent': colorOf(group.colorIndex) },
                    },
                    h(
                      'div',
                      { className: 'sc-groupHead' },
                      h(FolderGlyph, { size: 13 }),
                      h('span', { className: 'sc-groupTitle', title: group.title }, group.title),
                      h('span', { className: 'sc-groupCount' }, String(group.items.length)),
                    ),
                    group.items.map((item) => h(
                      'button',
                      {
                        key: item.id,
                        type: 'button',
                        className: 'sc-row',
                        title: item.title,
                        onClick: () => { openFromList(item.id) },
                      },
                      h('span', { className: 'sc-rowTitle' }, item.title),
                      h('span', { className: 'sc-rowTime' }, clockOf(item.time)),
                    )),
                  )),
              ),
            ),
      )
    }

    // ---------------------------------------------------------------------
    // Styles. The row deliberately does NOT copy the two filled conversation
    // buttons above it: it is a browsing tool, so it stays outlined and takes
    // the calendar's accent instead of a raised fill. The card and the grid
    // copy the host's floating-card and date-picker recipes, so both themes,
    // the elevation hairline, and the backdrop material come from the page
    // instead of from literals.
    // ---------------------------------------------------------------------

    const styles = `
      /* Both seats name the same accent, so the row and the card it opens
         share one colour. */
      .sc-stack,
      .sc-card {
        /* The brand blue from DSH's own mark, at the owner's explicit request
           for a brighter accent; it is one hue in both themes. */
        --sc-calendar-accent: #4D6BFE;
      }
      .sc-stack {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .sc-stackRail {
        flex: none;
        width: 36px;
        gap: 4px;
      }
      /* Unlike the two filled conversation buttons above it, this row is a
         tool: outlined, unfilled, and accented with the calendar's own colour,
         so its different purpose reads before its label does. */
      /* Closed, the entry keeps the hairline outline of a button but stays
         unfilled; open, it takes a light wash of the brand blue, so the colour
         means "this calendar is showing" rather than decorating the row. */
      .sc-launch {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
        height: 38px;
        padding: 8px 12px;
        margin: 0;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
        border-radius: var(--dsw-radius-md, 10px);
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        line-height: 22px;
        white-space: nowrap;
        cursor: pointer;
        overflow: hidden;
      }
      .sc-launch svg {
        flex: none;
        color: var(--sc-calendar-accent);
      }
      .sc-launch[aria-expanded='true'] {
        border-color: color-mix(in srgb, var(--sc-calendar-accent) 45%, transparent);
        background: color-mix(in srgb, var(--sc-calendar-accent) 15%, transparent);
      }
      .sc-launch:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--sc-calendar-accent));
        outline-offset: 1px;
      }
      @media (hover: hover) {
        .sc-launch:not([aria-expanded='true']):hover,
        .sc-launchRail:not([aria-expanded='true']):hover {
          background: var(--dsw-alias-interactive-bg-hover);
        }
      }
      .sc-launchRail {
        width: 36px;
        height: 36px;
        padding: 0;
      }
      .sc-launchLabel {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      @media (hover: hover) {
        .sc-launch:hover {
          border-color: color-mix(in srgb, var(--sc-calendar-accent) 68%, transparent);
          background: color-mix(in srgb, var(--sc-calendar-accent) 10%, transparent);
          color: var(--dsw-alias-label-primary);
        }
        .sc-launchRail:hover {
          border-color: color-mix(in srgb, var(--sc-calendar-accent) 55%, transparent);
          background: color-mix(in srgb, var(--sc-calendar-accent) 10%, transparent);
        }
      }

      .sc-card {
        position: fixed;
        /* Vertical centring without a transform: auto margins split the free
           space, which keeps the backdrop blur sampling correctly. */
        top: 0;
        bottom: 0;
        height: min(720px, calc(100vh - 24px));
        max-height: calc(100vh - 24px);
        margin-top: auto;
        margin-bottom: auto;
        z-index: 1;
        display: flex;
        flex-direction: column;
        width: ${CARD_WIDTH}px;
        max-width: calc(100vw - 24px);
        box-sizing: border-box;
        border: 0;
        border-radius: 16px;
        /* No backdrop-filter here: it promotes the card to its own composited
           layer, and a quick hover's background change can then miss the frame
           that paints before the pointer leaves — the control looks inert when
           the pointer moves fast. The menu token is already 94% opaque, so the
           blur bought nothing visible. */
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)));
        --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
        box-shadow: var(--dsw-elevation-prominent);
        --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
        --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 1.5;
        overflow: hidden;
        outline: none;
      }
      /* The month is a heading; the four controls below split the row evenly,
         so there is no dead stretch between them to miss. */
      .sc-title {
        flex: none;
        padding: 8px 10px 2px;
        text-align: center;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.5;
        color: var(--dsw-alias-label-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* The month row is dressed exactly like the rule switch below it: one
         outlined track holding two-pixel-apart segments. */
      .sc-head {
        flex: none;
        display: flex;
        align-items: stretch;
        gap: 2px;
        margin: 0 10px 4px;
        padding: 2px;
        min-height: 30px;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
        border-radius: 8px;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);
        user-select: none;
      }
      .sc-navBtn {
        flex: 1 1 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: auto;
        min-height: 26px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .sc-navBtn:focus-visible,
      .sc-today:focus-visible,
      .sc-cell:focus-visible,
      .sc-row:focus-visible,
      .sc-retry:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
        outline-offset: -2px;
      }
      @media (hover: hover) {
        .sc-navBtn:hover,
        .sc-today:hover {
          background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
          color: var(--dsw-alias-label-primary);
        }
        /* Both segments react to the pointer: the resting one lifts, the
           pressed one deepens, so a click never reads as "nothing happened". */
        .sc-seg:not([aria-pressed='true']):hover {
          background: var(--dsw-alias-interactive-bg-hover);
          color: var(--dsw-alias-label-primary);
        }
        .sc-seg[aria-pressed='true']:hover {
          background: color-mix(in srgb, var(--sc-calendar-accent) 22%, transparent);
        }
        .sc-cell:hover {
          background: color-mix(in srgb, var(--sc-calendar-accent) 10%, transparent);
        }
        .sc-row:hover {
          background: color-mix(in srgb, var(--sc-accent, currentColor) 12%, transparent);
        }
        .sc-retry:hover {
          background: var(--dsw-alias-interactive-bg-hover);
        }
      }
      /* Pointer-driven twins of the header hover rules: a class change is a
         guaranteed repaint, so the controls answer on every entry. */
      .sc-navBtn.sc-hot {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      .sc-today.sc-hot {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      /* The grouping switch gets its own full-width row: two big segments,
         impossible to miss with the pointer. */
      .sc-modes {
        flex: none;
        display: flex;
        gap: 2px;
        margin: 0 10px 6px;
        padding: 2px;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
        border-radius: 8px;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);
      }
      .sc-seg {
        flex: 1 1 0;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        height: 26px;
        padding: 0 8px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
      }
      .sc-seg[aria-pressed='true'] {
        background: color-mix(in srgb, var(--sc-calendar-accent) 16%, transparent);
        color: var(--dsw-alias-label-primary);
        font-weight: 600;
      }
      .sc-seg:active {
        background: color-mix(in srgb, var(--sc-calendar-accent) 26%, transparent);
      }
      .sc-seg:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--sc-calendar-accent));
        outline-offset: -1px;
      }
      .sc-navBtn.sc-hot,
      .sc-today.sc-hot {
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
        color: var(--dsw-alias-label-primary);
      }
      .sc-seg.sc-hot {
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
        color: var(--dsw-alias-label-primary);
      }
      .sc-seg[aria-pressed='true'].sc-hot {
        background: color-mix(in srgb, var(--sc-calendar-accent) 22%, transparent);
      }
      .sc-today {
        flex: 1 1 0;
        display: flex;
        align-items: center;
        justify-content: center;
        height: auto;
        min-height: 26px;
        padding: 0 8px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
      }
      .sc-weekRow {
        flex: none;
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
        margin-top: 4px;
        padding: 0 10px;
      }
      .sc-weekday {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 24px;
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 1.6;
      }
      .sc-grid {
        flex: none;
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 3px;
        padding: 0 10px 8px;
      }
      .sc-cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        height: 38px;
        padding: 0;
        box-sizing: border-box;
        border: 1.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
        border-color: color-mix(in srgb, var(--dsw-alias-label-secondary) 15%, transparent);
        border-radius: 10px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 14px;
        font-variant-numeric: tabular-nums;
        line-height: 1.6;
        cursor: pointer;
        outline: none;
      }
      .sc-cellBlank {
        cursor: default;
        visibility: hidden;
      }
      /* A day with sessions paints its frame in the Workspace colours: one
         solid colour, or a gradient through every Workspace that created
         sessions that day. The frame is a masked ring so the rounded corners
         survive, and the cell's own border steps aside for it. */
      .sc-cell {
        position: relative;
      }
      .sc-cellFilled {
        border-color: transparent;
      }
      .sc-cellFilled::before {
        content: '';
        position: absolute;
        inset: -1.5px;
        border-radius: inherit;
        padding: 1.5px;
        background: var(--sc-ring, var(--dsw-alias-border-l3));
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        mask-composite: exclude;
        pointer-events: none;
      }
      .sc-cellToday:not(.sc-cellFilled) {
        border-color: color-mix(in srgb, var(--sc-calendar-accent) 62%, transparent);
      }
      /* Today's number stays plain text — white in the dark theme, ink in the
         light one — because the brand blue on the card was hard to read. The
         underline carries the "today" mark instead. */
      .sc-cellToday .sc-dayNum {
        color: var(--dsw-alias-label-primary);
        font-weight: 700;
        text-decoration: underline;
        text-decoration-color: color-mix(in srgb, var(--sc-calendar-accent) 70%, transparent);
        text-decoration-thickness: 1.5px;
        text-underline-offset: 2px;
      }
      .sc-cellSelected {
        background: color-mix(in srgb, var(--sc-calendar-accent) 16%, transparent);
        color: var(--dsw-alias-label-primary);
        font-weight: 600;
      }
      .sc-cellSelected:not(.sc-cellFilled) {
        border-color: var(--sc-calendar-accent);
      }
      .sc-dayNum {
        line-height: 18px;
      }
      /* One dot per Workspace present that day; a row holds five, then wraps. */
      .sc-dots {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 3px;
        max-width: 38px;
        max-height: 13px;
        overflow: hidden;
      }
      .sc-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--sc-dot, var(--dsw-alias-label-tertiary));
      }
      .sc-divider {
        flex: none;
        height: 1px;
        margin: 0 10px;
        background: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      }
      .sc-dayHead {
        flex: none;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        padding: 9px 14px 3px;
      }
      .sc-dayLabel {
        font-size: 12.5px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sc-dayCount {
        flex: none;
        font-size: 11.5px;
        color: var(--dsw-alias-label-secondary);
      }
      .sc-list {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: 3px 8px 10px;
      }
      .sc-group {
        flex: none;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .sc-group + .sc-group {
        margin-top: 8px;
      }
      /* --sc-accent arrives inline from the Workspace palette: one colour per
         Workspace, used by the group glyph and its rows' hairlines. */
      /* The Workspace heading stays pinned while its own rows scroll past, so
         a busy day never loses track of which group you are reading. */
      .sc-groupHead {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 7px 7px 3px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        font-weight: 600;
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1));
      }
      .sc-groupHead svg {
        color: var(--sc-accent, currentColor);
      }
      .sc-groupTitle {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sc-groupCount {
        margin-left: auto;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .sc-row {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 4px 8px;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
        border-color: color-mix(in srgb, var(--sc-accent, currentColor) 42%, transparent);
        border-radius: 9px;
        background: color-mix(in srgb, var(--sc-accent, currentColor) 5%, transparent);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13.5px;
        text-align: left;
        cursor: pointer;
      }
      .sc-rowTitle {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sc-rowTime {
        flex: none;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
      }
      .sc-note {
        flex: none;
        /* Auto vertical margins centre the note in whatever space is left, so
           a fixed-height card never leaves it stranded at the top. */
        margin: auto 0;
        padding: 18px 16px 20px;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
        font-size: 12.5px;
      }
      .sc-note strong {
        display: block;
        margin-bottom: 4px;
        color: var(--dsw-alias-label-primary);
        font-weight: 600;
      }
      .sc-retry {
        margin-top: 10px;
        height: 28px;
        padding: 0 12px;
        border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }

      /* A window too short for the grid plus a list scrolls the whole card
         instead of squeezing the list out of existence. */
      @media (max-height: 560px) {
        .sc-cell {
          height: 32px;
        }
      }
      /* Below this the fixed layout cannot fit at all, so the card itself
         becomes the scroller instead of clipping the grid. */
      @media (max-height: 420px) {
        .sc-card {
          overflow-y: auto;
        }
        .sc-list {
          flex: 0 0 auto;
          overflow: visible;
        }
        .sc-note {
          margin: 0;
        }
      }
    `

    // ---------------------------------------------------------------------
    // Registration.
    // ---------------------------------------------------------------------

    /** Mount both seats and their resources. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-calendar: dictionaries')

      // The sidebar row renders while the card is closed, so the shared
      // stylesheet lives beside both seats and is removed on dispose.
      ctx.effect(() => {
        const element = document.createElement('style')
        element.setAttribute('data-session-calendar', '')
        element.textContent = styles
        document.head.appendChild(element)
        return () => { element.remove() }
      }, 'session-calendar: styles')

      /**
       * Open one Session without dismissing the card: the calendar stays up so
       * the reader can keep picking from the same day. Dismissing remains the
       * explicit paths (the row, a click outside, Escape, a resize).
       */
      const openSession = (sessionId) => {
        try {
          ctx.uiWorkspace.openSession(sessionId)
        } catch (error) {
          console.error('session-calendar: could not open session', sessionId, error)
        }
      }

      // Outermost layer (`order: -1`): the decorated New-session row renders
      // unchanged, and this row is appended beneath it.
      ctx.effect(
        () => ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
          name: 'sidebar.session.action',
          id: 'session-calendar',
          order: -1,
          locale: NS,
        }, CalendarAction)),
        'session-calendar: sidebar action',
      )

      // The window lives in the frame-wide floating layer, so no column clips it.
      ctx.effect(
        () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-calendar',
          order: 40,
          locale: NS,
          inject: () => ({ openSession }),
        }, CalendarOverlay)),
        'session-calendar: calendar window',
      )

      // A plugin unload must not leave the shared sheet open over the page.
      ctx.effect(() => closeShared, 'session-calendar: close on dispose')
    }

    return { inject: ['slots', 'locale', 'uiWorkspace'], apply }
  },
})
