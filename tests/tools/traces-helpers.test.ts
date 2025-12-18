import { describe, it, expect } from 'vitest'
import { formatSpan, buildTraceQuery } from '../../src/tools/traces.js'
import { v2 } from '@datadog/datadog-api-client'

describe('Traces Helper Functions', () => {
  describe('formatSpan', () => {
    it('should format complete span with all fields', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-123',
        attributes: {
          traceId: 'trace-456',
          spanId: 'span-123',
          service: 'api-service',
          resourceName: 'GET /api/users',
          type: 'web',
          env: 'production',
          startTimestamp: new Date('2024-01-15T12:00:00.000Z'),
          endTimestamp: new Date('2024-01-15T12:00:00.500Z'), // 500ms duration
          tags: [
            'env:production',
            'http.status_code:200',
            'http.method:GET',
            'http.url:api.example.com/users'
          ],
          attributes: {
            operation_name: 'express.request',
            status: 'ok'
          }
        }
      }

      const result = formatSpan(span)

      expect(result).toEqual({
        traceId: 'trace-456',
        spanId: 'span-123',
        service: 'api-service',
        resource: 'GET /api/users',
        operation: 'express.request',
        type: 'web',
        status: 'ok',
        duration: '500.0ms',
        durationNs: 500_000_000,
        http: {
          statusCode: '200',
          method: 'GET',
          url: 'api.example.com/users' // tag.split(':') only takes first value part
        },
        error: {
          type: '',
          message: ''
        },
        env: 'production',
        tags: [
          'env:production',
          'http.status_code:200',
          'http.method:GET',
          'http.url:api.example.com/users'
        ]
      })
    })

    it('should handle span with error information', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-789',
        attributes: {
          traceId: 'trace-abc',
          spanId: 'span-789',
          service: 'db-service',
          resourceName: 'SELECT * FROM users',
          type: 'sql',
          startTimestamp: new Date('2024-01-15T12:00:00.000Z'),
          endTimestamp: new Date('2024-01-15T12:00:02.000Z'), // 2s duration
          tags: [
            'error.type:TimeoutError',
            'error.message:Connection timeout after 2s',
            'status:error'
          ],
          attributes: {
            status: 'error'
          }
        }
      }

      const result = formatSpan(span)

      expect(result.status).toBe('error')
      expect(result.duration).toBe('2.00s')
      expect(result.durationNs).toBe(2_000_000_000)
      expect(result.error).toEqual({
        type: 'TimeoutError',
        message: 'Connection timeout after 2s'
      })
    })

    it('should handle span with error.msg tag', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-msg',
        attributes: {
          traceId: 'trace-msg',
          spanId: 'span-msg',
          service: 'test-service',
          resourceName: 'test',
          startTimestamp: new Date('2024-01-15T12:00:00.000Z'),
          endTimestamp: new Date('2024-01-15T12:00:00.100Z'),
          tags: ['error.type:Error', 'error.msg:Short error']
        }
      }

      const result = formatSpan(span)

      expect(result.error).toEqual({
        type: 'Error',
        message: 'Short error'
      })
    })

    it('should get duration from nested attributes', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-duration',
        attributes: {
          service: 'test',
          resourceName: 'test',
          attributes: {
            duration: 1_500_000_000 // 1.5s in nanoseconds
          }
        }
      }

      const result = formatSpan(span)

      expect(result.duration).toBe('1.50s')
      expect(result.durationNs).toBe(1_500_000_000)
    })

    it('should get duration from custom attributes', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-custom',
        attributes: {
          service: 'test',
          resourceName: 'test',
          custom: {
            duration: 250_000_000 // 250ms in nanoseconds
          }
        }
      }

      const result = formatSpan(span)

      expect(result.duration).toBe('250.0ms')
      expect(result.durationNs).toBe(250_000_000)
    })

    it('should get status from nested attributes', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-status',
        attributes: {
          service: 'test',
          resourceName: 'test',
          attributes: {
            status: 'ok'
          }
        }
      }

      const result = formatSpan(span)

      expect(result.status).toBe('ok')
    })

    it('should get status from custom attributes', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-custom-status',
        attributes: {
          service: 'test',
          resourceName: 'test',
          custom: {
            status: 'error'
          }
        }
      }

      const result = formatSpan(span)

      expect(result.status).toBe('error')
    })

    it('should get status from tags', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-tag-status',
        attributes: {
          service: 'test',
          resourceName: 'test',
          tags: ['status:ok']
        }
      }

      const result = formatSpan(span)

      expect(result.status).toBe('ok')
    })

    it('should get operation from custom attributes', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-op',
        attributes: {
          service: 'test',
          resourceName: 'test',
          custom: {
            operation_name: 'mongodb.query'
          }
        }
      }

      const result = formatSpan(span)

      expect(result.operation).toBe('mongodb.query')
    })

    it('should get env from attributes', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-env',
        attributes: {
          service: 'test',
          resourceName: 'test',
          env: 'staging'
        }
      }

      const result = formatSpan(span)

      expect(result.env).toBe('staging')
    })

    it('should get env from tags if not in attributes', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-env-tag',
        attributes: {
          service: 'test',
          resourceName: 'test',
          tags: ['env:production']
        }
      }

      const result = formatSpan(span)

      expect(result.env).toBe('production')
    })

    it('should handle minimal span', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-min'
      }

      const result = formatSpan(span)

      expect(result).toEqual({
        traceId: '',
        spanId: '',
        service: '',
        resource: '',
        operation: '',
        type: '',
        status: '',
        duration: '0ns',
        durationNs: 0,
        http: {
          statusCode: '',
          method: '',
          url: ''
        },
        error: {
          type: '',
          message: ''
        },
        env: '',
        tags: []
      })
    })

    it('should handle span with 5xx HTTP status', () => {
      const span: v2.Span = {
        type: 'span',
        id: 'span-500',
        attributes: {
          service: 'api',
          resourceName: 'GET /error',
          tags: ['http.status_code:500', 'http.method:GET']
        }
      }

      const result = formatSpan(span)

      expect(result.http.statusCode).toBe('500')
      expect(result.http.method).toBe('GET')
    })
  })

  describe('buildTraceQuery', () => {
    it('should return * for empty params', () => {
      const result = buildTraceQuery({})

      expect(result).toBe('*')
    })

    it('should use base query param', () => {
      const result = buildTraceQuery({ query: '@http.status_code:500' })

      expect(result).toBe('@http.status_code:500')
    })

    it('should add service filter', () => {
      const result = buildTraceQuery({ service: 'api-service' })

      expect(result).toBe('service:api-service')
    })

    it('should add operation filter', () => {
      const result = buildTraceQuery({ operation: 'express.request' })

      expect(result).toBe('operation_name:express.request')
    })

    it('should add resource filter', () => {
      const result = buildTraceQuery({ resource: 'GET /api/users' })

      expect(result).toBe('resource_name:GET /api/users')
    })

    it('should add status filter', () => {
      const result = buildTraceQuery({ status: 'error' })

      expect(result).toBe('status:error')
    })

    it('should add env filter', () => {
      const result = buildTraceQuery({ env: 'production' })

      expect(result).toBe('env:production')
    })

    it('should add minDuration filter with nanoseconds', () => {
      const result = buildTraceQuery({ minDuration: '500ms' })

      expect(result).toBe('@duration:>=500000000')
    })

    it('should add maxDuration filter with nanoseconds', () => {
      const result = buildTraceQuery({ maxDuration: '2s' })

      expect(result).toBe('@duration:<=2000000000')
    })

    it('should add both duration filters', () => {
      const result = buildTraceQuery({ minDuration: '100ms', maxDuration: '1s' })

      expect(result).toContain('@duration:>=100000000')
      expect(result).toContain('@duration:<=1000000000')
    })

    it('should handle exact HTTP status code', () => {
      const result = buildTraceQuery({ httpStatus: '500' })

      expect(result).toBe('@http.status_code:500')
    })

    it('should handle HTTP status range 5xx', () => {
      const result = buildTraceQuery({ httpStatus: '5xx' })

      expect(result).toBe('@http.status_code:[500 TO 599]')
    })

    it('should handle HTTP status range 4xx', () => {
      const result = buildTraceQuery({ httpStatus: '4xx' })

      expect(result).toBe('@http.status_code:[400 TO 499]')
    })

    it('should handle HTTP status >= operator', () => {
      const result = buildTraceQuery({ httpStatus: '>=400' })

      expect(result).toBe('@http.status_code:>=400')
    })

    it('should handle HTTP status > operator', () => {
      const result = buildTraceQuery({ httpStatus: '>300' })

      expect(result).toBe('@http.status_code:>300')
    })

    it('should handle HTTP status <= operator', () => {
      const result = buildTraceQuery({ httpStatus: '<=299' })

      expect(result).toBe('@http.status_code:<=299')
    })

    it('should handle HTTP status < operator', () => {
      const result = buildTraceQuery({ httpStatus: '<400' })

      expect(result).toBe('@http.status_code:<400')
    })

    it('should add errorType filter with wildcards', () => {
      const result = buildTraceQuery({ errorType: 'TimeoutError' })

      expect(result).toBe('error.type:*TimeoutError*')
    })

    it('should add errorMessage filter with wildcards', () => {
      const result = buildTraceQuery({ errorMessage: 'connection refused' })

      expect(result).toBe('error.message:*connection refused*')
    })

    it('should escape quotes in errorType', () => {
      const result = buildTraceQuery({ errorType: 'Error "fatal"' })

      expect(result).toBe('error.type:*Error \\"fatal\\"*')
    })

    it('should escape quotes in errorMessage', () => {
      const result = buildTraceQuery({ errorMessage: 'message "critical"' })

      expect(result).toBe('error.message:*message \\"critical\\"*')
    })

    it('should combine multiple filters', () => {
      const result = buildTraceQuery({
        service: 'api',
        status: 'error',
        env: 'production'
      })

      expect(result).toContain('service:api')
      expect(result).toContain('status:error')
      expect(result).toContain('env:production')
      expect(result.split(' ').length).toBe(3)
    })

    it('should combine all parameters', () => {
      const result = buildTraceQuery({
        query: 'base query',
        service: 'web-service',
        operation: 'http.request',
        resource: 'GET /api/*',
        status: 'error',
        env: 'prod',
        minDuration: '1s',
        maxDuration: '10s',
        httpStatus: '5xx',
        errorType: 'Timeout',
        errorMessage: 'deadline exceeded'
      })

      expect(result).toContain('base query')
      expect(result).toContain('service:web-service')
      expect(result).toContain('operation_name:http.request')
      expect(result).toContain('resource_name:GET /api/*')
      expect(result).toContain('status:error')
      expect(result).toContain('env:prod')
      expect(result).toContain('@duration:>=1000000000')
      expect(result).toContain('@duration:<=10000000000')
      expect(result).toContain('@http.status_code:[500 TO 599]')
      expect(result).toContain('error.type:*Timeout*')
      expect(result).toContain('error.message:*deadline exceeded*')
    })

    it('should preserve order of filters', () => {
      const result = buildTraceQuery({
        errorMessage: 'error',
        query: 'first',
        service: 'second',
        operation: 'third',
        resource: 'fourth',
        status: 'fifth'
      })

      const parts = result.split(' ')
      expect(parts[0]).toBe('first')
      expect(parts[1]).toContain('service:')
      expect(parts[2]).toContain('operation_name:')
      expect(parts[3]).toContain('resource_name:')
      expect(parts[4]).toContain('status:')
      expect(parts[5]).toContain('error.message:')
    })

    it('should handle invalid minDuration gracefully', () => {
      const result = buildTraceQuery({ minDuration: 'invalid' })

      // If parseDurationToNs returns undefined, filter is not added
      expect(result).toBe('*')
    })

    it('should handle invalid maxDuration gracefully', () => {
      const result = buildTraceQuery({ maxDuration: 'invalid' })

      // If parseDurationToNs returns undefined, filter is not added
      expect(result).toBe('*')
    })

    it('should handle case-insensitive HTTP status code', () => {
      const result = buildTraceQuery({ httpStatus: '5XX' })

      expect(result).toBe('@http.status_code:[500 TO 599]')
    })

    it('should handle wildcard in resource name', () => {
      const result = buildTraceQuery({ resource: 'GET /api/*' })

      expect(result).toBe('resource_name:GET /api/*')
    })

    it('should handle special characters in service name', () => {
      const result = buildTraceQuery({ service: 'api-service-v2' })

      expect(result).toBe('service:api-service-v2')
    })
  })
})
