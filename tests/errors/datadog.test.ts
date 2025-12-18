/**
 * Unit tests for Datadog error handling
 */
import { describe, it, expect } from 'vitest'
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { handleDatadogError, DatadogErrorCode } from '../../src/errors/datadog.js'

describe('Error Handling', () => {
  describe('DatadogErrorCode', () => {
    it('should have unique error codes in JSON-RPC server range', () => {
      // JSON-RPC server errors: -32000 to -32099
      expect(DatadogErrorCode.Unauthorized).toBe(-32050)
      expect(DatadogErrorCode.Forbidden).toBe(-32051)
      expect(DatadogErrorCode.NotFound).toBe(-32052)
      expect(DatadogErrorCode.RateLimited).toBe(-32053)
      expect(DatadogErrorCode.ServiceUnavailable).toBe(-32054)

      // All should be in the valid range
      const codes = Object.values(DatadogErrorCode)
      codes.forEach((code) => {
        expect(code).toBeGreaterThanOrEqual(-32099)
        expect(code).toBeLessThanOrEqual(-32000)
      })
    })

    it('should not conflict with standard MCP error codes', () => {
      const mcpCodes = [
        ErrorCode.ConnectionClosed, // -32000
        ErrorCode.RequestTimeout, // -32001
        ErrorCode.ParseError, // -32700
        ErrorCode.InvalidRequest, // -32600
        ErrorCode.MethodNotFound, // -32601
        ErrorCode.InvalidParams, // -32602
        ErrorCode.InternalError // -32603
      ]

      const datadogCodes = Object.values(DatadogErrorCode)

      datadogCodes.forEach((ddCode) => {
        mcpCodes.forEach((mcpCode) => {
          expect(ddCode).not.toBe(mcpCode)
        })
      })
    })
  })

  describe('handleDatadogError', () => {
    it('should map 400 to InvalidRequest', () => {
      const error = { code: 400, body: { errors: ['Bad request'] } }

      expect(() => handleDatadogError(error)).toThrow(McpError)
      try {
        handleDatadogError(error)
      } catch (e) {
        const mcpError = e as McpError
        expect(mcpError.code).toBe(ErrorCode.InvalidRequest)
        expect(mcpError.message).toContain('Invalid request')
      }
    })

    it('should map 401 to Unauthorized with descriptive message', () => {
      const error = { code: 401, body: { errors: ['Invalid API key'] } }

      expect(() => handleDatadogError(error)).toThrow(McpError)
      try {
        handleDatadogError(error)
      } catch (e) {
        const mcpError = e as McpError
        expect(mcpError.code).toBe(DatadogErrorCode.Unauthorized)
        expect(mcpError.message).toContain('Authentication failed')
      }
    })

    it('should map 403 to Forbidden with descriptive message', () => {
      const error = { code: 403, body: { errors: ['Insufficient permissions'] } }

      expect(() => handleDatadogError(error)).toThrow(McpError)
      try {
        handleDatadogError(error)
      } catch (e) {
        const mcpError = e as McpError
        expect(mcpError.code).toBe(DatadogErrorCode.Forbidden)
        expect(mcpError.message).toContain('Authorization denied')
      }
    })

    it('should map 404 to NotFound with details', () => {
      const error = { code: 404, body: { errors: ['Monitor not found'] } }

      expect(() => handleDatadogError(error)).toThrow(McpError)
      try {
        handleDatadogError(error)
      } catch (e) {
        const mcpError = e as McpError
        expect(mcpError.code).toBe(DatadogErrorCode.NotFound)
        expect(mcpError.message).toContain('Resource not found')
        expect(mcpError.message).toContain('Monitor not found')
      }
    })

    it('should map 429 to RateLimited', () => {
      const error = { code: 429, body: { errors: ['Rate limit exceeded'] } }

      expect(() => handleDatadogError(error)).toThrow(McpError)
      try {
        handleDatadogError(error)
      } catch (e) {
        const mcpError = e as McpError
        expect(mcpError.code).toBe(DatadogErrorCode.RateLimited)
        expect(mcpError.message).toContain('Rate limit')
      }
    })

    it('should map 500/502/503 to ServiceUnavailable', () => {
      const statusCodes = [500, 502, 503]

      statusCodes.forEach((code) => {
        const error = { code, body: { errors: ['Service error'] } }

        expect(() => handleDatadogError(error)).toThrow(McpError)
        try {
          handleDatadogError(error)
        } catch (e) {
          const mcpError = e as McpError
          expect(mcpError.code).toBe(DatadogErrorCode.ServiceUnavailable)
          expect(mcpError.message).toContain('unavailable')
        }
      })
    })

    it('should map unknown status codes to InternalError', () => {
      const error = { code: 418, body: { errors: ["I'm a teapot"] } }

      expect(() => handleDatadogError(error)).toThrow(McpError)
      try {
        handleDatadogError(error)
      } catch (e) {
        const mcpError = e as McpError
        expect(mcpError.code).toBe(ErrorCode.InternalError)
        expect(mcpError.message).toContain('418')
      }
    })

    it('should pass through McpError unchanged', () => {
      const originalError = new McpError(ErrorCode.InvalidParams, 'Test error')

      expect(() => handleDatadogError(originalError)).toThrow(McpError)
      try {
        handleDatadogError(originalError)
      } catch (e) {
        const mcpError = e as McpError
        // McpError is re-thrown as-is
        expect(mcpError.code).toBe(ErrorCode.InvalidParams)
        expect(mcpError.message).toContain('Test error')
      }
    })

    it('should handle generic errors', () => {
      const error = new Error('Something went wrong')

      expect(() => handleDatadogError(error)).toThrow(McpError)
      try {
        handleDatadogError(error)
      } catch (e) {
        const mcpError = e as McpError
        expect(mcpError.code).toBe(ErrorCode.InternalError)
        expect(mcpError.message).toContain('Something went wrong')
      }
    })

    it('should handle non-error objects', () => {
      const error = 'string error'

      expect(() => handleDatadogError(error)).toThrow(McpError)
      try {
        handleDatadogError(error)
      } catch (e) {
        const mcpError = e as McpError
        expect(mcpError.code).toBe(ErrorCode.InternalError)
        expect(mcpError.message).toContain('string error')
      }
    })
  })
})
