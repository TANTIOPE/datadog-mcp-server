/**
 * Comprehensive async tests for monitors.ts
 * Focuses on muteMonitor/unmuteMonitor (completely untested) and additional edge cases
 */
import { describe, it, expect, vi } from 'vitest'
import { v1, v2 } from '@datadog/datadog-api-client'
import { muteMonitor, unmuteMonitor, topMonitors } from '../../src/tools/monitors.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('Monitors Async Functions', () => {
  describe('muteMonitor', () => {
    it('should mute a monitor indefinitely', async () => {
      const mockMonitor = {
        id: 123,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message',
        options: {
          notify_no_data: false,
          notify_audit: false
        }
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi.fn().mockResolvedValue(mockMonitor)
      } as unknown as v1.MonitorsApi

      const result = await muteMonitor(mockApi, '123', {})

      expect(mockApi.getMonitor).toHaveBeenCalledWith({ monitorId: 123 })
      expect(mockApi.updateMonitor).toHaveBeenCalledWith({
        monitorId: 123,
        body: {
          options: {
            notify_no_data: false,
            notify_audit: false,
            silenced: { '*': null } // Indefinite mute
          }
        }
      })
      expect(result.success).toBe(true)
      expect(result.message).toContain('123')
      expect(result.message).toContain('muted')
    })

    it('should mute a monitor until specified end time', async () => {
      const endTimestamp = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      const mockMonitor = {
        id: 456,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message',
        options: {}
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi.fn().mockResolvedValue(mockMonitor)
      } as unknown as v1.MonitorsApi

      const result = await muteMonitor(mockApi, '456', { end: endTimestamp })

      expect(mockApi.updateMonitor).toHaveBeenCalledWith({
        monitorId: 456,
        body: {
          options: {
            silenced: { '*': endTimestamp }
          }
        }
      })
      expect(result.success).toBe(true)
    })

    it('should preserve existing monitor options when muting', async () => {
      const mockMonitor = {
        id: 789,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message',
        options: {
          notify_no_data: true,
          notify_audit: true,
          require_full_window: false,
          new_group_delay: 60
        }
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi.fn().mockResolvedValue(mockMonitor)
      } as unknown as v1.MonitorsApi

      await muteMonitor(mockApi, '789', {})

      const updateCall = mockApi.updateMonitor.mock.calls[0][0]
      expect(updateCall.body.options).toMatchObject({
        notify_no_data: true,
        notify_audit: true,
        require_full_window: false,
        new_group_delay: 60,
        silenced: { '*': null }
      })
    })

    it('should handle monitor with no existing options', async () => {
      const mockMonitor = {
        id: 111,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message'
        // No options field
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi.fn().mockResolvedValue(mockMonitor)
      } as unknown as v1.MonitorsApi

      const result = await muteMonitor(mockApi, '111', {})

      expect(mockApi.updateMonitor).toHaveBeenCalledWith({
        monitorId: 111,
        body: {
          options: {
            silenced: { '*': null }
          }
        }
      })
      expect(result.success).toBe(true)
    })

    it('should handle getMonitor error', async () => {
      const mockApi = {
        getMonitor: vi.fn().mockRejectedValue(new Error('Monitor not found')),
        updateMonitor: vi.fn()
      } as unknown as v1.MonitorsApi

      await expect(muteMonitor(mockApi, '999', {})).rejects.toThrow('Monitor not found')
      expect(mockApi.updateMonitor).not.toHaveBeenCalled()
    })

    it('should handle updateMonitor error', async () => {
      const mockMonitor = {
        id: 222,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message',
        options: {}
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi.fn().mockRejectedValue(new Error('Update failed'))
      } as unknown as v1.MonitorsApi

      await expect(muteMonitor(mockApi, '222', {})).rejects.toThrow('Update failed')
    })
  })

  describe('unmuteMonitor', () => {
    it('should unmute a monitor', async () => {
      const mockMonitor = {
        id: 123,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message',
        options: {
          notify_no_data: false,
          notify_audit: false,
          silenced: { '*': null } // Currently muted
        }
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi
          .fn()
          .mockResolvedValue({ ...mockMonitor, options: { ...mockMonitor.options, silenced: {} } })
      } as unknown as v1.MonitorsApi

      const result = await unmuteMonitor(mockApi, '123')

      expect(mockApi.getMonitor).toHaveBeenCalledWith({ monitorId: 123 })
      expect(mockApi.updateMonitor).toHaveBeenCalledWith({
        monitorId: 123,
        body: {
          options: {
            notify_no_data: false,
            notify_audit: false,
            silenced: {} // Empty to unmute
          }
        }
      })
      expect(result.success).toBe(true)
      expect(result.message).toContain('123')
      expect(result.message).toContain('unmuted')
    })

    it('should preserve existing monitor options when unmuting', async () => {
      const mockMonitor = {
        id: 456,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message',
        options: {
          notify_no_data: true,
          notify_audit: true,
          require_full_window: false,
          new_group_delay: 60,
          silenced: { '*': 1234567890 }
        }
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi.fn().mockResolvedValue(mockMonitor)
      } as unknown as v1.MonitorsApi

      await unmuteMonitor(mockApi, '456')

      const updateCall = mockApi.updateMonitor.mock.calls[0][0]
      expect(updateCall.body.options).toMatchObject({
        notify_no_data: true,
        notify_audit: true,
        require_full_window: false,
        new_group_delay: 60,
        silenced: {} // Cleared
      })
    })

    it('should handle monitor with no existing options', async () => {
      const mockMonitor = {
        id: 789,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message'
        // No options field
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi.fn().mockResolvedValue(mockMonitor)
      } as unknown as v1.MonitorsApi

      const result = await unmuteMonitor(mockApi, '789')

      expect(mockApi.updateMonitor).toHaveBeenCalledWith({
        monitorId: 789,
        body: {
          options: {
            silenced: {}
          }
        }
      })
      expect(result.success).toBe(true)
    })

    it('should handle monitor that is not muted', async () => {
      const mockMonitor = {
        id: 111,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message',
        options: {
          silenced: {} // Already unmuted
        }
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi.fn().mockResolvedValue(mockMonitor)
      } as unknown as v1.MonitorsApi

      const result = await unmuteMonitor(mockApi, '111')

      // Should still call update with empty silenced
      expect(mockApi.updateMonitor).toHaveBeenCalledWith({
        monitorId: 111,
        body: {
          options: {
            silenced: {}
          }
        }
      })
      expect(result.success).toBe(true)
    })

    it('should handle getMonitor error', async () => {
      const mockApi = {
        getMonitor: vi.fn().mockRejectedValue(new Error('Monitor not found')),
        updateMonitor: vi.fn()
      } as unknown as v1.MonitorsApi

      await expect(unmuteMonitor(mockApi, '999')).rejects.toThrow('Monitor not found')
      expect(mockApi.updateMonitor).not.toHaveBeenCalled()
    })

    it('should handle updateMonitor error', async () => {
      const mockMonitor = {
        id: 222,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert message',
        options: {
          silenced: { '*': null }
        }
      }

      const mockApi = {
        getMonitor: vi.fn().mockResolvedValue(mockMonitor),
        updateMonitor: vi.fn().mockRejectedValue(new Error('Update failed'))
      } as unknown as v1.MonitorsApi

      await expect(unmuteMonitor(mockApi, '222')).rejects.toThrow('Update failed')
    })
  })

  describe('topMonitors', () => {
    const limits: LimitsConfig = {
      maxResults: 100,
      maxLogLines: 500,
      defaultLimit: 25,
      maxMetricDataPoints: 1000,
      defaultTimeRangeHours: 24
    }

    // Helper to create mock event
    function createMockEventV2(attrs: Partial<v2.EventResponseAttributes>): v2.EventResponse {
      return {
        id: 'evt-' + Math.random(),
        type: 'event',
        attributes: {
          timestamp: new Date('2024-01-15T12:00:00Z'),
          message: '%%%\n[Triggered] Monitor Alert\n\n[[Monitor](/monitors/123)]',
          tags: ['source:alert'],
          ...attrs
        }
      }
    }

    it('should group monitors by ID and fetch real names', async () => {
      const mockEvents = [
        createMockEventV2({
          message: '[[Monitor](/monitors/123)]',
          tags: ['source:alert', 'queue:tasks']
        }),
        createMockEventV2({
          message: '[[Monitor](/monitors/123)]',
          tags: ['source:alert', 'queue:tasks']
        }),
        createMockEventV2({
          message: '[[Monitor](/monitors/456)]',
          tags: ['source:alert', 'service:api']
        })
      ]

      const mockEventsApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const mockMonitorsApi = {
        getMonitor: vi.fn().mockImplementation(({ monitorId }) => {
          if (monitorId === 123) {
            return Promise.resolve({
              id: 123,
              name: 'Nginx requests on {{ingress.name}} (HTTP 5XX)',
              message: 'Alert on {{ingress.name}}'
            })
          } else if (monitorId === 456) {
            return Promise.resolve({
              id: 456,
              name: 'High error rate on {{service}}',
              message: 'Service {{service}} errors'
            })
          }
          return Promise.reject(new Error('Monitor not found'))
        })
      } as unknown as v1.MonitorsApi

      const result = await topMonitors(mockEventsApi, mockMonitorsApi, {}, limits, 'datadoghq.com')

      expect(result.top).toHaveLength(2)

      // Monitor 123 (2 events) should be first
      expect(result.top[0]).toMatchObject({
        rank: 1,
        monitor_id: 123,
        name: 'Nginx requests on {{ingress.name}} (HTTP 5XX)',
        message: 'Alert on {{ingress.name}}',
        total_count: 2,
        by_context: [{ context: 'queue:tasks', count: 2 }]
      })

      // Monitor 456 (1 event) should be second
      expect(result.top[1]).toMatchObject({
        rank: 2,
        monitor_id: 456,
        name: 'High error rate on {{service}}',
        message: 'Service {{service}} errors',
        total_count: 1,
        by_context: [{ context: 'service:api', count: 1 }]
      })

      expect(mockMonitorsApi.getMonitor).toHaveBeenCalledTimes(2)
      expect(mockMonitorsApi.getMonitor).toHaveBeenCalledWith({ monitorId: 123 })
      expect(mockMonitorsApi.getMonitor).toHaveBeenCalledWith({ monitorId: 456 })
    })

    it('should handle deleted monitors with fallback names', async () => {
      const mockEvents = [
        createMockEventV2({
          message: '[[Monitor](/monitors/999)]',
          tags: ['source:alert', 'queue:deleted']
        })
      ]

      const mockEventsApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const mockMonitorsApi = {
        getMonitor: vi.fn().mockRejectedValue(new Error('Monitor not found'))
      } as unknown as v1.MonitorsApi

      const result = await topMonitors(mockEventsApi, mockMonitorsApi, {}, limits, 'datadoghq.com')

      expect(result.top).toHaveLength(1)
      expect(result.top[0]).toMatchObject({
        rank: 1,
        monitor_id: 999,
        name: 'Monitor 999', // Fallback name
        message: '',
        total_count: 1
      })
    })

    it('should extract context breakdown with multiple contexts per monitor', async () => {
      const mockEvents = [
        createMockEventV2({
          message: '[[Monitor](/monitors/123)]',
          tags: ['source:alert', 'queue:tasks']
        }),
        createMockEventV2({
          message: '[[Monitor](/monitors/123)]',
          tags: ['source:alert', 'queue:jobs']
        }),
        createMockEventV2({
          message: '[[Monitor](/monitors/123)]',
          tags: ['source:alert', 'queue:tasks']
        })
      ]

      const mockEventsApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const mockMonitorsApi = {
        getMonitor: vi.fn().mockResolvedValue({
          id: 123,
          name: 'Queue Monitor',
          message: 'Queue alert'
        })
      } as unknown as v1.MonitorsApi

      const result = await topMonitors(mockEventsApi, mockMonitorsApi, {}, limits, 'datadoghq.com')

      expect(result.top[0].by_context).toEqual([
        { context: 'queue:tasks', count: 2 },
        { context: 'queue:jobs', count: 1 }
      ])
    })

    it('should respect custom contextTags parameter', async () => {
      const mockEvents = [
        createMockEventV2({
          message: '[[Monitor](/monitors/123)]',
          tags: ['source:alert', 'env:prod', 'team:backend', 'queue:tasks']
        })
      ]

      const mockEventsApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const mockMonitorsApi = {
        getMonitor: vi.fn().mockResolvedValue({
          id: 123,
          name: 'Test Monitor',
          message: 'Test'
        })
      } as unknown as v1.MonitorsApi

      const result = await topMonitors(
        mockEventsApi,
        mockMonitorsApi,
        { contextTags: ['env', 'team'] },
        limits,
        'datadoghq.com'
      )

      // Should use env:prod (first match in priority order)
      expect(result.top[0].by_context).toEqual([{ context: 'env:prod', count: 1 }])
      expect(result.meta.contextPrefixes).toEqual(['env', 'team'])
    })

    it('should filter out monitors without context tags', async () => {
      const mockEvents = [
        createMockEventV2({
          message: '[[Monitor](/monitors/123)]',
          tags: ['source:alert'] // No context tags
        }),
        createMockEventV2({
          message: '[[Monitor](/monitors/456)]',
          tags: ['source:alert', 'queue:tasks'] // Has context
        })
      ]

      const mockEventsApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const mockMonitorsApi = {
        getMonitor: vi.fn().mockImplementation(({ monitorId }) =>
          Promise.resolve({
            id: monitorId,
            name: `Monitor ${monitorId}`,
            message: ''
          })
        )
      } as unknown as v1.MonitorsApi

      const result = await topMonitors(mockEventsApi, mockMonitorsApi, {}, limits, 'datadoghq.com')

      // Only monitor 456 should be returned (has context tags)
      expect(result.top).toHaveLength(1)
      expect(result.top[0].monitor_id).toBe(456)
    })

    it('should respect limit parameter', async () => {
      const mockEvents = Array.from({ length: 50 }, (_, i) =>
        createMockEventV2({
          message: `[[Monitor](/monitors/${i})]`,
          tags: ['source:alert', 'queue:tasks']
        })
      )

      const mockEventsApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const mockMonitorsApi = {
        getMonitor: vi.fn().mockImplementation(({ monitorId }) =>
          Promise.resolve({
            id: monitorId,
            name: `Monitor ${monitorId}`,
            message: ''
          })
        )
      } as unknown as v1.MonitorsApi

      const result = await topMonitors(
        mockEventsApi,
        mockMonitorsApi,
        { limit: 5 },
        limits,
        'datadoghq.com'
      )

      expect(result.top).toHaveLength(5)
      expect(result.meta.totalMonitors).toBe(50)
    })

    it('should filter by tags parameter', async () => {
      const mockEvents = [
        createMockEventV2({
          message: '[[Monitor](/monitors/123)]',
          tags: ['source:alert', 'env:prod', 'queue:tasks']
        })
      ]

      const mockEventsApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: mockEvents,
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const mockMonitorsApi = {
        getMonitor: vi.fn().mockResolvedValue({
          id: 123,
          name: 'Test Monitor',
          message: 'Test'
        })
      } as unknown as v1.MonitorsApi

      await topMonitors(
        mockEventsApi,
        mockMonitorsApi,
        { tags: ['env:prod'] },
        limits,
        'datadoghq.com'
      )

      const searchCall = mockEventsApi.searchEvents.mock.calls[0][0]
      expect(searchCall.body.filter.query).toContain('env:prod')
    })

    it('should handle empty results', async () => {
      const mockEventsApi = {
        searchEvents: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.EventsApi

      const mockMonitorsApi = {
        getMonitor: vi.fn()
      } as unknown as v1.MonitorsApi

      const result = await topMonitors(mockEventsApi, mockMonitorsApi, {}, limits, 'datadoghq.com')

      expect(result.top).toEqual([])
      expect(result.meta.totalMonitors).toBe(0)
      expect(result.meta.totalEvents).toBe(0)
      expect(mockMonitorsApi.getMonitor).not.toHaveBeenCalled()
    })
  })
})
