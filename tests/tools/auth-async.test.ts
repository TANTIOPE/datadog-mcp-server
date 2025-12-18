import { describe, it, expect, vi } from 'vitest'
import { validateCredentials } from '../../src/tools/auth.js'
import type { DatadogClients } from '../../src/config/datadog.js'

describe('validateCredentials', () => {
  it('should return valid when both API key and App key are valid', async () => {
    const mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({ valid: true })
      },
      users: {
        listUsers: vi.fn().mockResolvedValue({
          data: [{ id: 'user-1', attributes: {} }]
        })
      }
    } as unknown as DatadogClients

    const result = await validateCredentials(mockClients)

    expect(result.valid).toBe(true)
    expect(result.apiKeyValid).toBe(true)
    expect(result.appKeyValid).toBe(true)
    expect(result.message).toContain('valid and working')
    expect(mockClients.auth.validate).toHaveBeenCalled()
    expect(mockClients.users.listUsers).toHaveBeenCalledWith({ pageSize: 1 })
  })

  it('should return invalid when API key is invalid', async () => {
    const mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({ valid: false })
      },
      users: {
        listUsers: vi.fn()
      }
    } as unknown as DatadogClients

    const result = await validateCredentials(mockClients)

    expect(result.valid).toBe(false)
    expect(result.apiKeyValid).toBe(false)
    expect(result.appKeyValid).toBe(false)
    expect(result.error).toBe('API key is invalid')
    expect(result.suggestion).toContain('DD_API_KEY')
    expect(mockClients.users.listUsers).not.toHaveBeenCalled()
  })

  it('should handle 401 error for invalid App key', async () => {
    const mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({ valid: true })
      },
      users: {
        listUsers: vi.fn().mockRejectedValue(new Error('401 Unauthorized'))
      }
    } as unknown as DatadogClients

    const result = await validateCredentials(mockClients)

    expect(result.valid).toBe(false)
    expect(result.apiKeyValid).toBe(true)
    expect(result.appKeyValid).toBe(false)
    expect(result.warning).toContain('App key may be invalid')
    expect(result.suggestion).toContain('DD_APP_KEY')
  })

  it('should handle 403 error for insufficient permissions', async () => {
    const mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({ valid: true })
      },
      users: {
        listUsers: vi.fn().mockRejectedValue(new Error('403 Forbidden'))
      }
    } as unknown as DatadogClients

    const result = await validateCredentials(mockClients)

    expect(result.valid).toBe(false)
    expect(result.apiKeyValid).toBe(true)
    expect(result.appKeyValid).toBe(false)
    expect(result.warning).toContain('insufficient permissions')
  })

  it('should handle Forbidden error message', async () => {
    const mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({ valid: true })
      },
      users: {
        listUsers: vi.fn().mockRejectedValue(new Error('Forbidden access'))
      }
    } as unknown as DatadogClients

    const result = await validateCredentials(mockClients)

    expect(result.valid).toBe(false)
    expect(result.apiKeyValid).toBe(true)
    expect(result.appKeyValid).toBe(false)
  })

  it('should handle non-auth errors gracefully', async () => {
    const mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({ valid: true })
      },
      users: {
        listUsers: vi.fn().mockRejectedValue(new Error('Network timeout'))
      }
    } as unknown as DatadogClients

    const result = await validateCredentials(mockClients)

    expect(result.valid).toBe(true) // Not an auth error
    expect(result.apiKeyValid).toBe(true)
    expect(result.appKeyValid).toBe(true) // Not a definite auth failure
    expect(result.warning).toContain('inconclusive')
    expect(result.error).toBe('Network timeout')
  })

  it('should handle non-Error objects in catch block', async () => {
    const mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({ valid: true })
      },
      users: {
        listUsers: vi.fn().mockRejectedValue('String error message')
      }
    } as unknown as DatadogClients

    const result = await validateCredentials(mockClients)

    expect(result.valid).toBe(true)
    expect(result.error).toBe('String error message')
  })

  it('should detect 401 in middle of error message', async () => {
    const mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({ valid: true })
      },
      users: {
        listUsers: vi.fn().mockRejectedValue(new Error('Request failed with status 401'))
      }
    } as unknown as DatadogClients

    const result = await validateCredentials(mockClients)

    expect(result.valid).toBe(false)
    expect(result.appKeyValid).toBe(false)
  })

  it('should detect 403 in middle of error message', async () => {
    const mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({ valid: true })
      },
      users: {
        listUsers: vi.fn().mockRejectedValue(new Error('HTTP 403 - Access denied'))
      }
    } as unknown as DatadogClients

    const result = await validateCredentials(mockClients)

    expect(result.valid).toBe(false)
    expect(result.appKeyValid).toBe(false)
  })
})
