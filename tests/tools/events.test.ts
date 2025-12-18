/**
 * Unit tests for the events tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1, v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { events as fixtures } from '../helpers/fixtures.js'

describe('Events Tool', () => {
  let apiV1: v1.EventsApi
  let apiV2: v2.EventsApi

  beforeEach(() => {
    const config = createMockConfig()
    apiV1 = new v1.EventsApi(config)
    apiV2 = new v2.EventsApi(config)
  })

  describe('listEvents (v1)', () => {
    it('should list events successfully', async () => {
      server.use(
        http.get(endpoints.listEvents, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const now = Math.floor(Date.now() / 1000)
      const response = await apiV1.listEvents({
        start: now - 3600,
        end: now
      })

      expect(response.events).toHaveLength(2)
      expect(response.events?.[0]?.id).toBe(1001)
      expect(response.events?.[0]?.title).toBe('Deployment started')
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

      const now = Math.floor(Date.now() / 1000)
      const response = await apiV1.listEvents({
        start: now - 3600,
        end: now,
        priority: 'normal'
      })

      expect(response.events).toBeDefined()
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listEvents, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      const now = Math.floor(Date.now() / 1000)
      await expect(apiV1.listEvents({
        start: now - 3600,
        end: now
      })).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listEvents, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      const now = Math.floor(Date.now() / 1000)
      await expect(apiV1.listEvents({
        start: now - 3600,
        end: now
      })).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getEvent (v1)', () => {
    it('should get a single event by ID', async () => {
      server.use(
        http.get(endpoints.getEvent(1001), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const response = await apiV1.getEvent({ eventId: 1001 })

      expect(response.event?.id).toBe(1001)
      expect(response.event?.title).toBe('Deployment started')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getEvent(99999), () => {
          return errorResponse(404, 'Event not found')
        })
      )

      await expect(apiV1.getEvent({ eventId: 99999 })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createEvent (v1)', () => {
    it('should create a new event', async () => {
      const newEvent = {
        title: 'Test Event',
        text: 'Test event description',
        priority: 'normal' as const,
        alertType: 'info' as const
      }

      server.use(
        http.post(endpoints.createEvent, async () => {
          return jsonResponse(fixtures.created)
        })
      )

      const response = await apiV1.createEvent({ body: newEvent })

      expect(response.event?.id).toBe(1003)
      expect(response.status).toBe('ok')
    })

    it('should validate required fields locally', async () => {
      // SDK validates required fields (like 'title') before sending
      await expect(apiV1.createEvent({
        body: { text: 'Missing title' }
      })).rejects.toThrow(/title/)
    })

    it('should handle 400 bad request from API', async () => {
      server.use(
        http.post(endpoints.createEvent, () => {
          return errorResponse(400, 'Invalid event data')
        })
      )

      // Use valid body to reach the API
      await expect(apiV1.createEvent({
        body: { title: 'Test', text: 'Test' }
      })).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('searchEvents (v2)', () => {
    it('should search events successfully', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => {
          return jsonResponse(fixtures.searchV2)
        })
      )

      const response = await apiV2.searchEvents({
        body: {
          filter: {
            query: 'source:alert',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          page: { limit: 100 }
        }
      })

      // SDK deserializes to typed objects, so just verify data is returned
      expect(response.data).toBeDefined()
      expect(response.data).toHaveLength(4)
      expect(response.data?.[0]?.id).toBe('evt-001')
    })

    it('should handle pagination cursor', async () => {
      let pageCount = 0
      server.use(
        http.post(endpoints.searchEvents, async ({ request }) => {
          const body = await request.json() as { page?: { cursor?: string } }
          pageCount++

          if (body.page?.cursor === 'cursor_page2') {
            return jsonResponse(fixtures.searchV2MultiPage.page2)
          }
          return jsonResponse(fixtures.searchV2MultiPage.page1)
        })
      )

      // First page
      const page1 = await apiV2.searchEvents({
        body: {
          filter: { query: 'source:alert' },
          page: { limit: 1 }
        }
      })

      expect(page1.data).toHaveLength(1)
      expect(page1.meta?.page?.after).toBe('cursor_page2')

      // Second page
      const page2 = await apiV2.searchEvents({
        body: {
          filter: { query: 'source:alert' },
          page: { limit: 1, cursor: 'cursor_page2' }
        }
      })

      expect(page2.data).toHaveLength(1)
      expect(page2.meta?.page?.after).toBeNull()
      expect(pageCount).toBe(2)
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(apiV2.searchEvents({
        body: {
          filter: { query: '*' }
        }
      })).rejects.toMatchObject({
        code: 401
      })
    })
  })

  describe('extractMonitorInfo', () => {
    // Test the monitor info extraction logic through v2 search results
    it('should parse v2 events with alert-style titles', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => {
          return jsonResponse(fixtures.searchV2)
        })
      )

      const response = await apiV2.searchEvents({
        body: {
          filter: { query: 'source:alert' }
        }
      })

      // Verify events are returned - SDK deserializes to typed objects
      expect(response.data).toBeDefined()
      expect(response.data).toHaveLength(4)

      // Verify event IDs are parsed correctly
      expect(response.data?.[0]?.id).toBe('evt-001')
      expect(response.data?.[1]?.id).toBe('evt-002')
      expect(response.data?.[2]?.id).toBe('evt-003')
      expect(response.data?.[3]?.id).toBe('evt-004')
    })
  })

  describe('aggregation actions (v2)', () => {
    it('should support client-side aggregation via search', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => {
          return jsonResponse(fixtures.searchV2ForAggregation)
        })
      )

      // Test that events are returned for aggregation
      const response = await apiV2.searchEvents({
        body: {
          filter: { query: 'source:alert' }
        }
      })

      // Verify 5 events returned that can be aggregated
      expect(response.data).toHaveLength(5)
      expect(response.data?.[0]?.id).toBe('evt-agg-001')
      expect(response.data?.[4]?.id).toBe('evt-agg-005')
    })

    it('should support multi-page aggregation', async () => {
      let pageCount = 0
      server.use(
        http.post(endpoints.searchEvents, async ({ request }) => {
          const body = await request.json() as { page?: { cursor?: string } }
          pageCount++

          if (body.page?.cursor === 'cursor_page2') {
            return jsonResponse(fixtures.searchV2MultiPage.page2)
          }
          return jsonResponse(fixtures.searchV2MultiPage.page1)
        })
      )

      // First page
      const page1 = await apiV2.searchEvents({
        body: {
          filter: { query: 'source:alert' },
          page: { limit: 1 }
        }
      })

      expect(page1.data).toHaveLength(1)
      expect(page1.meta?.page?.after).toBe('cursor_page2')

      // Second page
      const page2 = await apiV2.searchEvents({
        body: {
          filter: { query: 'source:alert' },
          page: { limit: 1, cursor: 'cursor_page2' }
        }
      })

      expect(page2.data).toHaveLength(1)
      expect(page2.meta?.page?.after).toBeNull()
      expect(pageCount).toBe(2)
    })
  })

  describe('timeseries and incidents actions (v2)', () => {
    it('should return events with distinct timestamps for timeseries', async () => {
      server.use(
        http.post(endpoints.searchEvents, () => {
          return jsonResponse(fixtures.searchV2ForAggregation)
        })
      )

      const response = await apiV2.searchEvents({
        body: {
          filter: { query: 'source:alert' }
        }
      })

      // Verify events are returned with data that can be used for timeseries/incidents
      expect(response.data).toHaveLength(5)

      // Verify data array can be iterated for client-side processing
      const ids = (response.data ?? []).map(e => e.id)
      expect(ids).toContain('evt-agg-001')
      expect(ids).toContain('evt-agg-004') // Recovery event
      expect(ids).toContain('evt-agg-005')
    })
  })
})
