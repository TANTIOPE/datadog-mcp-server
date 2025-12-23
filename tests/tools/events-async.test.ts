import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listEventsV1,
  getEventV1,
  createEventV1,
  searchEventsV2,
  aggregateEventsV2,
  topEventsV2,
  discoverTagsV2,
  timeseriesEventsV2,
  incidentsEventsV2,
  enrichWithMonitorMetadata
} from '../../src/tools/events.js'
import { v1, v2 } from '@datadog/datadog-api-client'
import type { LimitsConfig } from '../../src/config/schema.js'
import type { EventSummaryV2 } from '../../src/tools/events.js'

// Helper to create mock limits
function createMockLimits(): LimitsConfig {
  return {
    maxResults: 100,
    maxLogLines: 500,
    defaultLimit: 25,
    maxMetricDataPoints: 1000,
    defaultTimeRangeHours: 24
  }
}

// Helper to create mock V1 event
function createMockEventV1(overrides?: Partial<v1.Event>): v1.Event {
  return {
    id: 123,
    title: 'Test Event',
    text: 'Event description',
    dateHappened: 1705320000,
    priority: 'normal',
    tags: ['env:prod'],
    alertType: 'info',
    host: 'server1',
    ...overrides
  }
}

// Helper to create mock V2 event response
function createMockEventV2(overrides?: Partial<v2.EventResponse>): v2.EventResponse {
  return {
    id: 'evt-123',
    type: 'event',
    attributes: {
      timestamp: new Date('2024-01-15T12:00:00Z'),
      message: '%%%\n[Triggered on {host:web-1}] Monitor Alert\n\n[[Monitor](/monitors/12345)]',
      tags: ['source:alert', 'priority:normal', 'host:web-1', 'alert_type:error'],
      ...overrides?.attributes
    },
    ...overrides
  }
}

// Helper to create mock EventSummaryV2
function createMockEventSummary(overrides?: Partial<EventSummaryV2>): EventSummaryV2 {
  return {
    id: 'evt-123',
    title: '[Triggered on {host:web-1}] Monitor Alert',
    message: 'message',
    timestamp: '2024-01-15T12:00:00.000Z',
    priority: 'normal',
    source: 'alert',
    tags: ['source:alert'],
    alertType: 'error',
    host: 'web-1',
    monitorId: 12345,
    monitorInfo: {
      name: 'Monitor Alert',
      status: 'Triggered',
      scope: 'host:web-1'
    },
    ...overrides
  }
}

