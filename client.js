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
    const CARD_WIDTH = 320
    /** Grid rows are fixed at six weeks so the card height never jumps. */
    const GRID_WEEKS = 6
    /** Card height kept clear below the trigger when the window allows it. */
    const CARD_RESERVE = 360

    // ---------------------------------------------------------------------
    // Copy. Chinese is also the runtime fallback when a seat omits `t`.
    // ---------------------------------------------------------------------

    const zh = {
      entry: '会话日历',
      panel: '会话日历',
      open: '打开会话日历',
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

    /** One parsed creation-time row, or null when the row is unusable. */
    function readRow(row) {
      if (row === null || typeof row !== 'object') return null
      if (typeof row.id !== 'string' || row.id === '') return null
      if (typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)) return null
      return row
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
    function indexDays(rows, sessionList, workspaceSnapshot, t) {
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
        const day = dayKeyOf(new Date(row.createdAt))
        let bucket = days.get(day)
        if (bucket === undefined) {
          bucket = { count: 0, groups: new Map() }
          days.set(day, bucket)
        }
        let group = bucket.groups.get(groupKey)
        if (group === undefined) {
          group = { key: groupKey, title: groupTitle, order: groupOrder, items: [] }
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
          time: row.createdAt,
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
          ? { right: isWide ? 268 : 56, top: 120 }
          : element.getBoundingClientRect()
        openWith({ right: rect.right, top: rect.top }, element)
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
      const skipFocusReturn = React.useRef(false)
      const todayKey = dayKeyOf(new Date())
      const [month, setMonth] = React.useState(() => monthStartOf(new Date()))
      const [selected, setSelected] = React.useState(() => todayKey)

      const days = React.useMemo(
        () => indexDays(created.rows, sessionList, workspaceSnapshot, t),
        [created.rows, sessionList, workspaceSnapshot, t],
      )

      const geometry = React.useMemo(() => {
        const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth
        const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
        const width = Math.max(240, Math.min(CARD_WIDTH, viewportWidth - 24))
        const wantedLeft = anchor === null || anchor === undefined ? 268 : anchor.right + 10
        const left = Math.max(12, Math.min(wantedLeft, viewportWidth - width - 12))
        const wantedTop = anchor === null || anchor === undefined ? 96 : anchor.top
        // Keep room for the whole card; on a short window the card scrolls instead.
        const top = Math.max(12, Math.min(wantedTop, viewportHeight - CARD_RESERVE))
        const maxHeight = Math.max(220, Math.min(560, viewportHeight - top - 24))
        return { left, top, width, maxHeight }
      }, [anchor])

      React.useEffect(() => {
        const card = cardRef.current
        if (card !== null && card !== undefined && typeof card.focus === 'function') {
          card.focus({ preventScroll: true })
        }
        // Closing returns focus to the row, unless the click opened a Session.
        return () => {
          if (skipFocusReturn.current) return
          const trigger = triggerRef.current
          if (trigger === null || trigger === undefined || trigger.isConnected !== true) return
          try {
            trigger.focus({ preventScroll: true })
          } catch {
            // Focus restore is best-effort.
          }
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
      const openAndClose = (sessionId) => {
        skipFocusReturn.current = true
        closeShared()
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
          'aria-label': t('panel'),
          tabIndex: -1,
          style: {
            left: geometry.left + 'px',
            top: geometry.top + 'px',
            width: geometry.width + 'px',
            maxHeight: geometry.maxHeight + 'px',
          },
        },
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
          h('span', { className: 'sc-monthLabel' }, monthLabel),
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
              disabled: sameMonth(month, new Date()) && selected === todayKey,
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
            const classes = ['sc-cell']
            if (count > 0) classes.push('sc-cellFilled')
            if (key === selected) classes.push('sc-cellSelected')
            else if (key === todayKey) classes.push('sc-cellToday')
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
                onClick: () => { setSelected(key) },
              },
              h('span', { className: 'sc-dayNum' }, String(date.getDate())),
              count > 0 ? h('span', { className: 'sc-dot' }) : null,
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
                      // Each Workspace keeps one accent hue, so a coloured
                      // hairline also tells the groups apart at a glance.
                      className: 'sc-group sc-accent-' + (((group.order % 4) + 4) % 4),
                    },
                    h(
                      'div',
                      { className: 'sc-groupHead' },
                      h(FolderGlyph, { size: 12 }),
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
                        onClick: () => { openAndClose(item.id) },
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
        --sc-calendar-accent: var(--dsw-alias-state-business-primary);
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
        border-color: color-mix(in srgb, var(--sc-calendar-accent) 38%, transparent);
        border-radius: var(--dsw-radius-md, 10px);
        background: transparent;
        color: var(--dsw-alias-label-secondary);
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
        border-color: color-mix(in srgb, var(--sc-calendar-accent) 72%, transparent);
        background: color-mix(in srgb, var(--sc-calendar-accent) 12%, transparent);
        color: var(--dsw-alias-label-primary);
      }
      .sc-launch:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--sc-calendar-accent));
        outline-offset: 1px;
      }
      .sc-launchRail {
        width: 36px;
        height: 36px;
        padding: 0;
        border-color: color-mix(in srgb, var(--sc-calendar-accent) 28%, transparent);
        background: transparent;
      }
      .sc-launchRail[aria-expanded='true'] {
        border-color: color-mix(in srgb, var(--sc-calendar-accent) 72%, transparent);
        background: color-mix(in srgb, var(--sc-calendar-accent) 12%, transparent);
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
        z-index: 1;
        display: flex;
        flex-direction: column;
        width: ${CARD_WIDTH}px;
        max-width: calc(100vw - 24px);
        box-sizing: border-box;
        border: 0;
        border-radius: 16px;
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)));
        backdrop-filter: var(--dsw-menu-backdrop-filter, none);
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
      .sc-head {
        flex: none;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 8px 8px 2px;
      }
      .sc-monthLabel {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: center;
        font-size: 13px;
        line-height: 1.6;
        color: var(--dsw-alias-label-primary);
      }
      .sc-navBtn {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 8px;
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
        .sc-navBtn:hover {
          background: var(--dsw-alias-interactive-bg-hover);
          color: var(--dsw-alias-label-primary);
        }
        .sc-today:hover:not(:disabled) {
          background: var(--dsw-alias-interactive-bg-hover);
          color: var(--dsw-alias-label-primary);
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
      .sc-today {
        flex: none;
        height: 26px;
        padding: 0 8px;
        border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .sc-today:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .sc-weekRow {
        flex: none;
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
        margin-top: 2px;
        padding: 0 8px;
      }
      .sc-weekday {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 22px;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
        line-height: 1.6;
      }
      .sc-grid {
        flex: none;
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
        padding: 0 8px 6px;
      }
      .sc-cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1px;
        height: 30px;
        padding: 0;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
        border-color: color-mix(in srgb, var(--dsw-alias-label-secondary) 15%, transparent);
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        line-height: 1.6;
        cursor: pointer;
        outline: none;
      }
      .sc-cellBlank {
        cursor: default;
        visibility: hidden;
      }
      /* Every date keeps a neutral 1px frame; a day with sessions swaps it for
         the calendar's accent colour, today strengthens it, and the picked day
         takes the solid accent plus a tinted fill. */
      .sc-cellFilled {
        border-color: color-mix(in srgb, var(--sc-calendar-accent) 34%, transparent);
      }
      .sc-cellToday {
        border-color: color-mix(in srgb, var(--sc-calendar-accent) 62%, transparent);
      }
      .sc-cellSelected,
      .sc-cellSelected:hover {
        border-color: var(--sc-calendar-accent);
        background: color-mix(in srgb, var(--sc-calendar-accent) 16%, transparent);
        color: var(--dsw-alias-label-primary);
        font-weight: 600;
      }
      .sc-dayNum {
        line-height: 15px;
      }
      .sc-dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--sc-calendar-accent);
      }
      .sc-divider {
        flex: none;
        height: 1px;
        margin: 0 8px;
        background: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      }
      .sc-dayHead {
        flex: none;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px 2px;
      }
      .sc-dayLabel {
        font-size: 12px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sc-dayCount {
        flex: none;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
      }
      .sc-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 2px 6px 8px;
      }
      .sc-group {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .sc-group + .sc-group {
        margin-top: 8px;
      }
      /* One accent hue per Workspace: it colours the group's glyph and the
         hairline around each of its session rows. */
      .sc-accent-0 {
        --sc-accent: var(--dsw-alias-state-business-primary);
      }
      .sc-accent-1 {
        --sc-accent: var(--dsw-alias-state-success-primary);
      }
      .sc-accent-2 {
        --sc-accent: var(--dsw-alias-state-warn-primary);
      }
      .sc-accent-3 {
        --sc-accent: var(--dsw-alias-state-error-primary);
      }
      .sc-groupHead {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 6px 6px 2px;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        font-weight: 600;
      }
      .sc-groupHead svg {
        color: color-mix(in srgb, var(--sc-accent, currentColor) 78%, var(--dsw-alias-label-secondary));
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
        gap: 8px;
        width: 100%;
        padding: 5px 7px;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
        border-color: color-mix(in srgb, var(--sc-accent, currentColor) 30%, transparent);
        border-radius: 8px;
        background: color-mix(in srgb, var(--sc-accent, currentColor) 4%, transparent);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
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
        padding: 16px 14px 18px;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
      }
      .sc-note strong {
        display: block;
        margin-bottom: 4px;
        color: var(--dsw-alias-label-primary);
        font-weight: 600;
      }
      .sc-retry {
        margin-top: 10px;
        height: 26px;
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
      @media (max-height: 460px) {
        .sc-card {
          overflow-y: auto;
        }
        .sc-list {
          flex: 0 0 auto;
          overflow: visible;
        }
        .sc-cell {
          height: 26px;
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

      /** Open one Session and dismiss the card in the same navigation. */
      const openSession = (sessionId) => {
        closeShared()
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
