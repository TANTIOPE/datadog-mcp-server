import { describe, it, expect } from 'vitest'
import {
  normalizeToPattern,
  spreadSample,
  diverseSample,
  buildLogQuery
} from '../../src/tools/logs.js'

describe('Logs Helper Functions', () => {
  describe('normalizeToPattern', () => {
    it('should replace UUIDs with {UUID}', () => {
      const message = 'Request ID: 550e8400-e29b-41d4-a716-446655440000 failed'
      const result = normalizeToPattern(message)

      expect(result).toBe('Request ID: {UUID} failed')
    })

    it('should replace multiple UUIDs', () => {
      const message =
        'Trace 123e4567-e89b-12d3-a456-426614174000 span 987fbc97-4bed-5078-9f07-9141ba07c9f3'
      const result = normalizeToPattern(message)

      expect(result).toBe('Trace {UUID} span {UUID}')
    })

    it('should replace long hex strings (16+ chars) with {HEX}', () => {
      const message = 'Object ID: 507f1f77bcf86cd799439011abcdef1234567890'
      const result = normalizeToPattern(message)

      expect(result).toBe('Object ID: {HEX}')
    })

    it('should replace shorter hex IDs (8-15 chars) with {ID}', () => {
      const message = 'Session: a1b2c3d4e5f6 error'
      const result = normalizeToPattern(message)

      expect(result).toBe('Session: {ID} error')
    })

    it('should replace ISO timestamps with {TS}', () => {
      const message = 'Error at 2024-01-15T12:00:00Z'
      const result = normalizeToPattern(message)

      expect(result).toBe('Error at {TS}')
    })

    it('should replace ISO timestamps with milliseconds', () => {
      const message = 'Created at 2024-01-15T12:00:00.123Z'
      const result = normalizeToPattern(message)

      expect(result).toBe('Created at {TS}')
    })

    it('should replace ISO timestamps without Z', () => {
      const message = 'Time: 2024-01-15T12:00:00.123456'
      const result = normalizeToPattern(message)

      expect(result).toBe('Time: {TS}')
    })

    it('should replace IP addresses with {IP}', () => {
      const message = 'Request from 192.168.1.100 failed'
      const result = normalizeToPattern(message)

      expect(result).toBe('Request from {IP} failed')
    })

    it('should replace multiple IP addresses', () => {
      const message = 'Proxy 10.0.0.1 forwarded from 203.0.113.5'
      const result = normalizeToPattern(message)

      expect(result).toBe('Proxy {IP} forwarded from {IP}')
    })

    it('should replace large numbers (4+ digits) with {N}', () => {
      const message = 'User 12345 uploaded 9876 bytes'
      const result = normalizeToPattern(message)

      expect(result).toBe('User {N} uploaded {N} bytes')
    })

    it('should not replace small numbers (1-3 digits)', () => {
      const message = 'HTTP 500 error on port 80'
      const result = normalizeToPattern(message)

      expect(result).toBe('HTTP 500 error on port 80')
    })

    it('should handle complex message with multiple patterns', () => {
      const message =
        'Request 550e8400-e29b-41d4-a716-446655440000 from 192.168.1.100 at 2024-01-15T12:00:00Z failed with error a1b2c3d4'
      const result = normalizeToPattern(message)

      expect(result).toBe('Request {UUID} from {IP} at {TS} failed with error {ID}')
    })

    it('should truncate long messages at 200 chars', () => {
      const longMessage = 'Error: ' + 'a'.repeat(300)
      const result = normalizeToPattern(longMessage)

      // Truncation happens AFTER normalization, so if there are no patterns, length might be < 200
      expect(result.length).toBeLessThanOrEqual(200)
      expect(result.startsWith('Error: ')).toBe(true)
    })

    it('should handle empty message', () => {
      const result = normalizeToPattern('')

      expect(result).toBe('')
    })

    it('should be case-insensitive for UUIDs and hex', () => {
      const message = 'ID 550E8400-E29B-41D4-A716-446655440000 HEX ABCDEF1234567890'
      const result = normalizeToPattern(message)

      expect(result).toBe('ID {UUID} HEX {HEX}')
    })

    it('should not break on patterns within patterns', () => {
      const message = 'Timestamp 2024-01-15T12:00:00Z has number 12345'
      const result = normalizeToPattern(message)

      // Timestamp should be replaced before number patterns
      expect(result).toBe('Timestamp {TS} has number {N}')
    })
  })

  describe('spreadSample', () => {
    it('should return all items if count <= limit', () => {
      const items = [1, 2, 3, 4, 5]
      const result = spreadSample(items, 10)

      expect(result).toEqual([1, 2, 3, 4, 5])
    })

    it('should return all items if count == limit', () => {
      const items = [1, 2, 3, 4, 5]
      const result = spreadSample(items, 5)

      expect(result).toEqual([1, 2, 3, 4, 5])
    })

    it('should evenly sample across array', () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const result = spreadSample(items, 5)

      // Should pick evenly: indices 0, 2, 4, 6, 8
      expect(result).toEqual([1, 3, 5, 7, 9])
    })

    it('should handle large arrays', () => {
      const items = Array.from({ length: 1000 }, (_, i) => i)
      const result = spreadSample(items, 10)

      expect(result.length).toBe(10)
      expect(result[0]).toBe(0)
      expect(result[9]).toBe(900) // Should be evenly distributed
    })

    it('should handle sampling 1 item from many', () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const result = spreadSample(items, 1)

      expect(result).toEqual([1])
    })

    it('should handle empty array', () => {
      const result = spreadSample([], 5)

      expect(result).toEqual([])
    })

    it('should preserve item types', () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
      const result = spreadSample(items, 2)

      expect(result).toEqual([{ id: 1 }, { id: 3 }])
    })

    it('should handle limit of 0', () => {
      const items = [1, 2, 3, 4, 5]
      const result = spreadSample(items, 0)

      expect(result).toEqual([])
    })
  })

  describe('diverseSample', () => {
    it('should return all items if unique patterns <= limit', () => {
      const items = [{ message: 'Error A' }, { message: 'Error B' }, { message: 'Error C' }]
      const result = diverseSample(items, 10)

      expect(result.samples).toEqual(items)
      expect(result.patterns).toBe(3)
    })

    it('should deduplicate items with same pattern', () => {
      const items = [
        { message: 'User 1234 failed' },
        { message: 'User 4567 failed' },
        { message: 'User 7890 failed' }
      ]
      const result = diverseSample(items, 10)

      // All normalize to "User {N} failed"
      expect(result.samples.length).toBe(1)
      expect(result.patterns).toBe(1)
      expect(result.samples[0]?.message).toBe('User 1234 failed') // First one kept
    })

    it('should respect limit on diverse patterns', () => {
      const items = [
        { message: 'Error type A' },
        { message: 'Error type B' },
        { message: 'Error type C' },
        { message: 'Error type D' },
        { message: 'Error type E' }
      ]
      const result = diverseSample(items, 3)

      expect(result.samples.length).toBe(3)
      expect(result.patterns).toBe(3)
    })

    it('should deduplicate by UUID pattern', () => {
      const items = [
        { message: 'Request 550e8400-e29b-41d4-a716-446655440000 failed' },
        { message: 'Request 123e4567-e89b-12d3-a456-426614174000 failed' },
        { message: 'Request 987fbc97-4bed-5078-9f07-9141ba07c9f3 failed' }
      ]
      const result = diverseSample(items, 10)

      // All normalize to "Request {UUID} failed"
      expect(result.samples.length).toBe(1)
      expect(result.patterns).toBe(1)
    })

    it('should deduplicate by IP pattern', () => {
      const items = [
        { message: 'Connection from 192.168.1.100' },
        { message: 'Connection from 10.0.0.5' },
        { message: 'Connection from 203.0.113.42' }
      ]
      const result = diverseSample(items, 10)

      // All normalize to "Connection from {IP}"
      expect(result.samples.length).toBe(1)
      expect(result.patterns).toBe(1)
    })

    it('should keep first occurrence of each pattern', () => {
      const items = [
        { message: 'Error 1000', id: 1 },
        { message: 'Error 2000', id: 2 },
        { message: 'Warning 3000', id: 3 }
      ]
      const result = diverseSample(items, 10)

      // All normalize to "Error {N}" and "Warning {N}"
      expect(result.samples).toContainEqual({ message: 'Error 1000', id: 1 })
      expect(result.samples).toContainEqual({ message: 'Warning 3000', id: 3 })
      // Should not include second Error (same pattern)
      expect(result.samples.length).toBe(2)
      expect(result.patterns).toBe(2)
    })

    it('should handle empty array', () => {
      const result = diverseSample([], 5)

      expect(result.samples).toEqual([])
      expect(result.patterns).toBe(0)
    })

    it('should handle limit of 1', () => {
      const items = [{ message: 'Error A' }, { message: 'Error B' }, { message: 'Error C' }]
      const result = diverseSample(items, 1)

      expect(result.samples.length).toBe(1)
      expect(result.samples[0]?.message).toBe('Error A')
    })

    it('should stop early when limit reached', () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        message: `Unique error ${i}`
      }))
      const result = diverseSample(items, 10)

      expect(result.samples.length).toBe(10)
      expect(result.patterns).toBe(10)
    })

    it('should handle mixed patterns', () => {
      const items = [
        { message: 'User 1234 logged in' },
        { message: 'User 4567 logged in' },
        { message: 'User 7890 logged out' },
        { message: 'System error 5000' },
        { message: 'System error 4040' }
      ]
      const result = diverseSample(items, 10)

      // "User {N} logged in", "User {N} logged out", "System error {N}"
      expect(result.patterns).toBe(3)
      expect(result.samples.length).toBe(3)
    })
  })

  describe('buildLogQuery', () => {
    it('should return * for empty params', () => {
      const result = buildLogQuery({})

      expect(result).toBe('*')
    })

    it('should use query param', () => {
      const result = buildLogQuery({ query: 'status:error' })

      expect(result).toBe('status:error')
    })

    it('should add keyword with quotes', () => {
      const result = buildLogQuery({ keyword: 'database connection' })

      expect(result).toBe('"database connection"')
    })

    it('should escape quotes in keyword', () => {
      const result = buildLogQuery({ keyword: 'error "fatal"' })

      expect(result).toBe('"error \\"fatal\\""')
    })

    it('should add pattern as regex on message field', () => {
      const result = buildLogQuery({ pattern: 'error.*timeout' })

      expect(result).toBe('@message:~"error.*timeout"')
    })

    it('should escape quotes in pattern', () => {
      const result = buildLogQuery({ pattern: 'error "pattern"' })

      expect(result).toBe('@message:~"error \\"pattern\\""')
    })

    it('should add service filter', () => {
      const result = buildLogQuery({ service: 'api-server' })

      expect(result).toBe('service:api-server')
    })

    it('should add host filter', () => {
      const result = buildLogQuery({ host: 'prod-web-01' })

      expect(result).toBe('host:prod-web-01')
    })

    it('should add status filter', () => {
      const result = buildLogQuery({ status: 'error' })

      expect(result).toBe('status:error')
    })

    it('should combine multiple filters', () => {
      const result = buildLogQuery({
        query: 'env:prod',
        service: 'api',
        status: 'error'
      })

      expect(result).toContain('env:prod')
      expect(result).toContain('service:api')
      expect(result).toContain('status:error')
      expect(result.split(' ').length).toBe(3)
    })

    it('should combine all parameters', () => {
      const result = buildLogQuery({
        query: 'base query',
        keyword: 'timeout',
        pattern: 'error.*',
        service: 'web',
        host: 'server1',
        status: 'warn'
      })

      expect(result).toContain('base query')
      expect(result).toContain('"timeout"')
      expect(result).toContain('@message:~"error.*"')
      expect(result).toContain('service:web')
      expect(result).toContain('host:server1')
      expect(result).toContain('status:warn')
    })

    it('should handle special characters in service name', () => {
      const result = buildLogQuery({ service: 'api-server-v2' })

      expect(result).toBe('service:api-server-v2')
    })

    it('should handle wildcard in query', () => {
      const result = buildLogQuery({ query: 'service:*' })

      expect(result).toBe('service:*')
    })

    it('should preserve order: query, keyword, pattern, service, host, status', () => {
      const result = buildLogQuery({
        status: 'error',
        query: 'first',
        keyword: 'second',
        pattern: 'third',
        service: 'fourth',
        host: 'fifth'
      })

      const parts = result.split(' ')
      expect(parts[0]).toBe('first')
      expect(parts[1]).toBe('"second"')
      expect(parts[2]).toContain('@message:')
      expect(parts[3]).toContain('service:')
      expect(parts[4]).toContain('host:')
      expect(parts[5]).toContain('status:')
    })
  })
})