describe('Events V1 API Functions', () => {
  let limits: LimitsConfig

  beforeEach(() => {
    limits = createMockLimits()
  })

  describe('listEventsV1', () => {
    it('should list events with default params', async () => {
      const mockApi = {
        listEvents: vi.fn().mockResolvedValue({
          events: [createMockEventV1(), createMockEventV1({ id: 456 })]
        })
      } as unknown as v1.EventsApi

      const result = await listEventsV1(mockApi, {}, limits)

      expect(mockApi.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 'normal',
          unaggregated: true
        })
      )
      expect(result.events).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should apply query filter client-side', async () => {
      const mockApi = {
        listEvents: vi.fn().mockResolvedValue({
          events: [
            createMockEventV1({ title: 'High CPU' }),
            createMockEventV1({ title: 'Low Memory' }),
            createMockEventV1({ text: 'CPU usage high' })
          ]
        })
      } as unknown as v1.EventsApi

      const result = await listEventsV1(mockApi, { query: 'CPU' }, limits)

      expect(result.events).toHaveLength(2)
      expect(result.events[0].title).toContain('CPU')
      expect(result.events[1].text).toContain('CPU')
    })

    it('should respect limit parameter', async () => {
      const mockApi = {
        listEvents: vi.fn().mockResolvedValue({
          events: [
            createMockEventV1({ id: 1 }),
            createMockEventV1({ id: 2 }),
            createMockEventV1({ id: 3 }),
            createMockEventV1({ id: 4 }),
            createMockEventV1({ id: 5 })
          ]
        })
      } as unknown as v1.EventsApi

      const result = await listEventsV1(mockApi, { limit: 3 }, limits)

      expect(result.events).toHaveLength(3)
    })

    it('should pass priority parameter', async () => {
      const mockApi = {
        listEvents: vi.fn().mockResolvedValue({ events: [] })
      } as unknown as v1.EventsApi

      await listEventsV1(mockApi, { priority: 'low' }, limits)

      expect(mockApi.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 'low'
        })
      )
    })

    it('should pass sources and tags as CSV', async () => {
      const mockApi = {
        listEvents: vi.fn().mockResolvedValue({ events: [] })
      } as unknown as v1.EventsApi

      await listEventsV1(
        mockApi,
        {
          sources: ['datadog', 'nagios'],
          tags: ['env:prod', 'team:backend']
        },
        limits
      )

      expect(mockApi.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: 'datadog,nagios',
          tags: 'env:prod,team:backend'
        })
      )
    })

    it('should handle empty events', async () => {
      const mockApi = {
        listEvents: vi.fn().mockResolvedValue({ events: [] })
      } as unknown as v1.EventsApi

      const result = await listEventsV1(mockApi, {}, limits)

      expect(result.events).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('getEventV1', () => {
    it('should get event by ID', async () => {
      const mockEvent = createMockEventV1({ id: 12345 })
      const mockApi = {
        getEvent: vi.fn().mockResolvedValue({ event: mockEvent })
      } as unknown as v1.EventsApi

      const result = await getEventV1(mockApi, '12345')

      expect(mockApi.getEvent).toHaveBeenCalledWith({ eventId: 12345 })
      expect(result.event.id).toBe(12345)
    })

    it('should throw error for invalid ID', async () => {
      const mockApi = {} as v1.EventsApi

      await expect(getEventV1(mockApi, 'invalid')).rejects.toThrow('Invalid event ID')
    })

    it('should throw error for NaN ID', async () => {
      const mockApi = {} as v1.EventsApi

      await expect(getEventV1(mockApi, 'abc')).rejects.toThrow('Invalid event ID')
    })
  })

  describe('createEventV1', () => {
    it('should create event with required fields', async () => {
      const mockApi = {
        createEvent: vi.fn().mockResolvedValue({
          event: { id: 999, title: 'New Event' },
          status: 'ok'
        })
      } as unknown as v1.EventsApi

      const result = await createEventV1(mockApi, {
        title: 'New Event',
        text: 'Event text'
      })

      expect(mockApi.createEvent).toHaveBeenCalledWith({
        body: {
          title: 'New Event',
          text: 'Event text',
          priority: 'normal',
          tags: undefined,
          alertType: 'info'
        }
      })
      expect(result.success).toBe(true)
      expect(result.event.id).toBe(999)
    })

    it('should create event with all optional fields', async () => {
      const mockApi = {
        createEvent: vi.fn().mockResolvedValue({
          event: { id: 888 },
          status: 'ok'
        })
      } as unknown as v1.EventsApi

      await createEventV1(mockApi, {
        title: 'Alert',
        text: 'Alert text',
        priority: 'low',
        tags: ['env:prod'],
        alertType: 'error'
      })

      expect(mockApi.createEvent).toHaveBeenCalledWith({
        body: {
          title: 'Alert',
          text: 'Alert text',
          priority: 'low',
          tags: ['env:prod'],
          alertType: 'error'
        }
      })
    })

    it('should default alert type to info', async () => {
      const mockApi = {
        createEvent: vi.fn().mockResolvedValue({
          event: {},
          status: 'ok'
        })
      } as unknown as v1.EventsApi

      await createEventV1(mockApi, {
        title: 'Test',
        text: 'Test'
      })

      expect(mockApi.createEvent).toHaveBeenCalledWith({
        body: expect.objectContaining({
          alertType: 'info'
        })
      })
    })
  })
})

