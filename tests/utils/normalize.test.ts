/**
 * Unit tests for the shared normalize utilities (snakeToCamel, normalizeConfigKeys)
 *
 * These helpers are consumed by multiple tools (slos, logs_pipelines, logs_indexes,
 * logs_archives) to normalize MCP caller payloads that arrive in snake_case before
 * forwarding them to the Datadog SDK, which expects camelCase keys.
 */
import { describe, it, expect } from 'vitest'
import { snakeToCamel, normalizeConfigKeys } from '../../src/utils/normalize.js'

describe('snakeToCamel', () => {
  it('converts simple snake_case to camelCase', () => {
    expect(snakeToCamel('target_threshold')).toBe('targetThreshold')
    expect(snakeToCamel('time_window')).toBe('timeWindow')
    expect(snakeToCamel('error_budget')).toBe('errorBudget')
  })

  it('handles multiple underscores', () => {
    expect(snakeToCamel('monitor_search_query')).toBe('monitorSearchQuery')
    expect(snakeToCamel('num_retention_days')).toBe('numRetentionDays')
  })

  it('preserves already-camelCase strings', () => {
    expect(snakeToCamel('targetThreshold')).toBe('targetThreshold')
    expect(snakeToCamel('numRetentionDays')).toBe('numRetentionDays')
  })

  it('preserves single words with no underscores', () => {
    expect(snakeToCamel('name')).toBe('name')
    expect(snakeToCamel('query')).toBe('query')
  })

  it('handles short keys with a single underscore', () => {
    expect(snakeToCamel('api_key')).toBe('apiKey')
    expect(snakeToCamel('a_b')).toBe('aB')
  })

  it('returns empty string for empty input', () => {
    expect(snakeToCamel('')).toBe('')
  })
})

describe('normalizeConfigKeys', () => {
  it('returns null unchanged', () => {
    expect(normalizeConfigKeys(null)).toBeNull()
  })

  it('returns undefined unchanged', () => {
    expect(normalizeConfigKeys(undefined)).toBeUndefined()
  })

  it('returns primitive strings unchanged', () => {
    expect(normalizeConfigKeys('hello_world')).toBe('hello_world')
  })

  it('returns primitive numbers unchanged', () => {
    expect(normalizeConfigKeys(42)).toBe(42)
    expect(normalizeConfigKeys(3.14)).toBe(3.14)
  })

  it('returns primitive booleans unchanged', () => {
    expect(normalizeConfigKeys(true)).toBe(true)
    expect(normalizeConfigKeys(false)).toBe(false)
  })

  it('converts top-level snake_case keys to camelCase', () => {
    const input = { filter_query: 'service:api', num_retention_days: 15 }
    expect(normalizeConfigKeys(input)).toEqual({
      filterQuery: 'service:api',
      numRetentionDays: 15
    })
  })

  it('recursively converts nested object keys', () => {
    const input = {
      outer_key: {
        inner_key: {
          deep_key: 'value'
        }
      }
    }
    expect(normalizeConfigKeys(input)).toEqual({
      outerKey: {
        innerKey: {
          deepKey: 'value'
        }
      }
    })
  })

  it('converts keys inside arrays of objects', () => {
    const input = {
      thresholds: [
        { target_threshold: 99.9, time_window: '7d' },
        { target_threshold: 99.5, time_window: '30d' }
      ]
    }
    expect(normalizeConfigKeys(input)).toEqual({
      thresholds: [
        { targetThreshold: 99.9, timeWindow: '7d' },
        { targetThreshold: 99.5, timeWindow: '30d' }
      ]
    })
  })

  it('preserves arrays of primitives unchanged', () => {
    const input = { tags: ['env:prod', 'team:platform'] }
    expect(normalizeConfigKeys(input)).toEqual({ tags: ['env:prod', 'team:platform'] })
  })

  it('preserves arrays containing null entries', () => {
    expect(normalizeConfigKeys([null, 1, 'x', null])).toEqual([null, 1, 'x', null])
  })

  it('passes through null and undefined values inside objects without crashing', () => {
    const input = { my_field: null, other_field: undefined, kept_field: 'value' }
    expect(normalizeConfigKeys(input)).toEqual({
      myField: null,
      otherField: undefined,
      keptField: 'value'
    })
  })

  it('returns a new object — does not mutate input', () => {
    const input = { foo_bar: 1, nested: { baz_qux: 2 } }
    const result = normalizeConfigKeys(input) as Record<string, unknown>

    expect(result).not.toBe(input)
    expect((result.nested as Record<string, unknown>) === input.nested).toBe(false)
    // Input retains its original keys
    expect(input).toEqual({ foo_bar: 1, nested: { baz_qux: 2 } })
  })

  it('handles mixed snake and camel keys side by side', () => {
    const input = { snake_case_key: 1, camelCaseKey: 2 }
    expect(normalizeConfigKeys(input)).toEqual({ snakeCaseKey: 1, camelCaseKey: 2 })
  })

  it('preserves Datadog archive destination structure on round-trip', () => {
    const input = {
      name: 'prod-archive',
      query: 'service:api',
      destination: {
        type: 's3',
        bucket: 'my-bucket',
        path: 'logs/',
        integration: { role_name: 'datadog-role', account_id: '123' }
      },
      include_tags: true,
      rehydration_tags: ['env:prod']
    }
    expect(normalizeConfigKeys(input)).toEqual({
      name: 'prod-archive',
      query: 'service:api',
      destination: {
        type: 's3',
        bucket: 'my-bucket',
        path: 'logs/',
        integration: { roleName: 'datadog-role', accountId: '123' }
      },
      includeTags: true,
      rehydrationTags: ['env:prod']
    })
  })
})
