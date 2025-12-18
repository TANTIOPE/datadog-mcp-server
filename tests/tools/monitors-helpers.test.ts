/**
 * Tests for monitors.ts helper functions
 * Focus on normalizeMonitorConfig which is completely untested (lines 146-194)
 */
import { describe, it, expect } from 'vitest'
import { normalizeMonitorConfig } from '../../src/tools/monitors.js'

describe('Monitors Helper Functions', () => {
  describe('normalizeMonitorConfig', () => {
    it('should normalize basic snake_case options to camelCase', () => {
      const config = {
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert!',
        options: {
          notify_no_data: true,
          no_data_timeframe: 60,
          new_host_delay: 300,
          evaluation_delay: 900
        }
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options).toHaveProperty('notifyNoData', true)
      expect(result.options).toHaveProperty('noDataTimeframe', 60)
      expect(result.options).toHaveProperty('newHostDelay', 300)
      expect(result.options).toHaveProperty('evaluationDelay', 900)
      expect(result.options).not.toHaveProperty('notify_no_data')
      expect(result.options).not.toHaveProperty('no_data_timeframe')
    })

    it('should normalize all option field mappings', () => {
      const config = {
        name: 'Test',
        options: {
          notify_no_data: true,
          no_data_timeframe: 60,
          new_host_delay: 300,
          new_group_delay: 60,
          evaluation_delay: 900,
          renotify_interval: 120,
          renotify_occurrences: 5,
          renotify_statuses: ['alert', 'warn'],
          timeout_h: 24,
          notify_audit: false,
          include_tags: true,
          require_full_window: false,
          escalation_message: 'Escalating!',
          locked: true,
          silenced: { '*': null }
        }
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options).toHaveProperty('notifyNoData', true)
      expect(result.options).toHaveProperty('noDataTimeframe', 60)
      expect(result.options).toHaveProperty('newHostDelay', 300)
      expect(result.options).toHaveProperty('newGroupDelay', 60)
      expect(result.options).toHaveProperty('evaluationDelay', 900)
      expect(result.options).toHaveProperty('renotifyInterval', 120)
      expect(result.options).toHaveProperty('renotifyOccurrences', 5)
      expect(result.options).toHaveProperty('renotifyStatuses', ['alert', 'warn'])
      expect(result.options).toHaveProperty('timeoutH', 24)
      expect(result.options).toHaveProperty('notifyAudit', false)
      expect(result.options).toHaveProperty('includeTags', true)
      expect(result.options).toHaveProperty('requireFullWindow', false)
      expect(result.options).toHaveProperty('escalationMessage', 'Escalating!')
      expect(result.options).toHaveProperty('locked', true)
      expect(result.options).toHaveProperty('silenced', { '*': null })
    })

    it('should preserve camelCase options if already present', () => {
      const config = {
        name: 'Test',
        options: {
          notifyNoData: true,
          notify_no_data: false // Should be kept as-is since camelCase exists
        }
      }

      const result = normalizeMonitorConfig(config)

      // If camelCase exists, snake_case is preserved (not converted)
      expect(result.options).toHaveProperty('notifyNoData', true)
      expect(result.options).toHaveProperty('notify_no_data', false)
    })

    it('should normalize nested threshold options', () => {
      const config = {
        name: 'Test',
        options: {
          thresholds: {
            critical: 90,
            warning: 75,
            ok: 50,
            critical_recovery: 80,
            warning_recovery: 65
          }
        }
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options?.thresholds).toHaveProperty('critical', 90)
      expect(result.options?.thresholds).toHaveProperty('warning', 75)
      expect(result.options?.thresholds).toHaveProperty('ok', 50)
      expect(result.options?.thresholds).toHaveProperty('criticalRecovery', 80)
      expect(result.options?.thresholds).toHaveProperty('warningRecovery', 65)
      expect(result.options?.thresholds).not.toHaveProperty('critical_recovery')
      expect(result.options?.thresholds).not.toHaveProperty('warning_recovery')
    })

    it('should preserve camelCase thresholds if already present', () => {
      const config = {
        name: 'Test',
        options: {
          thresholds: {
            criticalRecovery: 80,
            critical_recovery: 70 // Should be kept as-is since camelCase exists
          }
        }
      }

      const result = normalizeMonitorConfig(config)

      // If camelCase exists, snake_case is preserved (not converted)
      expect(result.options?.thresholds).toHaveProperty('criticalRecovery', 80)
      expect(result.options?.thresholds).toHaveProperty('critical_recovery', 70)
    })

    it('should handle config without options', () => {
      const config = {
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert!'
      }

      const result = normalizeMonitorConfig(config)

      expect(result).toEqual(config)
      expect(result.options).toBeUndefined()
    })

    it('should handle config with empty options object', () => {
      const config = {
        name: 'Test',
        options: {}
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options).toEqual({})
    })

    it('should handle options that are not an object', () => {
      const config = {
        name: 'Test',
        options: null
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options).toBeNull()
    })

    it('should handle thresholds that are not an object', () => {
      const config = {
        name: 'Test',
        options: {
          thresholds: null
        }
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options?.thresholds).toBeNull()
    })

    it('should handle empty thresholds object', () => {
      const config = {
        name: 'Test',
        options: {
          thresholds: {}
        }
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options?.thresholds).toEqual({})
    })

    it('should not mutate original config', () => {
      const config = {
        name: 'Test',
        options: {
          notify_no_data: true,
          thresholds: {
            critical_recovery: 80
          }
        }
      }

      const originalCopy = JSON.parse(JSON.stringify(config))
      normalizeMonitorConfig(config)

      expect(config).toEqual(originalCopy)
    })

    it('should handle mixed snake_case and camelCase', () => {
      const config = {
        name: 'Test',
        options: {
          notify_no_data: true,
          notifyAudit: false, // Already camelCase
          evaluation_delay: 900,
          includeTags: true // Already camelCase
        }
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options).toHaveProperty('notifyNoData', true)
      expect(result.options).toHaveProperty('notifyAudit', false)
      expect(result.options).toHaveProperty('evaluationDelay', 900)
      expect(result.options).toHaveProperty('includeTags', true)
      expect(result.options).not.toHaveProperty('notify_no_data')
      expect(result.options).not.toHaveProperty('evaluation_delay')
    })

    it('should preserve fields that are identical in both forms', () => {
      const config = {
        name: 'Test',
        options: {
          locked: true,
          silenced: { '*': null }
        }
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options).toHaveProperty('locked', true)
      expect(result.options).toHaveProperty('silenced', { '*': null })
    })

    it('should handle thresholds with only critical', () => {
      const config = {
        name: 'Test',
        options: {
          thresholds: {
            critical: 100
          }
        }
      }

      const result = normalizeMonitorConfig(config)

      expect(result.options?.thresholds).toEqual({ critical: 100 })
    })

    it('should handle complex nested structure', () => {
      const config = {
        name: 'Complex Monitor',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert!',
        tags: ['env:prod', 'team:platform'],
        options: {
          notify_no_data: true,
          no_data_timeframe: 60,
          new_host_delay: 300,
          evaluation_delay: 900,
          renotify_interval: 120,
          escalation_message: 'Critical alert!',
          thresholds: {
            critical: 90,
            warning: 75,
            critical_recovery: 80,
            warning_recovery: 65
          },
          other_field: 'preserved'
        }
      }

      const result = normalizeMonitorConfig(config)

      // Top-level fields preserved
      expect(result.name).toBe('Complex Monitor')
      expect(result.type).toBe('metric alert')
      expect(result.tags).toEqual(['env:prod', 'team:platform'])

      // Options normalized
      expect(result.options).toHaveProperty('notifyNoData', true)
      expect(result.options).toHaveProperty('noDataTimeframe', 60)
      expect(result.options).toHaveProperty('evaluationDelay', 900)
      expect(result.options).toHaveProperty('renotifyInterval', 120)
      expect(result.options).toHaveProperty('escalationMessage', 'Critical alert!')

      // Thresholds normalized
      expect(result.options?.thresholds).toHaveProperty('critical', 90)
      expect(result.options?.thresholds).toHaveProperty('warning', 75)
      expect(result.options?.thresholds).toHaveProperty('criticalRecovery', 80)
      expect(result.options?.thresholds).toHaveProperty('warningRecovery', 65)

      // Other fields preserved
      expect(result.options).toHaveProperty('other_field', 'preserved')
    })
  })
})
