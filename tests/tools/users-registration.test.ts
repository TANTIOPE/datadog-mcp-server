import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerUsersTool } from '../../src/tools/users.js'
import type { v2 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerUsersTool', () => {
  let mockServer: McpServer
  let mockApi: v2.UsersApi
  let limits: LimitsConfig
  let registeredHandler: any

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listUsers: vi.fn().mockResolvedValue({
        data: [{ id: 'user-1', attributes: { email: 'user@example.com' } }]
      }),
      getUser: vi.fn().mockResolvedValue({
        data: { id: 'user-1', attributes: { email: 'user@example.com' } }
      })
    } as unknown as v2.UsersApi

    limits = { maxResults: 100 }
  })

  it('should register users tool', () => {
    registerUsersTool(mockServer, mockApi, limits)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'users',
      expect.stringContaining('Manage Datadog users'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerUsersTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'list' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.listUsers).toHaveBeenCalled()
  })

  it('should handle get action', async () => {
    registerUsersTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'get', id: 'user-1' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.getUser).toHaveBeenCalledWith({ userId: 'user-1' })
  })

  it('should throw error for unknown action', async () => {
    registerUsersTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown')
  })

  it('should throw error for get without id', async () => {
    registerUsersTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'get' })).rejects.toThrow()
  })
})
