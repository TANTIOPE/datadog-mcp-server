import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerHostsTool } from '../../src/tools/hosts.js'
import type { v1 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerHostsTool', () => {
  let mockServer: McpServer
  let mockApi: v1.HostsApi
  let limits: LimitsConfig
  let registeredHandler: (params: Record<string, unknown>) => Promise<unknown>

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listHosts: vi.fn().mockResolvedValue({
        hostList: [{ name: 'host1' }]
      }),
      getHostTotals: vi.fn().mockResolvedValue({
        totalActive: 10
      }),
      muteHost: vi.fn().mockResolvedValue({
        hostname: 'host1',
        action: 'Muted'
      }),
      unmuteHost: vi.fn().mockResolvedValue({
        hostname: 'host1',
        action: 'Unmuted'
      })
    } as unknown as v1.HostsApi

    limits = { maxResults: 100 }
  })

  it('should register hosts tool', () => {
    registerHostsTool(mockServer, mockApi, limits, false)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'hosts',
      expect.stringContaining('Manage Datadog infrastructure hosts'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerHostsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'list' })

    expect(result).toBeDefined()
    expect(mockApi.listHosts).toHaveBeenCalled()
  })

  it('should handle totals action', async () => {
    registerHostsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'totals' })

    expect(result).toBeDefined()
    expect(mockApi.getHostTotals).toHaveBeenCalled()
  })

  it('should handle mute action', async () => {
    registerHostsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'mute', hostName: 'host1' })

    expect(result).toBeDefined()
    expect(mockApi.muteHost).toHaveBeenCalled()
  })

  it('should handle unmute action', async () => {
    registerHostsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'unmute', hostName: 'host1' })

    expect(result).toBeDefined()
    expect(mockApi.unmuteHost).toHaveBeenCalled()
  })

  it('should throw error for unknown action', async () => {
    registerHostsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })

  it('should throw error for mute without hostName', async () => {
    registerHostsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'mute' })).rejects.toThrow()
  })

  it('should throw error for unmute without hostName', async () => {
    registerHostsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'unmute' })).rejects.toThrow()
  })

  it('should block write operations in read-only mode', async () => {
    registerHostsTool(mockServer, mockApi, limits, true)

    await expect(registeredHandler({ action: 'mute', hostName: 'host1' })).rejects.toThrow()
  })
})
