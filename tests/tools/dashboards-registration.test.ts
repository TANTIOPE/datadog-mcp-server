import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerDashboardsTool, DatadogApiCredentials } from '../../src/tools/dashboards.js'
import type { v1 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerDashboardsTool', () => {
  let mockServer: McpServer
  let mockApi: v1.DashboardsApi
  let limits: LimitsConfig
  let credentials: DatadogApiCredentials
  let registeredHandler: (params: Record<string, unknown>) => Promise<unknown>
  let mockFetch: ReturnType<typeof vi.fn>

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
    credentials = {
      apiKey: 'test-api-key',
      appKey: 'test-app-key',
      site: 'datadoghq.com'
    }

    // Mock fetch for raw HTTP calls used by create/update
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'dash-new', title: 'New Dashboard', url: '/dash/dash-new' })
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should register dashboards tool', () => {
    registerDashboardsTool(mockServer, mockApi, limits, false, credentials)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'dashboards',
      expect.stringContaining('Access Datadog dashboards'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false, credentials)

    const result = await registeredHandler({ action: 'list' })

    expect(result).toBeDefined()
    expect(mockApi.listDashboards).toHaveBeenCalled()
  })

  it('should handle get action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false, credentials)

    const result = await registeredHandler({ action: 'get', id: 'dash-123' })

    expect(result).toBeDefined()
    expect(mockApi.getDashboard).toHaveBeenCalledWith({ dashboardId: 'dash-123' })
  })

  it('should handle create action via raw HTTP', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false, credentials)

    const result = await registeredHandler({
      action: 'create',
      config: { title: 'New Dashboard', layoutType: 'ordered' }
    })

    expect(result).toBeDefined()
    // create uses raw HTTP, not the typed client
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.datadoghq.com/api/v1/dashboard',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'DD-API-KEY': 'test-api-key',
          'DD-APPLICATION-KEY': 'test-app-key'
        })
      })
    )
  })

  it('should handle update action via raw HTTP', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false, credentials)

    const result = await registeredHandler({
      action: 'update',
      id: 'dash-123',
      config: { title: 'Updated', layoutType: 'ordered' }
    })

    expect(result).toBeDefined()
    // update uses raw HTTP, not the typed client
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.datadoghq.com/api/v1/dashboard/dash-123',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'DD-API-KEY': 'test-api-key',
          'DD-APPLICATION-KEY': 'test-app-key'
        })
      })
    )
  })

  it('should handle delete action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false, credentials)

    const result = await registeredHandler({ action: 'delete', id: 'dash-123' })

    expect(result).toBeDefined()
    expect(mockApi.deleteDashboard).toHaveBeenCalledWith({ dashboardId: 'dash-123' })
  })

  it('should throw error for unknown action', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false, credentials)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })

  it('should throw error for get without id', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, false, credentials)

    await expect(registeredHandler({ action: 'get' })).rejects.toThrow()
  })

  it('should block write operations in read-only mode', async () => {
    registerDashboardsTool(mockServer, mockApi, limits, true, credentials)

    await expect(registeredHandler({ action: 'create', config: {} })).rejects.toThrow()
  })
})
