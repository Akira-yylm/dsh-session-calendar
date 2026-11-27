/**
 * Host half: the two facts the browser cannot see — when each Session object
 * was created, and when its conversation actually began.
 *
 * The Client already holds every Workspace, every Session row, and every
 * projected title through `ctx.workspaces` / `useSessions`, but a Session
 * summary carries only `updatedAt`. So this half reads the persistence layer's
 * own listing (`sessionPersistence.list()`, a stat-level read) for
 * `header.createdAt`, then peeks at the head of each log once to find the first
 * `user/message`, and publishes `{ id, createdAt, startedAt, cwd }` rows over
 * one same-origin JSON route.
 *
 * `startedAt` matters because DSH reuses a reusable blank Session: a Session
 * object created on one day can receive its first prompt days later, and only
 * the first prompt marks when that conversation really started.
 *
 * The other end of that span — the latest conversation — needs no help here:
 * the Client's `SessionSummary.updatedAt` is the Session's own last human
 * prompt, advanced only by `user/message`, so grouping by "latest" is a purely
 * browser-side decision.
 *
 * Nothing is written anywhere: no Session, Workspace, or storage row is
 * touched, and no model call is made. The route is read-only, answers with
 * `cache-control: no-store`, and reports a business failure instead of
 * throwing so the browser can show its own retry state.
 */

/** `webServer` carries the route; `sessionPersistence` owns the headers. */
export const inject = ['webServer', 'sessionPersistence']

/** Same-origin path the Client half fetches. */
const ROUTE_PATH = '/dsh-session-calendar/created.json'

/** Wire version of the response body. */
const WIRE_VERSION = 2

/** Build one JSON response with no caching. */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * First prompt times already found, keyed by Session id. A first prompt never
 * changes, so a hit is permanent; a miss is simply retried on the next call.
 */
const startedAtCache = new Map()

/** How many leading events to inspect for the first prompt. */
const PRELUDE_EVENTS = 256

/**
 * The moment this Session's conversation began: its first user-authored
 * message, else the first message or Turn of any origin.
 *
 * Opening a read handle is legal while the Session is live and mutating, and
 * only the head of the log is read, so the cost is one small slice per Session
 * for the life of the process (a few run concurrently; see `PROBE_BATCH`).
 */
async function readStartedAt(ctx, header) {
  const cached = startedAtCache.get(String(header.id))
  if (cached !== undefined) return cached
  let handle
  try {
    handle = await ctx.sessionPersistence.open(header.id, 'read')
    const { events } = await handle.read(0, PRELUDE_EVENTS)
    let fallback
    for (const event of events) {
      if (event.type !== 'user/message') {
        if (fallback === undefined && event.type === 'turn/start') fallback = event.time
        continue
      }
      const kind = event.data?.source?.kind
      if (kind === 'user' || kind === undefined) {
        startedAtCache.set(String(header.id), event.time)
        return event.time
      }
      // An injected message (archive replay, scheduled task) is not the
      // conversation's first word; keep looking for the real one.
      if (fallback === undefined) fallback = event.time
    }
    if (fallback !== undefined) {
      startedAtCache.set(String(header.id), fallback)
      return fallback
    }
    // A Session with no conversation yet: leave it uncached so a later prompt
    // is picked up without a restart.
    return undefined
  } catch {
    // A read failure leaves the row on `createdAt`.
    return undefined
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close()
      } catch {
        // Closing a read handle is best-effort.
      }
    }
  }
}

/**
 * Read one Session's cached title without touching its log.
 *
 * This is only a fallback for rows the Client list does not know yet; a cache
 * miss costs nothing and leaves the title to the Client.
 */
function cachedTitle(ctx, header) {
  const cache = ctx.get('sessionProjectionCache')
  if (cache === undefined || cache === null || typeof cache.cachedSnapshot !== 'function') return undefined
  try {
    const snapshot = cache.cachedSnapshot(header, ['title'])
    const value = snapshot?.values?.title
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (value !== null && typeof value === 'object' && typeof value.title === 'string' && value.title.trim() !== '') {
      return value.title.trim()
    }
  } catch {
    // A cache read never fails the listing.
  }
  return undefined
}

/** Fold the stored Session headers into the wire rows, newest day first. */
/** Sessions probed at once when resolving first prompts. */
const PROBE_BATCH = 8

async function collect(ctx) {
  const snapshots = await ctx.sessionPersistence.list()
  const entries = []
  for (const snapshot of snapshots) {
    const header = snapshot.header
    // Subagent Sessions never appear in the sidebar, so they never appear here.
    if (header.origin === 'subagent') continue
    // A Session that materialized no event was never used as a conversation.
    if (snapshot.eventCount === 0) continue
    const createdAt = header.createdAt
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) continue
    const title = cachedTitle(ctx, header)
    entries.push({
      header,
      row: {
        id: String(header.id),
        createdAt,
        cwd: typeof header.cwd === 'string' ? header.cwd : null,
        ...(title === undefined ? {} : { title }),
      },
    })
  }
  // Probing the log head costs one small read per Session the first time the
  // route is asked after a restart, so a few run at a time instead of one by one.
  for (let start = 0; start < entries.length; start += PROBE_BATCH) {
    await Promise.all(entries.slice(start, start + PROBE_BATCH).map(async (entry) => {
      const startedAt = await readStartedAt(ctx, entry.header)
      if (startedAt !== undefined) entry.row.startedAt = startedAt
    }))
  }
  const sessions = entries.map((entry) => entry.row)
  sessions.sort((left, right) => (left.startedAt ?? left.createdAt) - (right.startedAt ?? right.createdAt))
  return sessions
}

/** Mount the read-only creation-time route. */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      resource: async (request, peer) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
        }
        if (peer !== undefined && peer.principal?.kind !== 'owner') {
          return new Response(null, { status: 403 })
        }
        try {
          const sessions = await collect(ctx)
          return json({ version: WIRE_VERSION, generatedAt: Date.now(), sessions })
        } catch (error) {
          return json({
            version: WIRE_VERSION,
            generatedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
            sessions: [],
          }, 500)
        }
      },
    }),
    'session-calendar: creation-time route',
  )
}
