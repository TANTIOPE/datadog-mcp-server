/**
 * Comprehensive async tests for monitors.ts
 * Focuses on muteMonitor/unmuteMonitor (completely untested) and additional edge cases
 */
import { describe, it, expect, vi } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { muteMonitor, unmuteMonitor } from '../../src/tools/monitors.js'

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
        updateMonitor: vi.fn().mockResolvedValue({...mockMonitor, options: {...mockMonitor.options, silenced: {}}})
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
})
