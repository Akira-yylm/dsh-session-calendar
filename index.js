/**
 * Host half: the one fact the browser cannot see — when each Session was created.
 *
 * The Client already holds every Workspace, every Session row, and every
 * projected title through `ctx.workspaces` / `useSessions`, but a Session
 * summary carries only `updatedAt`. Creation time lives in the immutable
 * Session header, so this half reads the persistence layer's own listing
 * (`sessionPersistence.list()`, a stat-level read that opens no log body) and
 * publishes `{ id, createdAt, cwd }` rows over one same-origin JSON route.
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
const WIRE_VERSION = 1

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
async function collect(ctx) {
  const snapshots = await ctx.sessionPersistence.list()
  const sessions = []
  for (const snapshot of snapshots) {
    const header = snapshot.header
    // Subagent Sessions never appear in the sidebar, so they never appear here.
    if (header.origin === 'subagent') continue
    // A Session that materialized no event was never used as a conversation.
    if (snapshot.eventCount === 0) continue
    const createdAt = header.createdAt
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) continue
    const title = cachedTitle(ctx, header)
    sessions.push({
      id: String(header.id),
      createdAt,
      cwd: typeof header.cwd === 'string' ? header.cwd : null,
      ...(title === undefined ? {} : { title }),
    })
  }
  sessions.sort((left, right) => left.createdAt - right.createdAt)
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
