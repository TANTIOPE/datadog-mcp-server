import { describe, it, expect } from 'vitest'
import {
  extractMonitorInfo,
  extractTitleFromMessage,
  extractMonitorIdFromMessage,
  buildGroupKey,
  formatEventV1,
  formatEventV2,
  buildEventQuery,
  parseIntervalToMs,
  findFirstContextTag,
  type EventSummaryV2
} from '../../src/tools/events.js'
import type { v1, v2 } from '@datadog/datadog-api-client'

describe('Events Helper Functions', () => {
  describe('extractMonitorInfo', () => {
    it('should extract status and name from title', () => {
      const result = extractMonitorInfo('[Triggered] CPU usage high')

      expect(result).toEqual({
        status: 'Triggered',
        scope: '',
        name: 'CPU usage high',
        priority: undefined
      })
    })

    it('should extract status with scope', () => {
      const result = extractMonitorInfo('[Alert on {host:prod}] Disk full')

      expect(result).toEqual({
        status: 'Alert',
        scope: 'host:prod',
        name: 'Disk full',
        priority: undefined
      })
    })

    it('should extract priority prefix', () => {
      const result = extractMonitorInfo('[P1] [Triggered] Critical alert')

      expect(result).toEqual({
        status: 'Triggered',
        scope: '',
        name: 'Critical alert',
        priority: 'P1'
      })
    })

    it('should extract priority and scope', () => {
      const result = extractMonitorInfo('[P2] [Alert on {env:staging}] API error rate high')

      expect(result).toEqual({
        status: 'Alert',
        scope: 'env:staging',
        name: 'API error rate high',
        priority: 'P2'
      })
    })

    it('should handle Recovered status', () => {
      const result = extractMonitorInfo('[Recovered] Service is back')

      expect(result.status).toBe('Recovered')
    })

    it('should handle Warn status', () => {
      const result = extractMonitorInfo('[Warn] Memory usage elevated')

      expect(result.status).toBe('Warn')
    })

    it('should handle OK status', () => {
      const result = extractMonitorInfo('[OK] All systems operational')

      expect(result.status).toBe('OK')
    })

    it('should handle No Data status', () => {
      const result = extractMonitorInfo('[No Data] Monitor stopped receiving data')

      expect(result.status).toBe('No Data')
    })

    it('should handle Re-Triggered status', () => {
      const result = extractMonitorInfo('[Re-Triggered] Alert re-triggered')

      expect(result.status).toBe('Re-Triggered')
    })

    it('should handle Renotify status', () => {
      const result = extractMonitorInfo('[Renotify] Reminder: issue persists')

      expect(result.status).toBe('Renotify')
    })

    it('should be case-insensitive', () => {
      const result = extractMonitorInfo('[TRIGGERED on {HOST:prod}] Error')

      expect(result.status).toBe('TRIGGERED')
      expect(result.scope).toBe('HOST:prod')
    })

    it('should return original title if no match', () => {
      const result = extractMonitorInfo('Plain text title')

      expect(result).toEqual({
        status: '',
        scope: '',
        name: 'Plain text title',
        priority: undefined
      })
    })

    it('should trim whitespace from name', () => {
      const result = extractMonitorInfo('[Triggered]   CPU usage   ')

      expect(result.name).toBe('CPU usage')
    })
  })

  describe('extractTitleFromMessage', () => {
    it('should extract first line from message', () => {
      const message = '%%%\nHigh CPU usage detected\n\nAdditional details here...'
      const result = extractTitleFromMessage(message)

      expect(result).toBe('High CPU usage detected')
    })

    it('should handle message without %%% delimiter', () => {
      const message = 'Simple title\nDetails...'
      const result = extractTitleFromMessage(message)

      expect(result).toBe('Simple title')
    })

    it('should trim whitespace', () => {
      const message = '%%%\n  Title with spaces  \n\nContent'
      const result = extractTitleFromMessage(message)

      expect(result).toBe('Title with spaces')
    })

    it('should remove trailing exclamation marks', () => {
      const message = 'Alert title !\n'
      const result = extractTitleFromMessage(message)

      expect(result).toBe('Alert title')
    })

    it('should handle empty message', () => {
      const result = extractTitleFromMessage('')

      expect(result).toBe('')
    })

    it('should handle message with only %%%', () => {
      const message = '%%%\n'
      const result = extractTitleFromMessage(message)

      expect(result).toBe('')
    })

    it('should handle single-line message', () => {
      const message = 'Single line title'
      const result = extractTitleFromMessage(message)

      expect(result).toBe('Single line title')
    })
  })

  describe('extractMonitorIdFromMessage', () => {
    it('should extract monitor ID from message', () => {
      const message = 'Check [[Monitor Status](/monitors/12345?from_ts=...)]'
      const result = extractMonitorIdFromMessage(message)

      expect(result).toBe(12345)
    })

    it('should extract monitor ID from plain URL', () => {
      const message = 'See /monitors/67890 for details'
      const result = extractMonitorIdFromMessage(message)

      expect(result).toBe(67890)
    })

    it('should return undefined for empty message', () => {
      const result = extractMonitorIdFromMessage('')

      expect(result).toBeUndefined()
    })

    it('should return undefined if no monitor ID found', () => {
      const message = 'Message without monitor link'
      const result = extractMonitorIdFromMessage(message)

      expect(result).toBeUndefined()
    })

    it('should return undefined for invalid numeric ID', () => {
      const message = '/monitors/not-a-number'
      const result = extractMonitorIdFromMessage(message)

      expect(result).toBeUndefined()
    })

    it('should extract first monitor ID when multiple present', () => {
      const message = 'First: /monitors/111, Second: /monitors/222'
      const result = extractMonitorIdFromMessage(message)

      expect(result).toBe(111)
    })
  })

  describe('buildGroupKey', () => {
    const baseEvent: EventSummaryV2 = {
      id: '',
      title: 'Test Event',
      message: '',
      timestamp: '',
      priority: 'normal',
      source: 'datadog',
      tags: ['env:prod', 'team:backend'],
      alertType: 'error',
      host: 'server1',
      monitorInfo: {
        status: 'triggered',
        scope: 'host:prod',
        name: 'Monitor Name',
        priority: 'P1'
      },
      monitorId: 12345
    }

    it('should build key for monitor_name', () => {
      const result = buildGroupKey(baseEvent, ['monitor_name'])

      expect(result).toBe('Monitor Name')
    })

    it('should build key for monitor_id', () => {
      const result = buildGroupKey(baseEvent, ['monitor_id'])

      expect(result).toBe('12345')
    })

    it('should build key for priority', () => {
      const result = buildGroupKey(baseEvent, ['priority'])

      expect(result).toBe('P1')
    })

    it('should build key for source', () => {
      const result = buildGroupKey(baseEvent, ['source'])

      expect(result).toBe('datadog')
    })

    it('should build key for alert_type', () => {
      const result = buildGroupKey(baseEvent, ['alert_type'])

      expect(result).toBe('error')
    })

    it('should build key for status', () => {
      const result = buildGroupKey(baseEvent, ['status'])

      expect(result).toBe('triggered')
    })

    it('should build key for host', () => {
      const result = buildGroupKey(baseEvent, ['host'])

      expect(result).toBe('server1')
    })

    it('should build composite key with multiple fields', () => {
      const result = buildGroupKey(baseEvent, ['monitor_name', 'priority', 'source'])

      expect(result).toBe('Monitor Name|P1|datadog')
    })

    it('should extract tag values for unknown fields', () => {
      const result = buildGroupKey(baseEvent, ['env', 'team'])

      expect(result).toBe('prod|backend')
    })

    it('should handle missing monitorInfo', () => {
      const event = { ...baseEvent, monitorInfo: undefined }
      const result = buildGroupKey(event, ['monitor_name', 'status'])

      expect(result).toBe('Test Event|')
    })

    it('should handle missing monitorId', () => {
      const event = { ...baseEvent, monitorId: undefined }
      const result = buildGroupKey(event, ['monitor_id'])

      expect(result).toBe('')
    })

    it('should handle empty groupBy array', () => {
      const result = buildGroupKey(baseEvent, [])

      expect(result).toBe('')
    })

    it('should handle tag not found', () => {
      const result = buildGroupKey(baseEvent, ['nonexistent'])

      expect(result).toBe('')
    })
  })

  describe('formatEventV1', () => {
    it('should format complete V1 event', () => {
      const event: v1.Event = {
        id: 123,
        title: 'Test Event',
        text: 'Event description',
        dateHappened: 1705320000,
        priority: 'normal' as v1.EventPriority,
        tags: ['env:prod'],
        alertType: 'error' as v1.EventAlertType,
        host: 'server1'
      }

      const result = formatEventV1(event)

      expect(result).toEqual({
        id: 123,
        title: 'Test Event',
        text: 'Event description',
        dateHappened: '2024-01-15T12:00:00.000Z',
        priority: 'normal',
        source: '',
        tags: ['env:prod'],
        alertType: 'error',
        host: 'server1'
      })
    })

    it('should handle event with sourceTypeName', () => {
      const event = {
        id: 123,
        title: 'Test',
        text: 'Text',
        sourceTypeName: 'datadog'
      } as v1.Event & { sourceTypeName?: string }

      const result = formatEventV1(event)

      expect(result.source).toBe('datadog')
    })

    it('should handle missing optional fields', () => {
      const event: Partial<v1.Event> = {}

      const result = formatEventV1(event as v1.Event)

      expect(result).toEqual({
        id: 0,
        title: '',
        text: '',
        dateHappened: '',
        priority: 'normal',
        source: '',
        tags: [],
        alertType: 'info',
        host: ''
      })
    })

    it('should convert priority to string', () => {
      const event: Partial<v1.Event> = {
        priority: 'low' as v1.EventPriority
      }

      const result = formatEventV1(event as v1.Event)

      expect(result.priority).toBe('low')
    })

    it('should handle undefined dateHappened', () => {
      const event: Partial<v1.Event> = {
        title: 'Test'
      }

      const result = formatEventV1(event as v1.Event)

      expect(result.dateHappened).toBe('')
    })
  })

  describe('formatEventV2', () => {
    it('should format complete V2 event', () => {
      const event: v2.EventResponse = {
        id: 'evt-123',
        type: 'event' as const,
        attributes: {
          timestamp: new Date('2024-01-15T12:00:00Z'),
          message: '%%%\n[Triggered] High CPU\n\nDetails...',
          tags: ['source:datadog', 'alert_type:error', 'host:server1', 'env:prod']
        }
      }

      const result = formatEventV2(event)

      expect(result).toMatchObject({
        id: 'evt-123',
        title: '[Triggered] High CPU',
        timestamp: '2024-01-15T12:00:00.000Z',
        source: 'datadog',
        alertType: 'error',
        host: 'server1',
        tags: ['source:datadog', 'alert_type:error', 'host:server1', 'env:prod']
      })
      expect(result.monitorInfo?.status).toBe('Triggered')
    })

    it('should extract title from message when title is empty', () => {
      const event: v2.EventResponse = {
        id: 'evt-123',
        attributes: {
          message: '%%%\nExtracted Title\n\nContent'
        }
      }

      const result = formatEventV2(event)

      expect(result.title).toBe('Extracted Title')
    })

    it('should extract monitor ID from message', () => {
      const event: v2.EventResponse = {
        id: 'evt-123',
        attributes: {
          message: 'Check [[Monitor](/monitors/67890)]'
        }
      }

      const result = formatEventV2(event)

      expect(result.monitorId).toBe(67890)
    })

    it('should handle timestamp as string', () => {
      const event: v2.EventResponse = {
        id: 'evt-123',
        attributes: {
          timestamp: '2024-01-15T12:00:00Z' as unknown as Date
        }
      }

      const result = formatEventV2(event)

      expect(result.timestamp).toBe('2024-01-15T12:00:00.000Z')
    })

    it('should handle timestamp as Date', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const event: v2.EventResponse = {
        id: 'evt-123',
        attributes: {
          timestamp: date
        }
      }

      const result = formatEventV2(event)

      expect(result.timestamp).toBe('2024-01-15T12:00:00.000Z')
    })

    it('should handle missing attributes', () => {
      const event: v2.EventResponse = {
        id: 'evt-123'
      }

      const result = formatEventV2(event)

      expect(result).toMatchObject({
        id: 'evt-123',
        title: '',
        message: '',
        timestamp: '',
        source: '',
        alertType: '',
        host: '',
        tags: []
      })
    })

    it('should extract source from tags', () => {
      const event: v2.EventResponse = {
        id: 'evt-123',
        attributes: {
          tags: ['source:custom-source', 'env:prod']
        }
      }

      const result = formatEventV2(event)

      expect(result.source).toBe('custom-source')
    })

    it('should extract host from tags', () => {
      const event: v2.EventResponse = {
        id: 'evt-123',
        attributes: {
          tags: ['host:myhost']
        }
      }

      const result = formatEventV2(event)

      expect(result.host).toBe('myhost')
    })

    it('should parse monitor info from title', () => {
      const event: v2.EventResponse = {
        id: 'evt-123',
        attributes: {
          message: '%%%\n[P1] [Alert on {env:prod}] Critical Issue\n\nDetails'
        }
      }

      const result = formatEventV2(event)

      expect(result.monitorInfo).toEqual({
        status: 'Alert',
        scope: 'env:prod',
        name: 'Critical Issue',
        priority: 'P1'
      })
    })
  })

  describe('buildEventQuery', () => {
    it('should build query with query param only', () => {
      const result = buildEventQuery({ query: 'status:error' })

      expect(result).toBe('status:error')
    })

    it('should build query with sources', () => {
      const result = buildEventQuery({
        sources: ['datadog', 'nagios']
      })

      expect(result).toBe('(source:datadog OR source:nagios)')
    })

    it('should build query with single source', () => {
      const result = buildEventQuery({
        sources: ['datadog']
      })

      expect(result).toBe('(source:datadog)')
    })

    it('should build query with tags', () => {
      const result = buildEventQuery({
        tags: ['env:prod', 'team:backend']
      })

      expect(result).toBe('env:prod team:backend')
    })

    it('should build query with priority', () => {
      const result = buildEventQuery({
        priority: 'high'
      })

      expect(result).toBe('priority:high')
    })

    it('should combine all parameters', () => {
      const result = buildEventQuery({
        query: 'status:error',
        sources: ['datadog', 'nagios'],
        tags: ['env:prod'],
        priority: 'high'
      })

      expect(result).toContain('status:error')
      expect(result).toContain('(source:datadog OR source:nagios)')
      expect(result).toContain('env:prod')
      expect(result).toContain('priority:high')
    })

    it('should return * for empty query', () => {
      const result = buildEventQuery({})

      expect(result).toBe('*')
    })

    it('should handle empty sources array', () => {
      const result = buildEventQuery({
        query: 'test',
        sources: []
      })

      expect(result).toBe('test')
      expect(result).not.toContain('source:')
    })

    it('should handle empty tags array', () => {
      const result = buildEventQuery({
        query: 'test',
        tags: []
      })

      expect(result).toBe('test')
    })

    it('should preserve query order', () => {
      const result = buildEventQuery({
        query: 'first',
        tags: ['second']
      })

      expect(result).toBe('first second')
    })
  })

  describe('parseIntervalToMs', () => {
    it('should parse seconds to milliseconds', () => {
      const result = parseIntervalToMs('30s')

      expect(result).toBe(30000)
    })

    it('should parse minutes to milliseconds', () => {
      const result = parseIntervalToMs('5m')

      expect(result).toBe(300000)
    })

    it('should parse hours to milliseconds', () => {
      const result = parseIntervalToMs('2h')

      expect(result).toBe(7200000)
    })

    it('should parse days to milliseconds', () => {
      const result = parseIntervalToMs('1d')

      expect(result).toBe(86400000)
    })

    it('should default to 1 hour for undefined', () => {
      const result = parseIntervalToMs(undefined)

      expect(result).toBe(3600000) // 1 hour in ms
    })

    it('should default to 1 hour for empty string', () => {
      const result = parseIntervalToMs('')

      expect(result).toBe(3600000)
    })

    it('should handle milliseconds input', () => {
      const result = parseIntervalToMs('500ms')

      expect(result).toBe(500)
    })

    it('should handle decimal values', () => {
      const result = parseIntervalToMs('1.5h')

      expect(result).toBe(5400000) // 1.5 hours
    })
  })

  describe('findFirstContextTag', () => {
    it('should find first matching context tag', () => {
      const tags = ['monitor', 'source:alert', 'queue:state-status_tasks', 'service:trusk-api']
      const prefixes = ['queue', 'service', 'ingress']

      const result = findFirstContextTag(tags, prefixes)

      expect(result).toBe('queue:state-status_tasks')
    })

    it('should find service tag when queue is not present', () => {
      const tags = ['monitor', 'source:alert', 'service:trusk-api', 'ingress:backoffice']
      const prefixes = ['queue', 'service', 'ingress']

      const result = findFirstContextTag(tags, prefixes)

      expect(result).toBe('service:trusk-api')
    })

    it('should find ingress tag', () => {
      const tags = ['monitor', 'ingress:trusk-api', 'status:5']
      const prefixes = ['queue', 'service', 'ingress']

      const result = findFirstContextTag(tags, prefixes)

      expect(result).toBe('ingress:trusk-api')
    })

    it('should return null when no matching prefix found', () => {
      const tags = ['monitor', 'source:alert', 'priority:p1']
      const prefixes = ['queue', 'service', 'ingress']

      const result = findFirstContextTag(tags, prefixes)

      expect(result).toBeNull()
    })

    it('should return null for empty tags array', () => {
      const result = findFirstContextTag([], ['queue', 'service'])

      expect(result).toBeNull()
    })

    it('should return null for empty prefixes array', () => {
      const tags = ['queue:test', 'service:api']
      const result = findFirstContextTag(tags, [])

      expect(result).toBeNull()
    })

    it('should handle pod_name and kube_namespace tags', () => {
      const tags = [
        'monitor',
        'pod_name:trusk-api-7d9f8b4c6-xyz',
        'kube_namespace:production',
        'kube_container_name:app'
      ]
      const prefixes = ['pod_name', 'kube_namespace', 'kube_container_name']

      const result = findFirstContextTag(tags, prefixes)

      expect(result).toBe('pod_name:trusk-api-7d9f8b4c6-xyz')
    })

    it('should match exact prefix with colon', () => {
      const tags = ['queued:false', 'queue:actual-queue'] // queued != queue
      const prefixes = ['queue']

      const result = findFirstContextTag(tags, prefixes)

      expect(result).toBe('queue:actual-queue')
    })

    it('should respect prefix priority order', () => {
      const tags = ['service:api', 'queue:tasks']
      const prefixes = ['service', 'queue'] // service first

      const result = findFirstContextTag(tags, prefixes)

      expect(result).toBe('service:api')
    })

    it('should respect tag order when same prefix priority', () => {
      const tags = ['service:api1', 'service:api2']
      const prefixes = ['service']

      const result = findFirstContextTag(tags, prefixes)

      expect(result).toBe('service:api1') // First in tags array
    })
  })
})
