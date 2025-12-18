import { describe, it, expect } from 'vitest'
import { extractMonitorIdentifier } from '../../src/tools/downtimes.js'

describe('extractMonitorIdentifier', () => {
  it('should handle undefined input', () => {
    const result = extractMonitorIdentifier(undefined)
    expect(result).toEqual({ monitorId: null, monitorTags: [] })
  })

  it('should extract monitorId from DowntimeMonitorIdentifierId', () => {
    const result = extractMonitorIdentifier({ monitorId: 12345 })
    expect(result).toEqual({
      monitorId: 12345,
      monitorTags: []
    })
  })

  it('should handle zero as valid monitorId', () => {
    const result = extractMonitorIdentifier({ monitorId: 0 })
    expect(result).toEqual({
      monitorId: 0,
      monitorTags: []
    })
  })

  it('should extract monitorTags from DowntimeMonitorIdentifierTags', () => {
    const result = extractMonitorIdentifier({ monitorTags: ['env:prod', 'team:platform'] })
    expect(result).toEqual({
      monitorId: null,
      monitorTags: ['env:prod', 'team:platform']
    })
  })

  it('should handle empty monitorTags array', () => {
    const result = extractMonitorIdentifier({ monitorTags: [] })
    expect(result).toEqual({
      monitorId: null,
      monitorTags: []
    })
  })

  it('should handle single tag in monitorTags', () => {
    const result = extractMonitorIdentifier({ monitorTags: ['service:api'] })
    expect(result).toEqual({
      monitorId: null,
      monitorTags: ['service:api']
    })
  })

  it('should return defaults for empty object', () => {
    const result = extractMonitorIdentifier({} as unknown)
    expect(result).toEqual({ monitorId: null, monitorTags: [] })
  })

  it('should prioritize monitorId if both properties exist', () => {
    // TypeScript won't allow this naturally, but test runtime behavior
    const mixed = { monitorId: 999, monitorTags: ['env:test'] }
    const result = extractMonitorIdentifier(mixed)
    expect(result).toEqual({
      monitorId: 999,
      monitorTags: [] // monitorId takes precedence
    })
  })

  it('should reject non-number monitorId', () => {
    const result = extractMonitorIdentifier({ monitorId: 'abc' } as unknown)
    expect(result).toEqual({ monitorId: null, monitorTags: [] })
  })

  it('should reject non-array monitorTags', () => {
    const result = extractMonitorIdentifier({ monitorTags: 'env:prod' } as unknown)
    expect(result).toEqual({ monitorId: null, monitorTags: [] })
  })
})
