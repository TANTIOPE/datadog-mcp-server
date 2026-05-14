/**
 * Behavior tests for `monitors action=history` — see design.md
 * "Testing strategy > Unit tests" (13 enumerated cases) for the source list.
 *
 * The implementation under test is `historyMonitor` (orchestration) and the
 * `history` case in `registerMonitorsTool` (handler wiring). Fixtures and the
 * msw dispatch handler land in Task 1; helpers in Task 2; orchestration in
 * Task 3; handler wiring in Task 4. This file consumes all of those.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { v1, v2 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { http, HttpResponse } from 'msw'
import {
  server,
  endpoints,
  errorResponse,
  jsonResponse,
  monitorHistoryEventsSearchHandler
} from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { monitorHistoryFixtures } from '../helpers/fixtures.js'
import { historyMonitor, registerMonitorsTool } from '../../src/tools/monitors.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  defaultLimit: 50,
  defaultLogLines: 200,
  defaultMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

const defaultSite = 'datadoghq.com'

describe('Monitors Tool — action=history', () => {
  let eventsApi: v2.EventsApi

  beforeEach(() => {
    const config = createMockConfig()
    eventsApi = new v2.EventsApi(config)
  })

  describe('historyMonitor (orchestration)', () => {
    it('case 1 — happy path: returns the single alert transition for monitor 1001 (alertOnly fixture)', async () => {
      server.use(monitorHistoryEventsSearchHandler())

      const result = await historyMonitor(eventsApi, 1001, {}, defaultLimits, defaultSite)

      expect(result.count).toBe(1)
      expect(result.transitions).toHaveLength(1)
      expect(result.transitions[0]).toMatchObject({
        monitorId: 1001,
        monitorName: '[DO-1712] Pod readiness production',
        fromState: 'OK',
        toState: 'Alert',
        transitionType: 'alert',
        eventId: 'evt-mh-1001-001'
      })
      expect(result.transitions[0]?.group).toBe('kube_namespace:production,pod_name:foo')
      expect(result.meta.count).toBe(1)
      expect(result.meta.totalFetched).toBe(1)
      expect(result.meta.truncated).toBe(false)
      expect(result.meta.monitorId).toBe(1001)
      expect(result.meta.datadog_url).toContain('app.datadoghq.com')
    })

    it('case 2 — empty result: returns count 0 for monitor 1005 (empty fixture) with no error', async () => {
      server.use(monitorHistoryEventsSearchHandler())

      const result = await historyMonitor(eventsApi, 1005, {}, defaultLimits, defaultSite)

      expect(result.count).toBe(0)
      expect(result.transitions).toEqual([])
      expect(result.meta.count).toBe(0)
      expect(result.meta.totalFetched).toBe(0)
      expect(result.meta.truncated).toBe(false)
    })

    it('case 3 — dynamic-title regression (issue #53): unique titles per event do NOT collapse to count 1; filtered transition_type query returns count 2', async () => {
      // Issue #53: an SLO burn-rate monitor emits events whose titles vary every
      // evaluation ("burn rates of 6.01 and 12.01"). A stale dedup-by-title
      // implementation would collapse all of these to a single bucket. The
      // correct behavior is to count each event as its own transition.
      //
      // The dispatch in tests/helpers/msw.ts returns the dynamicTitle fixture
      // (5 events: 3 'alert' + 2 'alert recovery') regardless of the request
      // filter. To emulate Datadog's server-side filtering of
      // @monitor.transition.transition_type, we wire a test-local handler that
      // narrows the fixture to the requested transition types.
      server.use(
        http.post(endpoints.searchEvents, async ({ request }) => {
          const body = (await request.json()) as { filter?: { query?: string } }
          const sentQuery = body.filter?.query ?? ''
          expect(sentQuery).toContain('@monitor.id:1003')
          // Pull the transition_type values out of the (alert recovery OR ...) clause.
          const typesMatch = /@monitor\.transition\.transition_type:\(([^)]+)\)/.exec(sentQuery)
          const requested = typesMatch
            ? typesMatch[1].split(' OR ').map((s) => s.trim().replace(/^"|"$/g, ''))
            : null

          const filtered = monitorHistoryFixtures.dynamicTitle.data.filter((event) => {
            if (!requested) return true
            const t = event.attributes.attributes.monitor.transition.transition_type
            return requested.includes(t)
          })

          return jsonResponse({
            data: filtered,
            meta: { page: { after: null } }
          })
        })
      )

      const result = await historyMonitor(
        eventsApi,
        1003,
        { transitionType: ['alert recovery'] },
        defaultLimits,
        defaultSite
      )

      // Two 'alert recovery' events in the dynamicTitle fixture; titles differ
      // for each but each one must surface as its own transition record.
      expect(result.count).toBe(2)
      expect(result.transitions).toHaveLength(2)
      for (const transition of result.transitions) {
        expect(transition.transitionType).toBe('alert recovery')
        expect(transition.monitorId).toBe(1003)
      }
      // Each event has a unique title; verify the projection still produces
      // distinct transition records (i.e. no title-based dedup is happening).
      const eventIds = result.transitions.map((t) => t.eventId)
      expect(new Set(eventIds).size).toBe(eventIds.length)
    })

    it('case 4 — multi-alert + group filter: monitor 1002 with group "host:web-01" emits the group clause in the assembled query', async () => {
      // Capture the request body so we can assert the query string composition,
      // and inline the same dispatch the shared handler uses for monitor 1002.
      const requestBodies: Array<{ filter?: { query?: string } }> = []
      server.use(
        http.post(endpoints.searchEvents, async ({ request }) => {
          const body = (await request.json()) as {
            filter?: { query?: string }
            page?: { cursor?: string }
          }
          requestBodies.push(body)
          return jsonResponse(monitorHistoryFixtures.mixed)
        })
      )

      const result = await historyMonitor(
        eventsApi,
        1002,
        { group: 'host:web-01' },
        defaultLimits,
        defaultSite
      )

      expect(requestBodies.length).toBeGreaterThan(0)
      const sentQuery = requestBodies[0]?.filter?.query ?? ''
      expect(sentQuery).toContain('source:alert')
      expect(sentQuery).toContain('@monitor.id:1002')
      expect(sentQuery).toContain('@monitor.groups:"host:web-01"')
      // Default transitionType filter is also propagated to the wire.
      expect(sentQuery).toContain('@monitor.transition.transition_type:(alert OR "alert recovery")')
      expect(result.meta.query).toBe(sentQuery)
      expect(result.meta.group).toBe('host:web-01')
      // The fixture's 4 events all carry a `monitor.transition` block, so each
      // surfaces as a transition record on the client side; Datadog applies
      // the transition_type filter server-side in production.
      expect(result.count).toBe(4)
      expect(result.transitions).toHaveLength(4)
    })

    it('case 5 — default time range: when from/to are omitted, meta.from and meta.to span limits.defaultTimeRangeHours', async () => {
      server.use(monitorHistoryEventsSearchHandler())

      const before = Date.now()
      const result = await historyMonitor(eventsApi, 1001, {}, defaultLimits, defaultSite)
      const after = Date.now()

      // ISO 8601 sanity
      expect(result.meta.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(result.meta.to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)

      const fromMs = new Date(result.meta.from).getTime()
      const toMs = new Date(result.meta.to).getTime()
      const expectedDeltaMs = defaultLimits.defaultTimeRangeHours * 3600 * 1000

      // Delta should equal defaultTimeRangeHours within a few seconds (allows
      // for time elapsed between hoursAgo() and now() during the call).
      const actualDeltaMs = toMs - fromMs
      expect(actualDeltaMs).toBeGreaterThanOrEqual(expectedDeltaMs - 5000)
      expect(actualDeltaMs).toBeLessThanOrEqual(expectedDeltaMs + 5000)

      // The `to` bound must fall within the window of this test invocation
      // (parseTime resolves it at call time).
      expect(toMs).toBeGreaterThanOrEqual(before - 1000)
      expect(toMs).toBeLessThanOrEqual(after + 1000)
    })

    it('case 6 — relative time input: from: "7d" is parsed and the resulting window is ~7 days', async () => {
      server.use(monitorHistoryEventsSearchHandler())

      const result = await historyMonitor(
        eventsApi,
        1001,
        { from: '7d' },
        defaultLimits,
        defaultSite
      )

      const fromMs = new Date(result.meta.from).getTime()
      const toMs = new Date(result.meta.to).getTime()
      const deltaMs = toMs - fromMs
      const sevenDaysMs = 7 * 24 * 3600 * 1000

      expect(deltaMs).toBeGreaterThanOrEqual(sevenDaysMs - 5000)
      expect(deltaMs).toBeLessThanOrEqual(sevenDaysMs + 5000)
    })

    it('case 7 — epoch time input: from: "1700000000" is parsed as a Unix timestamp', async () => {
      server.use(monitorHistoryEventsSearchHandler())

      const result = await historyMonitor(
        eventsApi,
        1001,
        { from: '1700000000' },
        defaultLimits,
        defaultSite
      )

      const fromMs = new Date(result.meta.from).getTime()
      expect(fromMs).toBe(1700000000 * 1000)
    })

    it('case 8 — ISO time input: from: "2026-05-01T00:00:00Z" is parsed as ISO 8601', async () => {
      server.use(monitorHistoryEventsSearchHandler())

      const result = await historyMonitor(
        eventsApi,
        1001,
        { from: '2026-05-01T00:00:00Z', to: '2026-05-08T00:00:00Z' },
        defaultLimits,
        defaultSite
      )

      expect(new Date(result.meta.from).getTime()).toBe(Date.parse('2026-05-01T00:00:00Z'))
      expect(new Date(result.meta.to).getTime()).toBe(Date.parse('2026-05-08T00:00:00Z'))
    })

    it('case 12 — pagination across two pages: monitor 1004 returns all transitions from page1 and page2', async () => {
      server.use(monitorHistoryEventsSearchHandler())

      const result = await historyMonitor(eventsApi, 1004, {}, defaultLimits, defaultSite)

      // multiPage fixture: page1 has 2 events (1 alert + 1 alert recovery),
      // page2 has 1 event (1 alert). All are real transitions → count === 3.
      expect(result.count).toBe(3)
      expect(result.transitions).toHaveLength(3)
      expect(result.meta.totalFetched).toBe(3)
      expect(result.meta.truncated).toBe(false)

      const eventIds = result.transitions.map((t) => t.eventId)
      expect(eventIds).toEqual(
        expect.arrayContaining(['evt-mh-1004-001', 'evt-mh-1004-002', 'evt-mh-1004-003'])
      )
    })

    it('case 13 — truncation: when the broker returns events indefinitely, the loop caps at maxEventsToProcess and sets meta.truncated', async () => {
      // Custom handler: every page returns 1000 events with a never-null cursor.
      // historyMonitor caps at maxEventsToProcess = 10000 (10 pages of 1000),
      // sets meta.truncated = true, and returns transitions.length <= 10000.
      let pageIndex = 0
      server.use(
        http.post(endpoints.searchEvents, async () => {
          pageIndex++
          const data = Array.from({ length: 1000 }, (_, i) => ({
            id: `evt-trunc-${pageIndex}-${i}`,
            type: 'event',
            attributes: {
              timestamp: '2026-05-13T10:00:00.000Z',
              tags: ['source:alert', 'monitor_id:99999'],
              attributes: {
                title: `[Triggered] truncation event ${pageIndex}-${i}`,
                monitor: {
                  id: 99999,
                  name: 'Truncation monitor',
                  groups: ['env:test'],
                  transition: {
                    source_state: 'OK',
                    destination_state: 'Alert',
                    transition_type: 'alert'
                  }
                }
              }
            }
          }))
          return HttpResponse.json({
            data,
            meta: { page: { after: `cursor-${pageIndex + 1}` } }
          })
        })
      )

      const result = await historyMonitor(eventsApi, 99999, {}, defaultLimits, defaultSite)

      expect(result.meta.truncated).toBe(true)
      // historyMonitor's cap = 10000 events / 100 pages, whichever comes first.
      // With 1000 events per page, the event-count cap fires at 10 pages.
      expect(result.transitions.length).toBeLessThanOrEqual(10000)
      expect(result.transitions.length).toBeGreaterThan(0)
      expect(result.meta.totalFetched).toBeGreaterThanOrEqual(10000)
    })
  })

  describe('registerMonitorsTool handler dispatch (action=history)', () => {
    type ToolHandler = (params: Record<string, unknown>) => Promise<{
      content: Array<{ type: string; text: string }>
    }>

    function buildMockServer(): { mockServer: McpServer; getHandler: () => ToolHandler } {
      let captured: ToolHandler | undefined
      const mockServer = {
        tool: vi.fn((_name: string, _description: string, _schema: unknown, handler: unknown) => {
          captured = handler as ToolHandler
        })
      } as unknown as McpServer
      const getHandler = (): ToolHandler => {
        if (!captured) {
          throw new Error('Tool handler was not registered')
        }
        return captured
      }
      return { mockServer, getHandler }
    }

    function buildMonitorsApi(): v1.MonitorsApi {
      return new v1.MonitorsApi(createMockConfig())
    }

    it('case 9 — missing id: throws InvalidParams when id is omitted on action=history', async () => {
      server.use(monitorHistoryEventsSearchHandler())
      const { mockServer, getHandler } = buildMockServer()
      registerMonitorsTool(
        mockServer,
        buildMonitorsApi(),
        eventsApi,
        defaultLimits,
        false,
        defaultSite
      )
      const handler = getHandler()

      // requireParam throws an McpError; handleDatadogError rethrows it.
      await expect(handler({ action: 'history' })).rejects.toThrow(/required.*history/i)
    })

    it('case 10 — non-numeric id: throws "Invalid monitor ID: ..." on action=history', async () => {
      server.use(monitorHistoryEventsSearchHandler())
      const { mockServer, getHandler } = buildMockServer()
      registerMonitorsTool(
        mockServer,
        buildMonitorsApi(),
        eventsApi,
        defaultLimits,
        false,
        defaultSite
      )
      const handler = getHandler()

      await expect(handler({ action: 'history', id: 'not-a-number' })).rejects.toThrow(
        /Invalid monitor ID: not-a-number/
      )
    })

    it('case 11 — read-only success: action=history succeeds when readOnly: true is set on the server', async () => {
      server.use(monitorHistoryEventsSearchHandler())
      const { mockServer, getHandler } = buildMockServer()
      registerMonitorsTool(
        mockServer,
        buildMonitorsApi(),
        eventsApi,
        defaultLimits,
        true,
        defaultSite
      )
      const handler = getHandler()

      // The action must NOT throw the read-only guard error.
      const result = await handler({ action: 'history', id: '1001' })

      const text = result.content[0]?.text ?? ''
      expect(text).not.toMatch(/not allowed in read-only mode/i)
      // Sanity: payload reflects the alertOnly fixture.
      const parsed = JSON.parse(text) as { count: number; transitions: Array<unknown> }
      expect(parsed.count).toBe(1)
      expect(parsed.transitions).toHaveLength(1)
    })
  })

  describe('error mapping (defensive)', () => {
    it('Datadog 401 is mapped to a 401-coded rejection by handleDatadogError', async () => {
      server.use(http.post(endpoints.searchEvents, () => errorResponse(401, 'Invalid API key')))

      await expect(
        historyMonitor(eventsApi, 1001, {}, defaultLimits, defaultSite)
      ).rejects.toMatchObject({ code: 401 })
    })
  })
})
