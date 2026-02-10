import { describe, it, expect } from 'vitest'
import {
  normalizeSloConfig,
  snakeToCamel,
  normalizeConfigKeys,
  formatSearchSlo,
  formatSlo
} from '../../src/tools/slos.js'

describe('snakeToCamel', () => {
  it('should convert snake_case to camelCase', () => {
    expect(snakeToCamel('target_threshold')).toBe('targetThreshold')
    expect(snakeToCamel('time_window')).toBe('timeWindow')
    expect(snakeToCamel('error_budget')).toBe('errorBudget')
  })

  it('should handle multiple underscores', () => {
    expect(snakeToCamel('monitor_search_query')).toBe('monitorSearchQuery')
    expect(snakeToCamel('sli_value_type')).toBe('sliValueType')
  })

  it('should preserve camelCase', () => {
    expect(snakeToCamel('targetThreshold')).toBe('targetThreshold')
    expect(snakeToCamel('timeWindow')).toBe('timeWindow')
  })

  it('should preserve single words', () => {
    expect(snakeToCamel('name')).toBe('name')
    expect(snakeToCamel('type')).toBe('type')
  })

  it('should handle uppercase after underscore', () => {
    expect(snakeToCamel('api_key')).toBe('apiKey')
  })
})

describe('normalizeConfigKeys', () => {
  it('should convert snake_case keys to camelCase', () => {
    const input = { target_threshold: 99.9, time_window: '7d' }
    const result = normalizeConfigKeys(input)
    expect(result).toEqual({ targetThreshold: 99.9, timeWindow: '7d' })
  })

  it('should handle nested objects', () => {
    const input = {
      name: 'Test SLO',
      thresholds: [
        {
          target_threshold: 99.9,
          time_window: '7d'
        }
      ]
    }
    const result = normalizeConfigKeys(input)
    expect(result).toEqual({
      name: 'Test SLO',
      thresholds: [
        {
          targetThreshold: 99.9,
          timeWindow: '7d'
        }
      ]
    })
  })

  it('should handle arrays', () => {
    const input = { tags: ['env:prod', 'team:platform'] }
    const result = normalizeConfigKeys(input)
    expect(result).toEqual({ tags: ['env:prod', 'team:platform'] })
  })

  it('should handle null values', () => {
    expect(normalizeConfigKeys(null)).toBe(null)
  })

  it('should handle undefined values', () => {
    expect(normalizeConfigKeys(undefined)).toBe(undefined)
  })

  it('should handle primitive values', () => {
    expect(normalizeConfigKeys('test')).toBe('test')
    expect(normalizeConfigKeys(123)).toBe(123)
    expect(normalizeConfigKeys(true)).toBe(true)
  })

  it('should recursively convert deeply nested objects', () => {
    const input = {
      outer_key: {
        inner_key: {
          deep_key: 'value'
        }
      }
    }
    const result = normalizeConfigKeys(input)
    expect(result).toEqual({
      outerKey: {
        innerKey: {
          deepKey: 'value'
        }
      }
    })
  })
})

