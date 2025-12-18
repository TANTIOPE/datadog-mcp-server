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
  searchEventsV2
} from '../../src/tools/events.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24,
  defaultLimit: 100
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

      const result = await listEventsV1(
        apiV1,
        { priority: 'normal' },
        defaultLimits
      )

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
  })
})
