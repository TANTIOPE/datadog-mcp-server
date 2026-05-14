/**
 * Tests for monitors.ts helper functions
 * Focus on normalizeMonitorConfig which is completely untested (lines 146-194)
 */
import type { v2 } from '@datadog/datadog-api-client'
import {
  normalizeMonitorConfig,
  collectUnknownKeyWarnings,
  MonitorConfigSchema,
  MonitorOptionsSchema,
  formatMonitorTransition,
  buildMonitorHistoryQuery
} from '../../src/tools/monitors.js'

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

    it('produces no warnings after normalization for snake_case aliased keys', () => {
      // Regression: any snake_case key in `optionMappings` MUST be converted to
      // its camelCase form by `normalizeMonitorConfig`, leaving zero unknown
      // keys for `collectUnknownKeyWarnings` to report. This guards against
      // missed alias entries (which would surface as spurious warnings).
      const config = {
        name: 'Aliased Snake Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 90',
        options: {
          notify_no_data: true,
          no_data_timeframe: 60,
          notification_preset_name: 'show_all',
          on_missing_data: 'show_no_data',
          group_retention_duration: '2d',
          threshold_windows: { triggerWindow: 'last_5m', recoveryWindow: 'last_5m' },
          scheduling_options: { evaluationWindow: { dayStarts: '04:00' } }
        }
      }

      const normalized = normalizeMonitorConfig(config)
      const warnings = collectUnknownKeyWarnings(normalized)

      expect(warnings).toEqual([])
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

  describe('collectUnknownKeyWarnings', () => {
    it('returns empty array for fully validated input (all known keys)', () => {
      const config = {
        name: 'Test',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2',
        message: 'Alert!',
        tags: ['env:prod'],
        priority: 3,
        restrictedRoles: ['admin'],
        multi: true,
        options: {
          notifyNoData: true,
          noDataTimeframe: 60,
          renotifyInterval: 120,
          thresholds: { critical: 90 }
        }
      }

      expect(collectUnknownKeyWarnings(config)).toEqual([])
    })

    it('returns empty array for empty config', () => {
      expect(collectUnknownKeyWarnings({})).toEqual([])
    })

    it('reports unknown top-level keys with config location', () => {
      const config = {
        name: 'Test',
        fooBar: 'value',
        bazQux: 42
      }

      const warnings = collectUnknownKeyWarnings(config)

      expect(warnings).toHaveLength(2)
      expect(warnings[0]).toContain("'fooBar'")
      expect(warnings[0]).toContain('config')
      expect(warnings[0]).not.toContain('config.options')
      expect(warnings[1]).toContain("'bazQux'")
      expect(warnings[1]).toContain('config')
      expect(warnings[1]).not.toContain('config.options')
    })

    it('reports unknown options keys with config.options location', () => {
      const config = {
        name: 'Test',
        options: {
          notifyNoData: true,
          someNewOption: 'value',
          anotherUnknown: 123
        }
      }

      const warnings = collectUnknownKeyWarnings(config)

      expect(warnings).toHaveLength(2)
      expect(warnings[0]).toContain("'someNewOption'")
      expect(warnings[0]).toContain('config.options')
      expect(warnings[1]).toContain("'anotherUnknown'")
      expect(warnings[1]).toContain('config.options')
    })

    it('reports both top-level and options unknowns with top-level first', () => {
      const config = {
        topLevelUnknown: 'value',
        name: 'Test',
        options: {
          notifyNoData: true,
          optionsUnknown: 'value'
        }
      }

      const warnings = collectUnknownKeyWarnings(config)

      expect(warnings).toHaveLength(2)
      expect(warnings[0]).toContain("'topLevelUnknown'")
      expect(warnings[0]).toContain('config')
      expect(warnings[0]).not.toContain('config.options')
      expect(warnings[1]).toContain("'optionsUnknown'")
      expect(warnings[1]).toContain('config.options')
    })

    it('preserves insertion order of unknown keys within each group', () => {
      const config = {
        zebra: 1,
        name: 'Test',
        alpha: 2,
        middle: 3,
        options: {
          zulu: 1,
          notifyNoData: true,
          alphaOpt: 2,
          mikeOpt: 3
        }
      }

      const warnings = collectUnknownKeyWarnings(config)

      // 3 top-level unknowns (zebra, alpha, middle) + 3 options unknowns
      // (zulu, alphaOpt, mikeOpt); `name`, `options`, `notifyNoData` are known.
      expect(warnings).toHaveLength(6)
      // Top-level unknowns, insertion order
      expect(warnings[0]).toContain("'zebra'")
      expect(warnings[1]).toContain("'alpha'")
      expect(warnings[2]).toContain("'middle'")
      // Then options unknowns, insertion order
      expect(warnings[3]).toContain("'zulu'")
      expect(warnings[4]).toContain("'alphaOpt'")
      expect(warnings[5]).toContain("'mikeOpt'")
    })

    it('preserves exact key casing including snake_case (post-normalization residual)', () => {
      // Snake_case keys that the normalizer did NOT map (because they aren't in
      // the alias table) appear as unknown. The warning must preserve the
      // caller's exact spelling so they can grep their source.
      const config = {
        name: 'Test',
        SomeWeirdKey: 'x',
        options: {
          notify_no_data_typo: true,
          ANOTHER_UNUSUAL: 5
        }
      }

      const warnings = collectUnknownKeyWarnings(config)

      expect(warnings).toHaveLength(3)
      expect(warnings[0]).toContain("'SomeWeirdKey'")
      expect(warnings[1]).toContain("'notify_no_data_typo'")
      expect(warnings[2]).toContain("'ANOTHER_UNUSUAL'")
    })

    it('handles config.options absent without throwing', () => {
      const config = {
        name: 'Test',
        type: 'metric alert',
        query: 'avg:system.load.1{*} > 2'
      }

      expect(() => collectUnknownKeyWarnings(config)).not.toThrow()
      expect(collectUnknownKeyWarnings(config)).toEqual([])
    })

    it('handles config.options === null without throwing', () => {
      const config = {
        name: 'Test',
        options: null
      }

      expect(() => collectUnknownKeyWarnings(config)).not.toThrow()
      expect(collectUnknownKeyWarnings(config)).toEqual([])
    })

    it('handles config.options non-object (string) without throwing', () => {
      const config = {
        name: 'Test',
        options: 'not-an-object'
      }

      expect(() => collectUnknownKeyWarnings(config)).not.toThrow()
      // options is a known holder key so it is not flagged as top-level unknown;
      // and it's not an object so no nested keys to scan.
      expect(collectUnknownKeyWarnings(config)).toEqual([])
    })

    it('handles config.options as array (non-plain-object) without throwing', () => {
      const config = {
        name: 'Test',
        options: ['unexpected']
      }

      expect(() => collectUnknownKeyWarnings(config)).not.toThrow()
      // Arrays are not plain objects in the schema's sense; treat as no nested keys.
      expect(collectUnknownKeyWarnings(config)).toEqual([])
    })

    it('does not flag the `options` key itself as unknown when present', () => {
      const config = {
        name: 'Test',
        options: {
          notifyNoData: true
        }
      }

      const warnings = collectUnknownKeyWarnings(config)
      expect(warnings).toEqual([])
      expect(warnings.every((w) => !w.includes("'options'"))).toBe(true)
    })
  })
})

