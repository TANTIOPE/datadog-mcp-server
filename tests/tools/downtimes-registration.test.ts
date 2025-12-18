import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerDowntimesTool } from '../../src/tools/downtimes.js'
import type { v2 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerDowntimesTool', () => {
  let mockServer: McpServer
  let mockApi: v2.DowntimesApi
  let limits: LimitsConfig
  let registeredHandler: (params: Record<string, unknown>) => Promise<unknown>

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listDowntimes: vi.fn().mockResolvedValue({
        data: [{ id: 'downtime-123', attributes: {} }]
      }),
      getDowntime: vi.fn().mockResolvedValue({
        data: { id: 'downtime-123', attributes: {} }
      }),
      createDowntime: vi.fn().mockResolvedValue({
        data: { id: 'downtime-new', attributes: {} }
      }),
      updateDowntime: vi.fn().mockResolvedValue({
        data: { id: 'downtime-123', attributes: {} }
      }),
      cancelDowntime: vi.fn().mockResolvedValue(undefined),
      listMonitorDowntimes: vi.fn().mockResolvedValue({
        data: [{ id: 'downtime-456', attributes: {} }]
      })
    } as unknown as v2.DowntimesApi

    limits = { maxResults: 100 }
  })

  it('should register downtimes tool', () => {
    registerDowntimesTool(mockServer, mockApi, limits, false)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'downtimes',
      expect.stringContaining('Manage Datadog scheduled downtimes'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerDowntimesTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'list' })

    expect(result).toBeDefined()
    expect(mockApi.listDowntimes).toHaveBeenCalled()
  })

  it('should handle get action', async () => {
    registerDowntimesTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'get', id: 'downtime-123' })

    expect(result).toBeDefined()
    expect(mockApi.getDowntime).toHaveBeenCalledWith({ downtimeId: 'downtime-123' })
  })

  it('should handle create action', async () => {
    registerDowntimesTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'create',
      config: { scope: 'env:prod' }
    })

    expect(result).toBeDefined()
    expect(mockApi.createDowntime).toHaveBeenCalled()
  })

  it('should handle update action', async () => {
    registerDowntimesTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'update',
      id: 'downtime-123',
      config: {}
    })

    expect(result).toBeDefined()
    expect(mockApi.updateDowntime).toHaveBeenCalled()
  })

  it('should handle cancel action', async () => {
    registerDowntimesTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'cancel', id: 'downtime-123' })

    expect(result).toBeDefined()
    expect(mockApi.cancelDowntime).toHaveBeenCalledWith({ downtimeId: 'downtime-123' })
  })

  it('should handle listByMonitor action', async () => {
    registerDowntimesTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'listByMonitor',
      monitorId: 12345
    })

    expect(result).toBeDefined()
    expect(mockApi.listMonitorDowntimes).toHaveBeenCalledWith({ monitorId: 12345 })
  })

  it('should throw error for unknown action', async () => {
    registerDowntimesTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })

  it('should throw error for get without id', async () => {
    registerDowntimesTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'get' })).rejects.toThrow()
  })

  it('should block write operations in read-only mode', async () => {
    registerDowntimesTool(mockServer, mockApi, limits, true)

    await expect(registeredHandler({ action: 'create', config: {} })).rejects.toThrow()
  })
})
