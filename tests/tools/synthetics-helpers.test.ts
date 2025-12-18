import { describe, it, expect } from 'vitest'
import {
  normalizeSyntheticsConfig,
  normalizeConfigKeys,
  snakeToCamel
} from '../../src/tools/synthetics.js'

describe('snakeToCamel', () => {
  it('should convert snake_case to camelCase', () => {
    expect(snakeToCamel('public_id')).toBe('publicId')
    expect(snakeToCamel('test_type')).toBe('testType')
    expect(snakeToCamel('request_headers')).toBe('requestHeaders')
  })

  it('should handle multiple underscores', () => {
    expect(snakeToCamel('browser_step_config')).toBe('browserStepConfig')
    expect(snakeToCamel('api_test_options')).toBe('apiTestOptions')
  })

  it('should preserve camelCase', () => {
    expect(snakeToCamel('publicId')).toBe('publicId')
    expect(snakeToCamel('testType')).toBe('testType')
  })

  it('should preserve single words', () => {
    expect(snakeToCamel('name')).toBe('name')
    expect(snakeToCamel('type')).toBe('type')
  })
})

describe('normalizeConfigKeys', () => {
  it('should convert snake_case keys to camelCase', () => {
    const input = { public_id: '123', test_type: 'api' }
    const result = normalizeConfigKeys(input)
    expect(result).toEqual({ publicId: '123', testType: 'api' })
  })

  it('should handle nested objects', () => {
    const input = {
      name: 'Test',
      config: {
        request_headers: { 'Content-Type': 'application/json' },
        assertion_type: 'statusCode'
      }
    }
    const result = normalizeConfigKeys(input)
    expect(result).toEqual({
      name: 'Test',
      config: {
        requestHeaders: { 'Content-Type': 'application/json' },
        assertionType: 'statusCode'
      }
    })
  })

  it('should handle arrays of objects', () => {
    const input = {
      assertions: [
        { assertion_type: 'statusCode', target_value: 200 },
        { assertion_type: 'responseTime', target_value: 1000 }
      ]
    }
    const result = normalizeConfigKeys(input)
    expect(result).toEqual({
      assertions: [
        { assertionType: 'statusCode', targetValue: 200 },
        { assertionType: 'responseTime', targetValue: 1000 }
      ]
    })
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
        middle_key: {
          inner_key: 'value'
        }
      }
    }
    const result = normalizeConfigKeys(input)
    expect(result).toEqual({
      outerKey: {
        middleKey: {
          innerKey: 'value'
        }
      }
    })
  })

  it('should preserve arrays of primitives', () => {
    const input = { tags: ['env:prod', 'service:api'] }
    const result = normalizeConfigKeys(input)
    expect(result).toEqual({ tags: ['env:prod', 'service:api'] })
  })
})

describe('normalizeSyntheticsConfig', () => {
  it('should throw on missing name', () => {
    expect(() =>
      normalizeSyntheticsConfig({
        locations: ['aws:us-east-1'],
        type: 'api'
      })
    ).toThrow("Synthetics test config requires 'name' field")
  })

  it('should throw on missing locations', () => {
    expect(() =>
      normalizeSyntheticsConfig({
        name: 'Test',
        type: 'api'
      })
    ).toThrow("Synthetics test config requires 'locations' array")
  })

  it('should throw on empty locations array', () => {
    expect(() =>
      normalizeSyntheticsConfig({
        name: 'Test',
        locations: [],
        type: 'api'
      })
    ).toThrow("Synthetics test config requires 'locations' array")
  })

  it('should throw on non-array locations', () => {
    expect(() =>
      normalizeSyntheticsConfig({
        name: 'Test',
        locations: 'aws:us-east-1',
        type: 'api'
      })
    ).toThrow("Synthetics test config requires 'locations' array")
  })

  it('should convert snake_case to camelCase', () => {
    const result = normalizeSyntheticsConfig({
      name: 'API Test',
      locations: ['aws:us-east-1'],
      public_id: 'abc-123',
      test_type: 'api',
      request_headers: {
        'Content-Type': 'application/json'
      }
    })

    expect(result).toHaveProperty('name', 'API Test')
    expect(result).toHaveProperty('locations')
    expect(result).toHaveProperty('publicId', 'abc-123')
    expect(result).toHaveProperty('testType', 'api')
    expect(result).toHaveProperty('requestHeaders')
  })

  it('should preserve camelCase keys', () => {
    const result = normalizeSyntheticsConfig({
      name: 'API Test',
      locations: ['aws:us-east-1'],
      publicId: 'def-456'
    })

    expect(result).toHaveProperty('name', 'API Test')
    expect(result).toHaveProperty('publicId', 'def-456')
  })

  it('should handle multiple locations', () => {
    const result = normalizeSyntheticsConfig({
      name: 'Multi-region Test',
      locations: ['aws:us-east-1', 'aws:eu-west-1', 'aws:ap-southeast-1']
    })

    expect(result.locations).toHaveLength(3)
    expect(result.locations).toEqual(['aws:us-east-1', 'aws:eu-west-1', 'aws:ap-southeast-1'])
  })

  it('should handle assertions with snake_case', () => {
    const result = normalizeSyntheticsConfig({
      name: 'Test',
      locations: ['aws:us-east-1'],
      assertions: [
        {
          assertion_type: 'statusCode',
          target_value: 200
        },
        {
          assertion_type: 'responseTime',
          max_value: 1000
        }
      ]
    })

    const assertions = result.assertions as Array<Record<string, unknown>>
    expect(assertions[0]).toHaveProperty('assertionType', 'statusCode')
    expect(assertions[0]).toHaveProperty('targetValue', 200)
    expect(assertions[1]).toHaveProperty('assertionType', 'responseTime')
    expect(assertions[1]).toHaveProperty('maxValue', 1000)
  })

  it('should handle config with nested options', () => {
    const result = normalizeSyntheticsConfig({
      name: 'Complex Test',
      locations: ['aws:us-east-1'],
      options: {
        tick_every: 300,
        min_failure_duration: 0,
        min_location_failed: 1,
        retry: {
          count: 2,
          interval: 300
        }
      }
    })

    const options = result.options as Record<string, unknown>
    expect(options).toHaveProperty('tickEvery', 300)
    expect(options).toHaveProperty('minFailureDuration', 0)
    expect(options).toHaveProperty('minLocationFailed', 1)

    const retry = options.retry as Record<string, unknown>
    expect(retry).toHaveProperty('count', 2)
    expect(retry).toHaveProperty('interval', 300)
  })

  it('should handle browser test config', () => {
    const result = normalizeSyntheticsConfig({
      name: 'Browser Test',
      type: 'browser',
      locations: ['aws:us-east-1'],
      config: {
        request: {
          method: 'GET',
          url: 'https://example.com'
        }
      },
      steps: [
        {
          type: 'assertPageContains',
          allow_failure: false,
          timeout: 60
        }
      ]
    })

    expect(result).toHaveProperty('name', 'Browser Test')
    expect(result).toHaveProperty('type', 'browser')

    const steps = result.steps as Array<Record<string, unknown>>
    expect(steps[0]).toHaveProperty('allowFailure', false)
    expect(steps[0]).toHaveProperty('timeout', 60)
  })

  it('should handle tags array', () => {
    const result = normalizeSyntheticsConfig({
      name: 'Tagged Test',
      locations: ['aws:us-east-1'],
      tags: ['env:prod', 'team:platform', 'service:api']
    })

    expect(result.tags).toEqual(['env:prod', 'team:platform', 'service:api'])
  })
})
