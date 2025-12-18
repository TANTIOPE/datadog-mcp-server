import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerAuthTool } from '../../src/tools/auth.js'
import type { DatadogClients } from '../../src/config/datadog.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

describe('registerAuthTool', () => {
  let mockServer: McpServer
  let mockClients: DatadogClients
  let registeredHandler: (params: unknown) => Promise<unknown>

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockClients = {
      auth: {
        validate: vi.fn().mockResolvedValue({
          data: { valid: true }
        })
      }
    } as unknown as DatadogClients
  })

  it('should register auth tool', () => {
    registerAuthTool(mockServer, mockClients)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'auth',
      expect.stringContaining('Validate Datadog API credentials'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle validate action', async () => {
    registerAuthTool(mockServer, mockClients)

    const result = await registeredHandler({ action: 'validate' })

    expect(result.content[0].text).toBeDefined()
  })

  it('should throw error for unknown action', async () => {
    registerAuthTool(mockServer, mockClients)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown')
  })
})