// Schema validation tests (Task 9) — exercises MonitorOptionsSchema and
// MonitorConfigSchema (defined in src/tools/monitors.ts). Covers:
//   - one accept-case per validated `options.*` key (Requirement 1.1)
//   - wrong-type rejection for `notifyNoData`, `renotifyInterval`, `tags`
//     (Requirement 1.2 + 2.1)
//   - `priority` out-of-range rejection (Requirement 2.4)
//   - top-level config empty / options-only acceptance (Requirement 2.3,
//     design Testing strategy → Unit tests)

describe('MonitorOptionsSchema — accept-cases per validated key', () => {
  // Each entry is [keyName, validValue]. Parametrized so adding a new key to
  // the schema means adding one row here — not a copy-pasted block.
  const acceptCases: ReadonlyArray<readonly [string, unknown]> = [
    // Notification
    ['notifyNoData', true],
    ['noDataTimeframe', 60],
    ['notifyAudit', false],
    ['notificationPresetName', 'show_all'],
    // Evaluation / delay
    ['newHostDelay', 300],
    ['newGroupDelay', 60],
    ['evaluationDelay', 900],
    ['requireFullWindow', true],
    ['onMissingData', 'show_no_data'],
    // Renotification — `renotifyInterval` is documented nullable; a number is
    // the common case so we use a number here. Null acceptance is asserted
    // separately below.
    ['renotifyInterval', 120],
    ['renotifyOccurrences', 5],
    ['renotifyStatuses', ['alert', 'warn']],
    ['escalationMessage', 'Escalating!'],
    // Lifecycle
    ['timeoutH', 24],
    ['includeTags', true],
    ['locked', false],
    ['silenced', { '*': null, 'env:prod': 1700000000 }],
    ['groupRetentionDuration', '2d'],
    // Thresholds & scheduling — nested schemas validated by their own helpers
    ['thresholds', { critical: 90, warning: 75, criticalRecovery: 80 }],
    ['thresholdWindows', { triggerWindow: 'last_5m', recoveryWindow: 'last_5m' }],
    ['schedulingOptions', { evaluationWindow: { dayStarts: '04:00' } }]
  ]

  it.each(acceptCases)('accepts validated options key %s with valid value', (key, value) => {
    const result = MonitorOptionsSchema.safeParse({ [key]: value })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveProperty(key)
    }
  })

  it('accepts renotifyInterval set to null (documented nullable)', () => {
    const result = MonitorOptionsSchema.safeParse({ renotifyInterval: null })
    expect(result.success).toBe(true)
  })

  it('accepts timeoutH set to null (documented nullable)', () => {
    const result = MonitorOptionsSchema.safeParse({ timeoutH: null })
    expect(result.success).toBe(true)
  })

  it('accepts an empty options object (all keys optional)', () => {
    const result = MonitorOptionsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('preserves unknown options keys via passthrough (Requirement 3)', () => {
    const result = MonitorOptionsSchema.safeParse({
      notifyNoData: true,
      futureDatadogOption: 'value'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveProperty('futureDatadogOption', 'value')
    }
  })
})

describe('MonitorOptionsSchema — reject-cases for wrong primitive types', () => {
  it('rejects notifyNoData when given a non-boolean (string)', () => {
    const result = MonitorOptionsSchema.safeParse({ notifyNoData: 'yes' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues[0]
      expect(issue?.path).toEqual(['notifyNoData'])
      expect(issue?.code).toBe('invalid_type')
    }
  })

  it('rejects renotifyInterval when given a non-number (string)', () => {
    const result = MonitorOptionsSchema.safeParse({ renotifyInterval: '120' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues[0]
      expect(issue?.path).toEqual(['renotifyInterval'])
      expect(issue?.code).toBe('invalid_type')
    }
  })

  it('rejects renotifyStatuses when given a non-array (string)', () => {
    const result = MonitorOptionsSchema.safeParse({ renotifyStatuses: 'alert' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues[0]
      expect(issue?.path).toEqual(['renotifyStatuses'])
      expect(issue?.code).toBe('invalid_type')
    }
  })

  it('rejects evaluationDelay when given a boolean', () => {
    const result = MonitorOptionsSchema.safeParse({ evaluationDelay: true })
    expect(result.success).toBe(false)
  })

  it('rejects escalationMessage when given a number', () => {
    const result = MonitorOptionsSchema.safeParse({ escalationMessage: 42 })
    expect(result.success).toBe(false)
  })

  it('rejects thresholds.critical when given a string', () => {
    const result = MonitorOptionsSchema.safeParse({
      thresholds: { critical: '90' }
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues[0]
      expect(issue?.path).toEqual(['thresholds', 'critical'])
    }
  })
})

describe('MonitorConfigSchema — top-level acceptance', () => {
  it('accepts an empty config object (all keys optional, supports partial update)', () => {
    const result = MonitorConfigSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts a config object with only `options` set (partial update payload)', () => {
    const result = MonitorConfigSchema.safeParse({ options: {} })
    expect(result.success).toBe(true)
  })

  it('accepts a config object with options containing only renotifyInterval', () => {
    const result = MonitorConfigSchema.safeParse({
      options: { renotifyInterval: 120 }
    })
    expect(result.success).toBe(true)
  })

  it('accepts a fully-populated valid config object', () => {
    const result = MonitorConfigSchema.safeParse({
      name: 'Test Monitor',
      type: 'metric alert',
      query: 'avg:system.load.1{*} > 2',
      message: 'Alert!',
      tags: ['env:prod', 'team:platform'],
      priority: 3,
      restrictedRoles: ['admin'],
      multi: true,
      options: {
        notifyNoData: true,
        noDataTimeframe: 60,
        thresholds: { critical: 90 }
      }
    })
    expect(result.success).toBe(true)
  })

  it('accepts an unknown top-level key via passthrough (Requirement 3.2)', () => {
    const result = MonitorConfigSchema.safeParse({
      name: 'Test',
      futureDatadogField: 'value'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveProperty('futureDatadogField', 'value')
    }
  })

  it('accepts priority set to null (clearing on update)', () => {
    const result = MonitorConfigSchema.safeParse({ priority: null })
    expect(result.success).toBe(true)
  })

  it.each([1, 2, 3, 4, 5])('accepts priority %i (in 1-5 range)', (priority) => {
    const result = MonitorConfigSchema.safeParse({ priority })
    expect(result.success).toBe(true)
  })
})

describe('MonitorConfigSchema — top-level rejection', () => {
  it('rejects priority: 7 (out of 1-5 range)', () => {
    const result = MonitorConfigSchema.safeParse({ priority: 7 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues[0]
      expect(issue?.path).toEqual(['priority'])
    }
  })

  it('rejects priority: 0 (below 1-5 range)', () => {
    const result = MonitorConfigSchema.safeParse({ priority: 0 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['priority'])
    }
  })

  it('rejects priority: 2.5 (non-integer)', () => {
    const result = MonitorConfigSchema.safeParse({ priority: 2.5 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['priority'])
    }
  })

  it('rejects tags when given a non-array (string)', () => {
    const result = MonitorConfigSchema.safeParse({ tags: 'env:prod' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues[0]
      expect(issue?.path).toEqual(['tags'])
      expect(issue?.code).toBe('invalid_type')
    }
  })

  it('rejects name when given a non-string (number)', () => {
    const result = MonitorConfigSchema.safeParse({ name: 42 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['name'])
    }
  })

  it('rejects multi when given a non-boolean (string)', () => {
    const result = MonitorConfigSchema.safeParse({ multi: 'true' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['multi'])
    }
  })

  it('propagates nested options validation errors (notifyNoData wrong type)', () => {
    const result = MonitorConfigSchema.safeParse({
      name: 'Test',
      options: { notifyNoData: 'yes' }
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['options', 'notifyNoData'])
    }
  })

  describe('buildMonitorHistoryQuery', () => {
    it('always emits source:alert @monitor.id:N as the base query (no clause when transitionType is omitted)', () => {
      // Per design, buildMonitorHistoryQuery is a pure composer: the
      // historyMonitor orchestrator owns the default ['alert', 'alert recovery'].
      // When transitionType is undefined here, the helper emits only the base.
      const query = buildMonitorHistoryQuery({ monitorId: 282774192 })
      expect(query).toBe('source:alert @monitor.id:282774192')
      expect(query).not.toContain('@monitor.transition.transition_type')
      expect(query).not.toContain('@monitor.groups')
    })

    it('emits the default ["alert", "alert recovery"] clause when the orchestrator passes the default', () => {
      // Mirrors design.md "Unit tests for helpers" — query with default
      // transition types should produce the canonical fires + recoveries form.
      const query = buildMonitorHistoryQuery({
        monitorId: 282774192,
        transitionType: ['alert', 'alert recovery']
      })
      expect(query).toBe(
        'source:alert @monitor.id:282774192 @monitor.transition.transition_type:(alert OR "alert recovery")'
      )
    })

    it('appends an OR-joined transition_type clause for multiple values with proper quoting', () => {
      const query = buildMonitorHistoryQuery({
        monitorId: 12345,
        transitionType: ['alert', 'alert recovery', 'renotify']
      })
      expect(query).toBe(
        'source:alert @monitor.id:12345 @monitor.transition.transition_type:(alert OR "alert recovery" OR renotify)'
      )
    })

    it('emits a single-value transition_type clause without parentheses padding errors', () => {
      const query = buildMonitorHistoryQuery({
        monitorId: 42,
        transitionType: ['alert']
      })
      expect(query).toBe('source:alert @monitor.id:42 @monitor.transition.transition_type:(alert)')
    })

    it('appends @monitor.groups:"..." when group is provided and quotes the value', () => {
      const query = buildMonitorHistoryQuery({
        monitorId: 282774192,
        transitionType: ['alert'],
        group: 'pod_name:cronjob-mover-29644980-jnvpj'
      })
      expect(query).toBe(
        'source:alert @monitor.id:282774192 @monitor.transition.transition_type:(alert) @monitor.groups:"pod_name:cronjob-mover-29644980-jnvpj"'
      )
    })

    it('treats empty transitionType array as undefined (no clause appended)', () => {
      const query = buildMonitorHistoryQuery({
        monitorId: 7,
        transitionType: []
      })
      expect(query).toBe('source:alert @monitor.id:7')
      expect(query).not.toContain('@monitor.transition.transition_type')
    })

    it('omits the group clause when group is undefined or empty', () => {
      const noGroup = buildMonitorHistoryQuery({
        monitorId: 7,
        transitionType: ['alert']
      })
      expect(noGroup).not.toContain('@monitor.groups')

      const emptyGroup = buildMonitorHistoryQuery({
        monitorId: 7,
        transitionType: ['alert'],
        group: ''
      })
      expect(emptyGroup).not.toContain('@monitor.groups')
    })

    it('escapes backslashes and double quotes inside a group value', () => {
      // A group name containing a literal double quote must not break out of
      // the quoted clause. Backslashes are escaped first so that subsequent
      // quote-escaping does not produce dangling backslashes.
      const query = buildMonitorHistoryQuery({
        monitorId: 42,
        group: 'pod_name:weird"name\\with\\slashes'
      })
      expect(query).toBe(
        'source:alert @monitor.id:42 @monitor.groups:"pod_name:weird\\"name\\\\with\\\\slashes"'
      )
    })
  })

  describe('formatMonitorTransition', () => {
    it('extracts a typed transition from a v2 event with monitor.transition present', () => {
      const event = {
        id: 'evt-1',
        attributes: {
          timestamp: new Date('2026-05-13T23:24:00.000Z'),
          attributes: {
            timestamp: 1747178640000,
            monitor: {
              id: 282774192,
              name: '[DO-1712] Pod readiness production',
              groups: ['kube_namespace:production', 'pod_name:foo'],
              transition: {
                source_state: 'Alert',
                destination_state: 'OK',
                transition_type: 'alert recovery'
              }
            }
          }
        }
      } as unknown as v2.EventResponse

      const transition = formatMonitorTransition(event)

      expect(transition).not.toBeNull()
      expect(transition).toMatchObject({
        timestamp: '2026-05-13T23:24:00.000Z',
        monitorId: 282774192,
        monitorName: '[DO-1712] Pod readiness production',
        fromState: 'Alert',
        toState: 'OK',
        transitionType: 'alert recovery',
        eventId: 'evt-1'
      })
      // groups is joined by ',' per design when multi-value
      expect(transition?.group).toBe('kube_namespace:production,pod_name:foo')
    })

    it('returns null when the monitor.transition block is absent', () => {
      const event = {
        id: 'evt-2',
        attributes: {
          timestamp: new Date('2026-05-13T23:24:00.000Z'),
          attributes: {
            monitor: {
              id: 282774192,
              name: '[DO-1712] Pod readiness production',
              groups: ['kube_namespace:production']
              // no transition block
            }
          }
        }
      } as unknown as v2.EventResponse

      expect(formatMonitorTransition(event)).toBeNull()
    })

    it('returns null when the outer attributes or inner monitor are missing', () => {
      expect(formatMonitorTransition({} as v2.EventResponse)).toBeNull()
      expect(formatMonitorTransition({ attributes: {} } as unknown as v2.EventResponse)).toBeNull()
      expect(
        formatMonitorTransition({
          attributes: { attributes: {} }
        } as unknown as v2.EventResponse)
      ).toBeNull()
    })

    it('preserves group as null for non-multi-alert monitors (no groups array)', () => {
      const event = {
        id: 'evt-3',
        attributes: {
          timestamp: new Date('2026-05-13T23:24:00.000Z'),
          attributes: {
            monitor: {
              id: 100,
              name: 'Simple Monitor',
              // no groups field
              transition: {
                source_state: 'OK',
                destination_state: 'Alert',
                transition_type: 'alert'
              }
            }
          }
        }
      } as unknown as v2.EventResponse

      const transition = formatMonitorTransition(event)
      expect(transition).not.toBeNull()
      expect(transition?.group).toBeNull()
      expect(transition?.fromState).toBe('OK')
      expect(transition?.toState).toBe('Alert')
      expect(transition?.transitionType).toBe('alert')
    })

    it('preserves group as null when the groups array is empty', () => {
      const event = {
        id: 'evt-4',
        attributes: {
          timestamp: new Date('2026-05-13T23:24:00.000Z'),
          attributes: {
            monitor: {
              id: 101,
              name: 'Empty groups',
              groups: [],
              transition: {
                source_state: 'OK',
                destination_state: 'Alert',
                transition_type: 'alert'
              }
            }
          }
        }
      } as unknown as v2.EventResponse

      expect(formatMonitorTransition(event)?.group).toBeNull()
    })

    it('falls back to "Monitor ${id}" when monitor name is missing', () => {
      const event = {
        id: 'evt-5',
        attributes: {
          timestamp: new Date('2026-05-13T23:24:00.000Z'),
          attributes: {
            monitor: {
              id: 999,
              transition: {
                source_state: 'OK',
                destination_state: 'Alert',
                transition_type: 'alert'
              }
            }
          }
        }
      } as unknown as v2.EventResponse

      expect(formatMonitorTransition(event)?.monitorName).toBe('Monitor 999')
    })

    it('reads the transition from monitor.additionalProperties when the SDK moves unknown keys there', () => {
      // The Datadog SDK's ObjectSerializer deserializes unknown properties
      // (like `transition`, which is not declared on the generated MonitorType)
      // into a `monitor.additionalProperties` bag. formatMonitorTransition must
      // fall back to that location so live API responses parse correctly.
      const event = {
        id: 'evt-ap',
        attributes: {
          timestamp: new Date('2026-05-13T23:24:00.000Z'),
          attributes: {
            monitor: {
              id: 282774192,
              name: '[DO-1712] Pod readiness production',
              groups: ['kube_namespace:production'],
              // No top-level transition — only the SDK-deserialized shape.
              additionalProperties: {
                transition: {
                  source_state: 'Alert',
                  destination_state: 'OK',
                  transition_type: 'alert recovery'
                }
              }
            }
          }
        }
      } as unknown as v2.EventResponse

      const transition = formatMonitorTransition(event)

      expect(transition).not.toBeNull()
      expect(transition).toMatchObject({
        timestamp: '2026-05-13T23:24:00.000Z',
        monitorId: 282774192,
        monitorName: '[DO-1712] Pod readiness production',
        fromState: 'Alert',
        toState: 'OK',
        transitionType: 'alert recovery',
        group: 'kube_namespace:production',
        eventId: 'evt-ap'
      })
    })

    it('uses numeric timestamp at the inner attributes when the outer Date is absent', () => {
      const event = {
        id: 'evt-6',
        attributes: {
          // no outer timestamp Date
          attributes: {
            timestamp: 1747178640000,
            monitor: {
              id: 1,
              name: 'X',
              transition: {
                source_state: 'OK',
                destination_state: 'Alert',
                transition_type: 'alert'
              }
            }
          }
        }
      } as unknown as v2.EventResponse

      expect(formatMonitorTransition(event)?.timestamp).toBe(new Date(1747178640000).toISOString())
    })
  })
})
