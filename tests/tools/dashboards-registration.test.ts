import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerDashboardsTool } from '../../src/tools/dashboards.js'
import type { v1 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerDashboardsTool', () => {
  let mockServer: McpServer
  let mockApi: v1.DashboardsApi
  let limits: LimitsConfig
  let registeredHandler: (params: Record<string, unknown>) => Promise<unknown>

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listDashboards: vi.fn().mockResolvedValue({
        dashboards: [{ id: 'dash-123' }]
      }),
      getDashboard: vi.fn().mockResolvedValue({
        id: 'dash-123',
        title: 'Test Dashboard'
      }),
      createDashboard: vi.fn().mockResolvedValue({
        id: 'dash-new',
        title: 'New Dashboard'
      }),
      updateDashboard: vi.fn().mockResolvedValue({
        id: 'dash-123',
        title: 'Updated Dashboard'
      }),
      deleteDashboard: vi.fn().mockResolvedValue(undefined)
    } as unknown as v1.DashboardsApi

    limits = { maxResults: 100 }
  })

  it('should register dashboards tool', () => {
    registerDashboardsTool(mockServer, mockApi, limits, false)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'dashboards',
      expect.stringContaining('Access Datadog dashboards'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'list' })

    expect(result).toBeDefined()
    expect(mockApi.listDashboards).toHaveBeenCalled()
  })

  it('should handle get action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'get', id: 'dash-123' })

    expect(result).toBeDefined()
    expect(mockApi.getDashboard).toHaveBeenCalledWith({ dashboardId: 'dash-123' })
  })

  it('should handle create action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'create',
      config: { title: 'New Dashboard', layoutType: 'ordered' }
    })

    expect(result).toBeDefined()
    expect(mockApi.createDashboard).toHaveBeenCalled()
  })

  it('should handle update action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'update',
      id: 'dash-123',
      config: { title: 'Updated', layoutType: 'ordered' }
    })

    expect(result).toBeDefined()
    expect(mockApi.updateDashboard).toHaveBeenCalled()
  })

  it('should handle delete action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'delete', id: 'dash-123' })

    expect(result).toBeDefined()
    expect(mockApi.deleteDashboard).toHaveBeenCalledWith({ dashboardId: 'dash-123' })
  })

  it('should throw error for unknown action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })

  it('should throw error for get without id', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'get' })).rejects.toThrow()
  })

  it('should block write operations in read-only mode', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, true)

    await expect(registeredHandler({ action: 'create', config: {} })).rejects.toThrow()
  })
})
