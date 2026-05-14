/**
 * Unit tests for the events tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1, v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { events as fixtures } from '../helpers/fixtures.js'
import {
  listEventsV1,
  getEventV1,
  createEventV1,
  searchEventsV2,
  histogramEventsV2,
  aggregateEventsV2,
  incidentsEventsV2,
  timeseriesEventsV2,
  computeDiagnostics,
  UNINDEXED_ALERT_TAG_PREFIXES,
  pickEventFields
} from '../../src/tools/events.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24,
  defaultLimit: 100,
  maxEventsForHistogram: 5000
}

const defaultSite = 'datadoghq.com'

describe('Events Tool', () => {
  let apiV1: v1.EventsApi
  let apiV2: v2.EventsApi

  beforeEach(() => {
    const config = createMockConfig()
    apiV1 = new v1.EventsApi(config)
    apiV2 = new v2.EventsApi(config)
  })

  describe('listEventsV1', () => {
    it('should list events successfully', async () => {
      server.use(
        http.get(endpoints.listEvents, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listEventsV1(apiV1, {}, defaultLimits)

      expect(result.events).toHaveLength(2)
      expect(result.events[0].id).toBe(1001)
      expect(result.events[0].title).toBe('Deployment started')
    })

    it('should filter events by priority', async () => {
      server.use(
        http.get(endpoints.listEvents, ({ request }) => {
          const url = new URL(request.url)
          const priority = url.searchParams.get('priority')

          expect(priority).toBe('normal')
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listEventsV1(apiV1, { priority: 'normal' }, defaultLimits)

      expect(result.events).toBeDefined()
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listEvents, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listEventsV1(apiV1, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listEvents, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(listEventsV1(apiV1, {}, defaultLimits)).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getEventV1', () => {
    it('should get a single event by ID', async () => {
      server.use(
        http.get(endpoints.getEvent(1001), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getEventV1(apiV1, '1001')

      expect(result.event.id).toBe(1001)
      expect(result.event.title).toBe('Deployment started')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getEvent(99999), () => {
          return errorResponse(404, 'Event not found')
        })
      )

      await expect(getEventV1(apiV1, '99999')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createEventV1', () => {
    it('should create a new event', async () => {
      server.use(
        http.post(endpoints.createEvent, async () => {
          return jsonResponse(fixtures.created)
        })
      )

      const result = await createEventV1(apiV1, {
        title: 'Test Event',
        text: 'Test event description',
        priority: 'normal',
        alertType: 'info'
      })

      expect(result.success).toBe(true)
      expect(result.event.id).toBe(1003)
    })

    it('should handle 400 bad request from API', async () => {
      server.use(
        http.post(endpoints.createEvent, () => {
          return errorResponse(400, 'Invalid event data')
        })
      )

      await expect(
        createEventV1(apiV1, {
          title: 'Test',
          text: 'Test'
        })
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('searchEventsV2', () => {
    it('should search events successfully', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => {
          return jsonResponse(fixtures.searchV2)
        })
      )

      const result = await searchEventsV2(
        apiV2,
        {
          query: 'source:alert',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits,
        defaultSite
      )

      expect(result.events).toBeDefined()
      expect(result.events.length).toBeGreaterThan(0)
    })

    it('should handle pagination cursor', async () => {
      let pageCount = 0
      server.use(
        http.post(endpoints.searchEvents, async ({ request }) => {
          const body = (await request.json()) as { page?: { cursor?: string } }
          pageCount++

          if (body.page?.cursor === 'cursor_page2') {
            return jsonResponse(fixtures.searchV2MultiPage.page2)
          }
          return jsonResponse(fixtures.searchV2MultiPage.page1)
        })
      )

      // First page
      const page1 = await searchEventsV2(
        apiV2,
        { query: 'source:alert', limit: 1 },
        defaultLimits,
        defaultSite
      )

      expect(page1.events).toHaveLength(1)
      expect(page1.meta.nextCursor).toBe('cursor_page2')
      expect(pageCount).toBe(1)
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(
        searchEventsV2(apiV2, { query: '*' }, defaultLimits, defaultSite)
      ).rejects.toMatchObject({
        code: 401
      })
    })

    describe('diagnostics on zero-result search', () => {
      const emptyResponse = { data: [], meta: { page: { after: null } } }

      it('should attach diagnostics field when result is empty', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(emptyResponse)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'source:alert monitor_priority:P1',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.events).toHaveLength(0)
        expect(result.diagnostics).toBeDefined()
        expect(Array.isArray(result.diagnostics)).toBe(true)
      })

      it('should NOT attach diagnostics field when result is non-empty', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(fixtures.searchV2)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'source:alert',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.events.length).toBeGreaterThan(0)
        expect(Object.prototype.hasOwnProperty.call(result, 'diagnostics')).toBe(false)
      })

      it('should emit UNINDEXED_TAG_PREFIX when query targets an unindexed alert tag', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(emptyResponse)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'source:alert monitor_priority:P1',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          defaultLimits,
          defaultSite
        )

        const codes = result.diagnostics?.map((d) => d.code) ?? []
        expect(codes).toContain('UNINDEXED_TAG_PREFIX')
      })

      it('should emit UNINDEXED_TAG_PREFIX when tags param contains an unindexed prefix', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(emptyResponse)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'source:alert',
            tags: ['notification_preset:critical-pager'],
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          defaultLimits,
          defaultSite
        )

        const codes = result.diagnostics?.map((d) => d.code) ?? []
        expect(codes).toContain('UNINDEXED_TAG_PREFIX')
      })

      it('should emit NARROW_TIME_RANGE when range is under 5 minutes', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(emptyResponse)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'host:prod-1',
            from: '2024-01-20T10:00:00Z',
            to: '2024-01-20T10:02:00Z'
          },
          defaultLimits,
          defaultSite
        )

        const codes = result.diagnostics?.map((d) => d.code) ?? []
        expect(codes).toContain('NARROW_TIME_RANGE')
      })

      it('should emit RESTRICTIVE_SOURCE_FILTER when only source:alert is provided', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(emptyResponse)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'source:alert',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          defaultLimits,
          defaultSite
        )

        const codes = result.diagnostics?.map((d) => d.code) ?? []
        expect(codes).toContain('RESTRICTIVE_SOURCE_FILTER')
      })

      it('should NOT emit RESTRICTIVE_SOURCE_FILTER when other filters are present', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(emptyResponse)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'source:alert env:prod',
            tags: ['service:api'],
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          defaultLimits,
          defaultSite
        )

        const codes = result.diagnostics?.map((d) => d.code) ?? []
        expect(codes).not.toContain('RESTRICTIVE_SOURCE_FILTER')
      })

      it('should set a remediation hint on each diagnostic', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(emptyResponse)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'source:alert monitor_priority:P1',
            from: '2024-01-20T10:00:00Z',
            to: '2024-01-20T10:02:00Z'
          },
          defaultLimits,
          defaultSite
        )

        for (const d of result.diagnostics ?? []) {
          expect(typeof d.message).toBe('string')
          expect(d.message.length).toBeGreaterThan(0)
          expect(typeof d.hint).toBe('string')
        }
      })

      it('should run computeDiagnostics in under 5ms on typical input', () => {
        const input = {
          query: 'source:alert monitor_priority:P1 env:prod',
          tags: ['service:api', 'notification_preset:critical'],
          fromMs: Date.parse('2024-01-20T10:00:00Z'),
          toMs: Date.parse('2024-01-20T10:02:00Z')
        }

        const start = performance.now()
        const diagnostics = computeDiagnostics(input)
        const elapsed = performance.now() - start

        expect(diagnostics.length).toBeGreaterThan(0)
        expect(elapsed).toBeLessThan(5)
      })

      it('should expose the seed list of unindexed alert tag prefixes', () => {
        expect(UNINDEXED_ALERT_TAG_PREFIXES).toEqual(
          expect.arrayContaining(['monitor_priority', 'notification_preset'])
        )
      })
    })
  })

  describe('searchEventsV2 with transitionType filter', () => {
    interface CapturedBody {
      filter?: { query?: string; from?: string; to?: string }
      sort?: string
      page?: { limit?: number; cursor?: string }
    }

    /**
     * Install a handler that records the request body so the test can assert
     * the exact `filter.query` string emitted by buildEventQuery via
     * searchEventsV2. Returns a getter for the latest captured body.
     */
    function installCapturingHandler(): () => CapturedBody | undefined {
      let captured: CapturedBody | undefined
      server.use(
        http.post(endpoints.searchEvents, async ({ request }) => {
          captured = (await request.json()) as CapturedBody
          return jsonResponse(fixtures.searchV2)
        })
      )
      return () => captured
    }

    it('produces a byte-identical filter.query when transitionType is omitted (requirement 5.1)', async () => {
      // Baseline: call without transitionType
      const getBaseline = installCapturingHandler()
      await searchEventsV2(
        apiV2,
        {
          query: 'source:alert',
          tags: ['env:prod'],
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits,
        defaultSite
      )
      const baselineQuery = getBaseline()?.filter?.query
      expect(baselineQuery).toBeDefined()

      // Reset MSW handlers and install a fresh capturing handler. The second
      // call passes transitionType explicitly as undefined to prove the
      // shape is byte-identical to omission.
      server.resetHandlers()
      const getActual = installCapturingHandler()
      await searchEventsV2(
        apiV2,
        {
          query: 'source:alert',
          tags: ['env:prod'],
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z',
          transitionType: undefined
        },
        defaultLimits,
        defaultSite
      )

      expect(getActual()?.filter?.query).toBe(baselineQuery)
      // Negative guard: the additive clause must NOT appear when omitted
      expect(baselineQuery).not.toContain('@monitor.transition.transition_type')
    })

    it('produces the same filter.query for empty transitionType as for omitted transitionType', async () => {
      const getBaseline = installCapturingHandler()
      await searchEventsV2(
        apiV2,
        {
          query: 'source:alert',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits,
        defaultSite
      )
      const baselineQuery = getBaseline()?.filter?.query

      server.resetHandlers()
      const getEmpty = installCapturingHandler()
      await searchEventsV2(
        apiV2,
        {
          query: 'source:alert',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z',
          transitionType: []
        },
        defaultLimits,
        defaultSite
      )

      expect(getEmpty()?.filter?.query).toBe(baselineQuery)
      expect(getEmpty()?.filter?.query).not.toContain('@monitor.transition.transition_type')
    })

    it('appends @monitor.transition.transition_type with OR for multi-valued input', async () => {
      const getBody = installCapturingHandler()
      await searchEventsV2(
        apiV2,
        {
          query: 'source:alert',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z',
          transitionType: ['alert', 'warning']
        },
        defaultLimits,
        defaultSite
      )

      const query = getBody()?.filter?.query
      expect(query).toBeDefined()
      // Clause is present and OR'd, multi-word values that aren't here stay unquoted
      expect(query).toContain('@monitor.transition.transition_type:(alert OR warning)')
      // The original user query is preserved as a leading clause
      expect(query?.startsWith('source:alert ')).toBe(true)
    })

    it('quotes multi-word transition types like "alert recovery"', async () => {
      const getBody = installCapturingHandler()
      await searchEventsV2(
        apiV2,
        {
          query: 'source:alert',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z',
          transitionType: ['alert', 'alert recovery']
        },
        defaultLimits,
        defaultSite
      )

      const query = getBody()?.filter?.query
      expect(query).toBeDefined()
      expect(query).toContain('@monitor.transition.transition_type:(alert OR "alert recovery")')
      // Single-word values must remain unquoted in the same clause
      expect(query).not.toContain('"alert"')
    })

    it('emits a single-valued clause without an OR when only one transition type is provided', async () => {
      const getBody = installCapturingHandler()
      await searchEventsV2(
        apiV2,
        {
          query: 'source:alert',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z',
          transitionType: ['alert recovery']
        },
        defaultLimits,
        defaultSite
      )

      const query = getBody()?.filter?.query
      expect(query).toContain('@monitor.transition.transition_type:("alert recovery")')
      // With a single value there must be no ` OR ` token inside the clause
      const clauseMatch = /@monitor\.transition\.transition_type:\(([^)]*)\)/.exec(query ?? '')
      expect(clauseMatch?.[1]).toBe('"alert recovery"')
    })
  })

  describe('histogramEventsV2', () => {
    const histogramRange = {
      from: '2026-03-29T00:00:00Z',
      to: '2026-03-29T23:59:59Z'
    }

    it('should return 24-bucket UTC happy path keyed 0-23', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => jsonResponse(fixtures.eventsHistogramFixture))
      )

      const result = await histogramEventsV2(
        apiV2,
        {
          bucket_by: 'hour_of_day',
          timezone: 'UTC',
          ...histogramRange
        },
        defaultLimits,
        defaultSite
      )

      expect(result.bucketBy).toBe('hour_of_day')
      expect(result.timezone).toBe('UTC')
      // 4 events at UTC hours: 0, 1, 5, 23
      expect(result.buckets).toEqual({
        '0': 1,
        '1': 1,
        '5': 1,
        '23': 1
      })
      expect(result.totalEvents).toBe(4)
      expect(result.bucketCountIncomplete).toBeUndefined()
      expect(result.nextCursor).toBeUndefined()
      expect(result.meta.query).toBeDefined()
      expect(result.meta.from).toBe('2026-03-29T00:00:00.000Z')
      expect(result.meta.to).toBe('2026-03-29T23:59:59.000Z')
      expect(result.meta.datadog_url).toContain('app.datadoghq.com')
    })

    it('should bucket DST spring-forward correctly in Europe/Paris', async () => {
      // Europe/Paris spring-forward 2026-03-29: 02:00 local → 03:00 local.
      // The DST-boundary event at 01:30 UTC lands at 03:30 local (hour 3),
      // not 02:30 (which does not exist in local time on this day).
      server.use(
        http.post(endpoints.searchEvents, () => jsonResponse(fixtures.eventsHistogramFixture))
      )

      const result = await histogramEventsV2(
        apiV2,
        {
          bucket_by: 'hour_of_day',
          timezone: 'Europe/Paris',
          ...histogramRange
        },
        defaultLimits,
        defaultSite
      )

      // Paris-local hours for the four UTC events on 2026-03-29:
      //   00:15 UTC → 01:15 local (CET, UTC+1) → bucket 1
      //   01:30 UTC → 03:30 local (DST spring-forward) → bucket 3  ← key assertion
      //   05:00 UTC → 07:00 local (CEST, UTC+2) → bucket 7
      //   23:45 UTC → 01:45 local NEXT day (CEST) → bucket 1
      expect(result.buckets['3']).toBe(1)
      // The DST-skipped 02:00-02:59 local hour must contain zero events (or be absent).
      expect(result.buckets['2'] ?? 0).toBe(0)
      expect(result.totalEvents).toBe(4)
    })

    it('should throw EINVALID_TIMEZONE before hitting Datadog when timezone is invalid', async () => {
      let datadogHit = false
      server.use(
        http.post(endpoints.searchEvents, () => {
          datadogHit = true
          return jsonResponse(fixtures.eventsHistogramFixture)
        })
      )

      await expect(
        histogramEventsV2(
          apiV2,
          {
            bucket_by: 'hour_of_day',
            timezone: 'Not/AZone',
            ...histogramRange
          },
          defaultLimits,
          defaultSite
        )
      ).rejects.toThrow(/EINVALID_TIMEZONE/)

      expect(datadogHit).toBe(false)
    })

    it('should set bucketCountIncomplete and nextCursor when cap is reached', async () => {
      // Build a fixture where every page returns the cap and a continuation cursor
      // so the histogram loop must stop at the cap.
      const page1Events = Array.from({ length: 3 }, (_, i) => ({
        id: `evt-cap-${i}`,
        attributes: {
          title: `event ${i}`,
          message: '',
          timestamp: '2026-03-29T05:00:00.000Z',
          tags: ['source:alert']
        }
      }))

      server.use(
        http.post(endpoints.searchEvents, () =>
          jsonResponse({
            data: page1Events,
            meta: { page: { after: 'continuation-cursor-1' } }
          })
        )
      )

      const tightLimits: LimitsConfig = {
        ...defaultLimits,
        maxEventsForHistogram: 3
      }

      const result = await histogramEventsV2(
        apiV2,
        {
          bucket_by: 'hour_of_day',
          timezone: 'UTC',
          ...histogramRange
        },
        tightLimits,
        defaultSite
      )

      expect(result.totalEvents).toBe(3)
      expect(result.bucketCountIncomplete).toBe(true)
      expect(result.nextCursor).toBe('continuation-cursor-1')
      expect(result.buckets['5']).toBe(3)
    })

    it('should support day_of_week bucketing', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => jsonResponse(fixtures.eventsHistogramFixture))
      )

      const result = await histogramEventsV2(
        apiV2,
        {
          bucket_by: 'day_of_week',
          timezone: 'UTC',
          ...histogramRange
        },
        defaultLimits,
        defaultSite
      )

      // 2026-03-29 UTC is a Sunday → bucket 0 for all 4 fixture events.
      expect(result.bucketBy).toBe('day_of_week')
      expect(result.buckets['0']).toBe(4)
      expect(result.totalEvents).toBe(4)
    })

    it('should support day_of_month bucketing', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => jsonResponse(fixtures.eventsHistogramFixture))
      )

      const result = await histogramEventsV2(
        apiV2,
        {
          bucket_by: 'day_of_month',
          timezone: 'UTC',
          ...histogramRange
        },
        defaultLimits,
        defaultSite
      )

      // All fixture events fall on 2026-03-29 (UTC) → day-of-month 29.
      expect(result.bucketBy).toBe('day_of_month')
      expect(result.buckets['29']).toBe(4)
      expect(result.totalEvents).toBe(4)
    })

    it('should default timezone to UTC when omitted', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => jsonResponse(fixtures.eventsHistogramFixture))
      )

      const result = await histogramEventsV2(
        apiV2,
        {
          bucket_by: 'hour_of_day',
          ...histogramRange
        },
        defaultLimits,
        defaultSite
      )

      expect(result.timezone).toBe('UTC')
      expect(result.buckets['0']).toBe(1)
      expect(result.buckets['1']).toBe(1)
    })

    it('should forward a supplied cursor as the first page cursor', async () => {
      let observedCursor: string | undefined
      server.use(
        http.post(endpoints.searchEvents, async ({ request }) => {
          const body = (await request.json()) as { page?: { cursor?: string } }
          observedCursor = body.page?.cursor
          return jsonResponse({
            data: [],
            meta: { page: { after: null } }
          })
        })
      )

      await histogramEventsV2(
        apiV2,
        {
          bucket_by: 'hour_of_day',
          timezone: 'UTC',
          cursor: 'resume-from-here',
          ...histogramRange
        },
        defaultLimits,
        defaultSite
      )

      expect(observedCursor).toBe('resume-from-here')
    })
  })

  // Requirement 4 (timezone annotation) — `timezone` is opt-in on read actions
  // and adds sibling `*Local` ISO 8601 strings next to every existing epoch /
  // ISO timestamp. Omitting `timezone` produces today's exact response shape.
  describe('timezone annotation (Requirement 4)', () => {
    describe('events.search', () => {
      it('attaches timestampLocal to each event when timezone is provided', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(fixtures.searchV2)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'source:alert',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z',
            timezone: 'Europe/Paris'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.events.length).toBeGreaterThan(0)
        for (const event of result.events) {
          expect(typeof event.timestampLocal).toBe('string')
          // ISO 8601 with offset (or Z for UTC) — never the raw UTC trailing-Z form when zone != UTC.
          expect(event.timestampLocal).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/
          )
        }
        // 2024-01-20T10:00:00Z in Europe/Paris (CET = UTC+1) → 11:00 local
        const first = result.events[0]
        expect(first?.timestamp).toBe('2024-01-20T10:00:00.000Z')
        expect(first?.timestampLocal).toBe('2024-01-20T11:00:00+01:00')
      })

      it('does NOT add timestampLocal when timezone is omitted (byte-identical shape)', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(fixtures.searchV2)))

        const result = await searchEventsV2(
          apiV2,
          {
            query: 'source:alert',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.events.length).toBeGreaterThan(0)
        for (const event of result.events) {
          expect(Object.prototype.hasOwnProperty.call(event, 'timestampLocal')).toBe(false)
        }
      })

      it('throws EINVALID_TIMEZONE before any Datadog call when timezone is invalid', async () => {
        let hit = false
        server.use(
          http.post(endpoints.searchEvents, () => {
            hit = true
            return jsonResponse(fixtures.searchV2)
          })
        )

        await expect(
          searchEventsV2(
            apiV2,
            {
              query: 'source:alert',
              timezone: 'Not/AValidZone'
            },
            defaultLimits,
            defaultSite
          )
        ).rejects.toThrow(/EINVALID_TIMEZONE/)

        expect(hit).toBe(false)
      })
    })

    describe('events.aggregate', () => {
      it('attaches timestampLocal to each bucket sample when timezone is provided', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(fixtures.searchV2)))

        const result = await aggregateEventsV2(
          apiV2,
          {
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z',
            timezone: 'Europe/Paris'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.buckets.length).toBeGreaterThan(0)
        for (const bucket of result.buckets) {
          expect(typeof bucket.sample.timestampLocal).toBe('string')
          expect(bucket.sample.timestampLocal).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/
          )
        }
      })

      it('does NOT add timestampLocal on samples when timezone omitted', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(fixtures.searchV2)))

        const result = await aggregateEventsV2(
          apiV2,
          {
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          defaultLimits,
          defaultSite
        )

        for (const bucket of result.buckets) {
          expect(Object.prototype.hasOwnProperty.call(bucket.sample, 'timestampLocal')).toBe(false)
        }
      })

      it('throws EINVALID_TIMEZONE before any Datadog call when timezone is invalid', async () => {
        let hit = false
        server.use(
          http.post(endpoints.searchEvents, () => {
            hit = true
            return jsonResponse(fixtures.searchV2)
          })
        )

        await expect(
          aggregateEventsV2(
            apiV2,
            {
              from: '2024-01-20T00:00:00Z',
              to: '2024-01-20T23:59:59Z',
              timezone: 'Not/AZone'
            },
            defaultLimits,
            defaultSite
          )
        ).rejects.toThrow(/EINVALID_TIMEZONE/)
        expect(hit).toBe(false)
      })
    })

    describe('events.incidents', () => {
      it('attaches *Local fields to firstTrigger / lastTrigger / recoveredAt when timezone is provided', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(fixtures.searchV2)))

        const result = await incidentsEventsV2(
          apiV2,
          {
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z',
            timezone: 'Europe/Paris'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.incidents.length).toBeGreaterThan(0)
        for (const incident of result.incidents) {
          expect(typeof incident.firstTriggerLocal).toBe('string')
          expect(typeof incident.lastTriggerLocal).toBe('string')
          expect(incident.firstTriggerLocal).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/
          )
          // recoveredAtLocal only present when recoveredAt itself is present.
          if (incident.recoveredAt) {
            expect(typeof incident.recoveredAtLocal).toBe('string')
          }
          // The nested sample event must also get its own timestampLocal.
          expect(typeof incident.sample.timestampLocal).toBe('string')
        }
      })

      it('does NOT add *Local fields when timezone is omitted', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(fixtures.searchV2)))

        const result = await incidentsEventsV2(
          apiV2,
          {
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          defaultLimits,
          defaultSite
        )

        for (const incident of result.incidents) {
          expect(Object.prototype.hasOwnProperty.call(incident, 'firstTriggerLocal')).toBe(false)
          expect(Object.prototype.hasOwnProperty.call(incident, 'lastTriggerLocal')).toBe(false)
          expect(Object.prototype.hasOwnProperty.call(incident, 'recoveredAtLocal')).toBe(false)
          expect(Object.prototype.hasOwnProperty.call(incident.sample, 'timestampLocal')).toBe(
            false
          )
        }
      })
    })

    describe('events.timeseries', () => {
      it('attaches timestampLocal to each bucket when timezone is provided', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(fixtures.searchV2)))

        const result = await timeseriesEventsV2(
          apiV2,
          {
            query: 'source:alert',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z',
            interval: '1h',
            timezone: 'Europe/Paris'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.timeseries.length).toBeGreaterThan(0)
        for (const bucket of result.timeseries) {
          expect(typeof bucket.timestampLocal).toBe('string')
          expect(bucket.timestampLocal).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/
          )
        }
      })

      it('does NOT add timestampLocal when timezone is omitted (byte-identical shape)', async () => {
        server.use(http.post(endpoints.searchEvents, () => jsonResponse(fixtures.searchV2)))

        const result = await timeseriesEventsV2(
          apiV2,
          {
            query: 'source:alert',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z',
            interval: '1h'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.timeseries.length).toBeGreaterThan(0)
        for (const bucket of result.timeseries) {
          expect(Object.prototype.hasOwnProperty.call(bucket, 'timestampLocal')).toBe(false)
        }
      })

      it('throws EINVALID_TIMEZONE before any Datadog call when timezone is invalid', async () => {
        let hit = false
        server.use(
          http.post(endpoints.searchEvents, () => {
            hit = true
            return jsonResponse(fixtures.searchV2)
          })
        )

        await expect(
          timeseriesEventsV2(
            apiV2,
            {
              query: 'source:alert',
              from: '2024-01-20T00:00:00Z',
              to: '2024-01-20T23:59:59Z',
              interval: '1h',
              timezone: 'Not/AZone'
            },
            defaultLimits,
            defaultSite
          )
        ).rejects.toThrow(/EINVALID_TIMEZONE/)
        expect(hit).toBe(false)
      })
    })

    describe('events.histogram', () => {
      it('throws EINVALID_TIMEZONE on invalid zone (already validated)', async () => {
        // Sanity: histogram already validates via Task 5; this test ensures
        // the behavior is preserved under Task 6 plumbing.
        let hit = false
        server.use(
          http.post(endpoints.searchEvents, () => {
            hit = true
            return jsonResponse(fixtures.searchV2)
          })
        )

        await expect(
          histogramEventsV2(
            apiV2,
            {
              bucket_by: 'hour_of_day',
              timezone: 'Bogus/Zone',
              from: '2024-01-20T00:00:00Z',
              to: '2024-01-20T23:59:59Z'
            },
            defaultLimits,
            defaultSite
          )
        ).rejects.toThrow(/EINVALID_TIMEZONE/)
        expect(hit).toBe(false)
      })
    })
  })

  describe('pickEventFields (issue #49 field projection)', () => {
    const fullEvent = {
      id: 'evt-1',
      title: 'High error rate',
      message: 'Errors exceeded threshold',
      timestamp: '2026-05-13T12:00:00.000Z',
      priority: 'normal',
      source: 'alert',
      tags: ['env:production', 'service:api'],
      alertType: 'error',
      host: 'prod-1',
      monitorId: 12345,
      monitorInfo: undefined
    }

    it('returns the full event when fields is undefined', () => {
      expect(pickEventFields(fullEvent, undefined)).toBe(fullEvent)
    })

    it('returns the full event when fields is an empty array', () => {
      expect(pickEventFields(fullEvent, [])).toBe(fullEvent)
    })

    it('returns only the requested fields', () => {
      const projection = pickEventFields(fullEvent, ['timestamp', 'title', 'monitorId'])
      expect(projection).toEqual({
        timestamp: '2026-05-13T12:00:00.000Z',
        title: 'High error rate',
        monitorId: 12345
      })
    })

    it('silently ignores unknown field names so callers are not broken by typos', () => {
      const projection = pickEventFields(fullEvent, ['title', 'doesNotExist', 'source'])
      expect(projection).toEqual({
        title: 'High error rate',
        source: 'alert'
      })
    })

    it('preserves tags array reference when requested', () => {
      const projection = pickEventFields(fullEvent, ['tags'])
      expect(projection.tags).toBe(fullEvent.tags)
    })

    it('projects monitorMetadata from enriched events when requested', () => {
      const enrichedEvent = {
        ...fullEvent,
        monitorMetadata: {
          id: 12345,
          name: 'High error rate monitor',
          type: 'metric alert',
          message: 'Errors exceeded threshold',
          tags: ['team:platform'],
          options: {
            thresholds: { critical: 100 },
            notifyNoData: false,
            escalationMessage: ''
          }
        }
      }
      const projection = pickEventFields(enrichedEvent, ['title', 'monitorMetadata'])
      expect(projection).toEqual({
        title: 'High error rate',
        monitorMetadata: enrichedEvent.monitorMetadata
      })
      // Same-reference preservation — projection should not deep-clone the metadata.
      expect(projection.monitorMetadata).toBe(enrichedEvent.monitorMetadata)
    })
  })
})
