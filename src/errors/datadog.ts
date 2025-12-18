import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'

/**
 * Custom error codes for Datadog-specific errors.
 * Uses JSON-RPC server error range (-32000 to -32099).
 * These allow LLMs to distinguish error types for retry logic.
 */
export const DatadogErrorCode = {
  /** 401 - Invalid or missing API/APP key */
  Unauthorized: -32050,
  /** 403 - Valid credentials but insufficient permissions */
  Forbidden: -32051,
  /** 404 - Requested resource does not exist */
  NotFound: -32052,
  /** 429 - Rate limit exceeded, should retry after delay */
  RateLimited: -32053,
  /** 5xx - Datadog service temporarily unavailable */
  ServiceUnavailable: -32054
} as const

/**
 * Maps Datadog API errors to MCP errors with appropriate error codes.
 * Uses custom error codes to allow LLMs to distinguish between:
 * - Authentication failures (retry won't help without new credentials)
 * - Authorization failures (need different permissions)
 * - Not found (check if resource exists)
 * - Rate limiting (wait and retry)
 * - Service unavailable (temporary, retry later)
 */
export function handleDatadogError(error: unknown): never {
  console.error('[Datadog Error]', error)

  // Pass through McpError unchanged (check first since McpError also has numeric code)
  if (error instanceof McpError) {
    throw error
  }

  // Check for Datadog API errors by duck typing
  const apiError = error as { code?: number; body?: { errors?: string[] }; message?: string }
  if (typeof apiError.code === 'number') {
    const message = apiError.body?.errors?.[0] ?? apiError.message ?? 'Unknown error'

    switch (apiError.code) {
      case 400:
        throw new McpError(ErrorCode.InvalidRequest, `Invalid request: ${message}`)
      case 401:
        throw new McpError(DatadogErrorCode.Unauthorized, `Authentication failed: Invalid Datadog API key or APP key`)
      case 403:
        throw new McpError(DatadogErrorCode.Forbidden, `Authorization denied: ${message}`)
      case 404:
        throw new McpError(DatadogErrorCode.NotFound, `Resource not found: ${message}`)
      case 429:
        throw new McpError(DatadogErrorCode.RateLimited, 'Rate limit exceeded. Retry after a short delay.')
      case 500:
      case 502:
      case 503:
        throw new McpError(DatadogErrorCode.ServiceUnavailable, 'Datadog service temporarily unavailable. Retry later.')
      default:
        throw new McpError(ErrorCode.InternalError, `Datadog API error (${apiError.code}): ${message}`)
    }
  }

  throw new McpError(
    ErrorCode.InternalError,
    error instanceof Error ? error.message : String(error)
  )
}

/**
 * Validates required parameters for an action
 */
export function requireParam<T>(value: T | undefined, name: string, action: string): T {
  if (value === undefined || value === null || value === '') {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Parameter '${name}' is required for action '${action}'`
    )
  }
  return value
}

/**
 * Write actions that should be blocked in read-only mode
 */
const WRITE_ACTIONS = new Set([
  'create', 'update', 'delete', 'mute', 'unmute', 'cancel', 'add', 'trigger'
])

/**
 * Checks if action is allowed given read-only mode setting.
 * Throws an error for write actions when in read-only mode.
 */
export function checkReadOnly(action: string, readOnly: boolean): void {
  if (readOnly && WRITE_ACTIONS.has(action)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Action '${action}' is not allowed in read-only mode. Server started with --read-only flag.`
    )
  }
}