describe('Events V2 API Functions', () => {
  let limits: LimitsConfig

  beforeEach(() => {
    limits = createMockLimits()
  })

  describe('searchEventsV2', () => {
    it('should search events with basic query', async () => {
      const mockResponse = {
        data: [createMockEventV2(), createMockEventV2({ id: 'evt-456' })],
        meta: { page: {} }
      }
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue(mockResponse)
      } as unknown as v2.EventsApi

      const result = await searchEventsV2(mockApi, { query: 'error' }, limits, 'datadoghq.com')

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: 'error'
          }),
          sort: 'timestamp',
          page: { limit: 25, cursor: undefined }
        })
      })
      expect(result.events).toHaveLength(2)
      expect(result.meta.query).toBe('error')
    })

    it('should respect limit parameter', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      await searchEventsV2(mockApi, { limit: 50 }, limits, 'datadoghq.com')

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          page: { limit: 50, cursor: undefined }
        })
      })
    })

    it('should pass cursor for pagination', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      await searchEventsV2(mockApi, { cursor: 'abc123' }, limits, 'datadoghq.com')

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          page: expect.objectContaining({
            cursor: 'abc123'
          })
        })
      })
    })

    it('should return nextCursor from response', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: [createMockEventV2()],
          meta: { page: { after: 'next-cursor-123' } }
        })
      } as unknown as v2.EventsApi

      const result = await searchEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.meta.nextCursor).toBe('next-cursor-123')
    })

    it('should build query with sources', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      await searchEventsV2(mockApi, { sources: ['alert', 'monitor'] }, limits, 'datadoghq.com')

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: '(source:alert OR source:monitor)'
          })
        })
      })
    })

    it('should build query with tags and priority', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      await searchEventsV2(
        mockApi,
        {
          tags: ['env:prod'],
          priority: 'normal'
        },
        limits,
        'datadoghq.com'
      )

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: expect.stringContaining('env:prod')
          })
        })
      })
    })

    it('should build datadog URL', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      const result = await searchEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.meta.datadog_url).toContain('datadoghq.com')
    })

    it('should handle empty results', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      const result = await searchEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.events).toEqual([])
      expect(result.meta.count).toBe(0)
    })
  })

  describe('aggregateEventsV2', () => {
    it('should aggregate events by monitor_name', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            message: '%%%\nMonitor A\n\nDetails',
            tags: ['source:alert']
          }
        }),
        createMockEventV2({
          attributes: {
            message: '%%%\nMonitor A\n\nDetails',
            tags: ['source:alert']
          }
        }),
        createMockEventV2({
          attributes: {
            message: '%%%\nMonitor B\n\nDetails',
            tags: ['source:alert']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await aggregateEventsV2(
        mockApi,
        { groupBy: ['monitor_name'] },
        limits,
        'datadoghq.com'
      )

      expect(result.buckets).toHaveLength(2)
      expect(result.buckets[0].count).toBe(2)
      expect(result.buckets[0].key).toBe('Monitor A')
      expect(result.buckets[1].count).toBe(1)
      expect(result.buckets[1].key).toBe('Monitor B')
    })

    it('should aggregate with multiple pages', async () => {
      const page1Events = [createMockEventV2({ id: 'evt-1' })]
      const page2Events = [createMockEventV2({ id: 'evt-2' })]

      const mockApi = {
        searchEvents: vi
          .fn()
          .mockResolvedValueOnce({
            data: page1Events,
            meta: { page: { after: 'cursor-123' } }
          })
          .mockResolvedValueOnce({
            data: page2Events,
            meta: { page: {} }
          })
      } as unknown as v2.EventsApi

      const result = await aggregateEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(mockApi.searchEvents).toHaveBeenCalledTimes(2)
      expect(result.meta.totalEvents).toBe(2)
    })

    it('should sort buckets by count descending', async () => {
      const mockEvents = [
        createMockEventV2({ attributes: { message: 'Monitor A' } }),
        createMockEventV2({ attributes: { message: 'Monitor B' } }),
        createMockEventV2({ attributes: { message: 'Monitor B' } }),
        createMockEventV2({ attributes: { message: 'Monitor B' } })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await aggregateEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.buckets[0].count).toBe(3) // Monitor B (most frequent)
      expect(result.buckets[1].count).toBe(1) // Monitor A
    })

    it('should respect limit parameter', async () => {
      const mockEvents = Array.from({ length: 10 }, (_, i) =>
        createMockEventV2({ attributes: { message: `Monitor ${i}` } })
      )

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await aggregateEventsV2(mockApi, { limit: 5 }, limits, 'datadoghq.com')

      expect(result.buckets.length).toBeLessThanOrEqual(5)
    })

    it('should handle empty results', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      const result = await aggregateEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.buckets).toEqual([])
      expect(result.meta.totalGroups).toBe(0)
      expect(result.meta.totalEvents).toBe(0)
    })

    it('should aggregate by multiple fields', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'priority:normal']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await aggregateEventsV2(
        mockApi,
        { groupBy: ['monitor_name', 'priority'] },
        limits,
        'datadoghq.com'
      )

      expect(result.buckets[0].key).toContain('|')
    })
  })

  describe('discoverTagsV2', () => {
    it('should extract and sort tag prefixes from events', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            tags: ['source:alert', 'queue:tasks', 'service:api', 'monitor:123']
          }
        }),
        createMockEventV2({
          attributes: {
            tags: ['source:alert', 'queue:orders', 'ingress:backoffice']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await discoverTagsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.tagPrefixes).toEqual(['ingress', 'monitor', 'queue', 'service', 'source'])
      expect(result.sampleSize).toBe(2)
    })

    it('should deduplicate tag prefixes', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: { tags: ['queue:tasks', 'queue:orders'] }
        }),
        createMockEventV2({
          attributes: { tags: ['queue:emails'] }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await discoverTagsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.tagPrefixes).toEqual(['queue'])
    })

    it('should ignore tags without colons', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: { tags: ['source:alert', 'no-colon-tag', 'service:api'] }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await discoverTagsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.tagPrefixes).toEqual(['service', 'source'])
    })

    it('should handle empty events list', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await discoverTagsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.tagPrefixes).toEqual([])
      expect(result.sampleSize).toBe(0)
    })

    it('should call searchEventsV2 with limit 200', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      await discoverTagsV2(mockApi, { query: 'test' }, limits, 'datadoghq.com')

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          page: { limit: 200 }
        })
      })
    })

    it('should pass through query parameters', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      await discoverTagsV2(
        mockApi,
        {
          query: 'source:alert',
          from: '2024-01-01T00:00:00Z',
          to: '2024-01-02T00:00:00Z',
          tags: ['priority:high']
        },
        limits,
        'datadoghq.com'
      )

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: 'source:alert priority:high',
            from: '2024-01-01T00:00:00.000Z',
            to: '2024-01-02T00:00:00.000Z'
          })
        })
      })
    })
  })

  describe('topEventsV2', () => {
    it('should return top events with default query', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: { message: 'Monitor A', tags: ['source:alert', 'queue:tasks'] }
        }),
        createMockEventV2({
          attributes: { message: 'Monitor A', tags: ['source:alert', 'queue:tasks'] }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await topEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.top).toBeDefined()
      expect(result.top[0].rank).toBe(1)
      expect(result.top[0].total_count).toBe(2)
    })

    it('should default to source:alert query', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      await topEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: expect.stringContaining('source:alert')
          })
        })
      })
    })

    it('should use default maxEvents of 5000', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      await topEventsV2(mockApi, { limit: 5 }, limits, 'datadoghq.com')

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          page: { limit: 5000 }
        })
      })
    })

    it('should respect maxEvents parameter', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      await topEventsV2(mockApi, { maxEvents: 5000 }, limits, 'datadoghq.com')

      expect(mockApi.searchEvents).toHaveBeenCalledWith({
        body: expect.objectContaining({
          page: { limit: 5000 }
        })
      })
    })

    it('should extract context tags and populate by_context array', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'queue:tasks', 'service:api', 'monitor_id:123']
          }
        }),
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'queue:orders', 'monitor_id:123']
          }
        }),
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'queue:tasks', 'monitor_id:123']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await topEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.top).toHaveLength(1)
      expect(result.top[0].by_context).toEqual([
        { context: 'queue:tasks', count: 2 },
        { context: 'queue:orders', count: 1 }
      ])
    })

    it('should respect custom contextTags parameter', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'custom_tag:value1', 'monitor_id:123']
          }
        }),
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'custom_tag:value2', 'monitor_id:123']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await topEventsV2(
        mockApi,
        { contextTags: ['custom_tag'] },
        limits,
        'datadoghq.com'
      )

      expect(result.top[0].by_context).toEqual([
        { context: 'custom_tag:value1', count: 1 },
        { context: 'custom_tag:value2', count: 1 }
      ])
    })

    it('should filter out monitors without matching context tags', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'unrelated:tag', 'monitor_id:123']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await topEventsV2(mockApi, {}, limits, 'datadoghq.com')

      // Monitors without context tags should be filtered out
      expect(result.top).toEqual([])
    })

    it('should group multiple monitors with different contexts', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'queue:tasks', 'monitor_id:123']
          }
        }),
        createMockEventV2({
          attributes: {
            message: 'Monitor B',
            tags: ['source:alert', 'service:api', 'monitor_id:456']
          }
        }),
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'queue:tasks', 'monitor_id:123']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await topEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.top).toHaveLength(2)
      expect(result.top[0].total_count).toBe(2) // Monitor A
      expect(result.top[0].by_context).toEqual([{ context: 'queue:tasks', count: 2 }])
      expect(result.top[1].total_count).toBe(1) // Monitor B
      expect(result.top[1].by_context).toEqual([{ context: 'service:api', count: 1 }])
    })

    it('should prioritize context tags in order (queue > service > ingress)', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            message: 'Monitor A',
            tags: ['source:alert', 'queue:tasks', 'service:api', 'ingress:web', 'monitor_id:123']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await topEventsV2(mockApi, {}, limits, 'datadoghq.com')

      // Should use queue (first in priority), not service or ingress
      expect(result.top[0].by_context).toEqual([{ context: 'queue:tasks', count: 1 }])
    })
  })

  describe('timeseriesEventsV2', () => {
    it('should bucket events by time interval', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:00:00Z'),
            message: 'Monitor A',
            tags: ['source:alert']
          }
        }),
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T13:00:00Z'),
            message: 'Monitor A',
            tags: ['source:alert']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await timeseriesEventsV2(mockApi, { interval: '1h' }, limits, 'datadoghq.com')

      expect(result.timeseries).toBeDefined()
      expect(result.timeseries.length).toBeGreaterThan(0)
      expect(result.timeseries[0].total).toBeDefined()
      expect(result.timeseries[0].counts).toBeDefined()
    })

    it('should parse interval to milliseconds', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      const result = await timeseriesEventsV2(mockApi, { interval: '4h' }, limits, 'datadoghq.com')

      expect(result.meta.intervalMs).toBe(14400000) // 4 hours in ms
    })

    it('should sort buckets by timestamp', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T14:00:00Z'),
            tags: ['source:alert']
          }
        }),
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:00:00Z'),
            tags: ['source:alert']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await timeseriesEventsV2(mockApi, {}, limits, 'datadoghq.com')

      // Buckets should be sorted by timestamp ascending
      for (let i = 1; i < result.timeseries.length; i++) {
        expect(result.timeseries[i].timestampMs).toBeGreaterThanOrEqual(
          result.timeseries[i - 1].timestampMs
        )
      }
    })

    it('should handle empty results', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      const result = await timeseriesEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.timeseries).toEqual([])
      expect(result.meta.totalEvents).toBe(0)
    })
  })

  describe('incidentsEventsV2', () => {
    it('should deduplicate trigger events within window', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:00:00Z'),
            message: '%%%\n[Triggered] Monitor A\n\nDetails',
            tags: ['source:alert']
          }
        }),
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:02:00Z'),
            message: '%%%\n[Triggered] Monitor A\n\nDetails',
            tags: ['source:alert']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await incidentsEventsV2(
        mockApi,
        { dedupeWindow: '5m' },
        limits,
        'datadoghq.com'
      )

      expect(result.incidents).toHaveLength(1)
      expect(result.incidents[0].triggerCount).toBe(2)
    })

    it('should create separate incidents outside dedupe window', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:00:00Z'),
            message: '%%%\n[Triggered] Monitor A\n\nDetails',
            tags: ['source:alert']
          }
        }),
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:10:00Z'),
            message: '%%%\n[Triggered] Monitor A\n\nDetails',
            tags: ['source:alert']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await incidentsEventsV2(
        mockApi,
        { dedupeWindow: '5m' },
        limits,
        'datadoghq.com'
      )

      expect(result.incidents).toHaveLength(2)
    })

    it('should mark incidents as recovered', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:00:00Z'),
            message: '%%%\n[Triggered] Monitor A\n\nDetails',
            tags: ['source:alert', 'alert_type:error']
          }
        }),
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:05:00Z'),
            message: '%%%\n[Recovered] Monitor A\n\nDetails',
            tags: ['source:alert', 'alert_type:success']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await incidentsEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.incidents[0].recovered).toBe(true)
      expect(result.incidents[0].recoveredAt).toBeDefined()
      expect(result.incidents[0].duration).toBeDefined()
    })

    it('should calculate duration correctly', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:00:00Z'),
            message: '%%%\n[Triggered] Monitor A\n\nDetails',
            tags: ['source:alert', 'alert_type:error']
          }
        }),
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:02:30Z'),
            message: '%%%\n[Recovered] Monitor A\n\nDetails',
            tags: ['source:alert', 'alert_type:success']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await incidentsEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.incidents[0].duration).toBe('3m') // 2 minutes 30 seconds → 3m (rounded)
    })

    it('should handle empty results', async () => {
      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({ data: [], meta: { page: {} } })
      } as unknown as v2.EventsApi

      const result = await incidentsEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.incidents).toEqual([])
      expect(result.meta.totalIncidents).toBe(0)
    })

    it('should count active vs recovered incidents', async () => {
      const mockEvents = [
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:00:00Z'),
            message: '%%%\n[Triggered] Monitor A\n\nDetails',
            tags: ['source:alert']
          }
        }),
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:05:00Z'),
            message: '%%%\n[Recovered] Monitor A\n\nDetails',
            tags: ['source:alert', 'alert_type:success']
          }
        }),
        createMockEventV2({
          attributes: {
            timestamp: new Date('2024-01-15T12:10:00Z'),
            message: '%%%\n[Triggered] Monitor B\n\nDetails',
            tags: ['source:alert']
          }
        })
      ]

      const mockApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const result = await incidentsEventsV2(mockApi, {}, limits, 'datadoghq.com')

      expect(result.meta.recoveredCount).toBe(1)
      expect(result.meta.activeCount).toBe(1)
    })
  })

  describe('enrichWithMonitorMetadata', () => {
    it('should enrich events with monitor metadata', async () => {
      const events = [
        createMockEventSummary({
          monitorInfo: { name: 'Test Monitor', status: 'triggered', scope: '' }
        })
      ]

      const mockMonitorsApi = {
        listMonitors: vi.fn().mockResolvedValue([
          {
            id: 12345,
            name: 'Test Monitor',
            type: 'metric alert',
            message: 'Alert message',
            tags: ['team:backend'],
            options: {
              thresholds: { critical: 90 },
              notifyNoData: true
            }
          }
        ])
      } as unknown as v1.MonitorsApi

      const result = await enrichWithMonitorMetadata(events, mockMonitorsApi)

      expect(result[0].monitorMetadata).toBeDefined()
      expect(result[0].monitorMetadata?.id).toBe(12345)
      expect(result[0].monitorMetadata?.type).toBe('metric alert')
      expect(result[0].monitorMetadata?.tags).toEqual(['team:backend'])
    })

    it('should handle monitor fetch failure gracefully', async () => {
      const events = [createMockEventSummary()]

      const mockMonitorsApi = {
        listMonitors: vi.fn().mockRejectedValue(new Error('API error'))
      } as unknown as v1.MonitorsApi

      const result = await enrichWithMonitorMetadata(events, mockMonitorsApi)

      expect(result).toEqual(events)
      expect(result[0].monitorMetadata).toBeUndefined()
    })

    it('should handle events without monitorInfo', async () => {
      const events = [createMockEventSummary({ monitorInfo: undefined })]

      const mockMonitorsApi = {
        listMonitors: vi.fn().mockResolvedValue([])
      } as unknown as v1.MonitorsApi

      const result = await enrichWithMonitorMetadata(events, mockMonitorsApi)

      expect(result[0].monitorMetadata).toBeUndefined()
    })

    it('should cache monitors by ID', async () => {
      const events = [
        createMockEventSummary({
          monitorId: 123
        }),
        createMockEventSummary({
          monitorId: 123
        })
      ]

      const mockMonitorsApi = {
        listMonitors: vi.fn().mockResolvedValue([
          {
            id: 123,
            name: 'Monitor A',
            type: 'metric alert'
          }
        ])
      } as unknown as v1.MonitorsApi

      const result = await enrichWithMonitorMetadata(events, mockMonitorsApi)

      expect(mockMonitorsApi.listMonitors).toHaveBeenCalledTimes(1)
      expect(result[0].monitorMetadata?.id).toBe(123)
      expect(result[1].monitorMetadata?.id).toBe(123)
    })
  })
})