describe('normalizeSloConfig', () => {
  it('should throw on missing name', () => {
    expect(() =>
      normalizeSloConfig({
        type: 'metric',
        thresholds: [{ target_threshold: 99.9 }]
      })
    ).toThrow("SLO config requires 'name' field")
  })

  it('should throw on missing type', () => {
    expect(() =>
      normalizeSloConfig({
        name: 'Test SLO',
        thresholds: [{ target_threshold: 99.9 }]
      })
    ).toThrow("SLO config requires 'type' field")
  })

  it('should throw on missing thresholds', () => {
    expect(() =>
      normalizeSloConfig({
        name: 'Test SLO',
        type: 'metric'
      })
    ).toThrow("SLO config requires 'thresholds' array")
  })

  it('should throw on non-array thresholds', () => {
    expect(() =>
      normalizeSloConfig({
        name: 'Test SLO',
        type: 'metric',
        thresholds: 'not-an-array'
      })
    ).toThrow("SLO config requires 'thresholds' array")
  })

  it('should convert snake_case to camelCase', () => {
    const result = normalizeSloConfig({
      name: 'Test SLO',
      type: 'metric',
      thresholds: [
        {
          target_threshold: 99.9,
          time_window: '7d',
          warning_threshold: 99.5
        }
      ],
      monitor_search_query: 'service:api'
    })

    expect(result).toHaveProperty('name', 'Test SLO')
    expect(result).toHaveProperty('type', 'metric')
    expect(result).toHaveProperty('thresholds')
    expect(result).toHaveProperty('monitorSearchQuery', 'service:api')

    const thresholds = result.thresholds as Array<Record<string, unknown>>
    expect(thresholds[0]).toHaveProperty('targetThreshold', 99.9)
    expect(thresholds[0]).toHaveProperty('timeWindow', '7d')
    expect(thresholds[0]).toHaveProperty('warningThreshold', 99.5)
  })

  it('should preserve camelCase keys', () => {
    const result = normalizeSloConfig({
      name: 'Test SLO',
      type: 'metric',
      thresholds: [{ targetThreshold: 99.9 }]
    })

    expect(result).toHaveProperty('name', 'Test SLO')
    expect(result).toHaveProperty('type', 'metric')
    const thresholds = result.thresholds as Array<Record<string, unknown>>
    expect(thresholds[0]).toHaveProperty('targetThreshold', 99.9)
  })

  it('should handle empty thresholds array as valid', () => {
    expect(() =>
      normalizeSloConfig({
        name: 'Test SLO',
        type: 'metric',
        thresholds: []
      })
    ).not.toThrow()
  })

  it('should handle multiple thresholds', () => {
    const result = normalizeSloConfig({
      name: 'Test SLO',
      type: 'metric',
      thresholds: [
        { target_threshold: 99.9, time_window: '7d' },
        { target_threshold: 99.5, time_window: '30d' }
      ]
    })

    const thresholds = result.thresholds as Array<Record<string, unknown>>
    expect(thresholds).toHaveLength(2)
    expect(thresholds[0]).toHaveProperty('targetThreshold', 99.9)
    expect(thresholds[1]).toHaveProperty('targetThreshold', 99.5)
  })

  it('should handle tags array', () => {
    const result = normalizeSloConfig({
      name: 'Test SLO',
      type: 'metric',
      thresholds: [{ target_threshold: 99.9 }],
      tags: ['env:prod', 'team:platform']
    })

    expect(result).toHaveProperty('tags')
    expect(result.tags).toEqual(['env:prod', 'team:platform'])
  })
})

describe('formatSearchSlo', () => {
  it('should extract status data from search response', () => {
    const searchSlo = {
      data: {
        id: 'slo-001',
        attributes: {
          name: 'API Availability',
          description: '99.9% availability',
          sloType: 'metric',
          allTags: ['service:api'],
          thresholds: [{ target: 99.9, warning: 99.95, timeframe: '30d' }],
          status: {
            sli: 99.95,
            errorBudgetRemaining: 75.5,
            state: 'ok'
          },
          overallStatus: [
            {
              status: 99.95,
              errorBudgetRemaining: 75.5,
              state: 'ok',
              target: 99.9,
              timeframe: '30d'
            }
          ],
          createdAt: 1704067200,
          modifiedAt: 1705276800
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = formatSearchSlo(searchSlo as any)

    expect(result.id).toBe('slo-001')
    expect(result.name).toBe('API Availability')
    expect(result.status.sli).toBe(99.95)
    expect(result.status.errorBudgetRemaining).toBe(75.5)
    expect(result.status.state).toBe('ok')
    expect(result.overallStatus).toHaveLength(1)
    expect(result.overallStatus[0].sli).toBe(99.95)
    expect(result.overallStatus[0].target).toBe(99.9)
    expect(result.overallStatus[0].timeframe).toBe('30d')
  })

  it('should handle missing status gracefully', () => {
    const searchSlo = {
      data: {
        id: 'slo-002',
        attributes: {
          name: 'No Status SLO',
          sloType: 'metric',
          thresholds: [{ target: 99.9, timeframe: '7d' }],
          createdAt: 1704067200,
          modifiedAt: 1705276800
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = formatSearchSlo(searchSlo as any)

    expect(result.status.sli).toBeNull()
    expect(result.status.errorBudgetRemaining).toBeNull()
    expect(result.status.state).toBe('unknown')
    expect(result.overallStatus).toEqual([])
  })

  it('should handle empty data gracefully', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = formatSearchSlo({} as any)

    expect(result.id).toBe('')
    expect(result.name).toBe('')
    expect(result.status.sli).toBeNull()
    expect(result.overallStatus).toEqual([])
  })
})

describe('formatSlo', () => {
  it('should include empty overallStatus array', () => {
    const slo = {
      id: 'slo-001',
      name: 'Test SLO',
      type: 'metric',
      thresholds: [{ target: 99.9, timeframe: '30d' }],
      tags: ['env:prod'],
      createdAt: 1704067200,
      modifiedAt: 1705276800
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = formatSlo(slo as any)

    expect(result.overallStatus).toEqual([])
    expect(result.status.sli).toBeNull()
  })
})
