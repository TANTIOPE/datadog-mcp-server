import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerIncidentsTool } from '../../src/tools/incidents.js'
import type { v2 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerIncidentsTool', () => {
  let mockServer: McpServer
  let mockApi: v2.IncidentsApi
  let limits: LimitsConfig
  let registeredHandler: (params: Record<string, unknown>) => Promise<unknown>

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listIncidents: vi.fn().mockResolvedValue({
        data: [{ id: 'incident-123', attributes: {} }]
      }),
      getIncident: vi.fn().mockResolvedValue({
        data: { id: 'incident-123', attributes: {} }
      }),
      createIncident: vi.fn().mockResolvedValue({
        data: { id: 'incident-new', attributes: {} }
      }),
      updateIncident: vi.fn().mockResolvedValue({
        data: { id: 'incident-123', attributes: {} }
      }),
      deleteIncident: vi.fn().mockResolvedValue(undefined),
      searchIncidents: vi.fn().mockResolvedValue({
        data: { attributes: { incidents: [] } }
      })
    } as unknown as v2.IncidentsApi

    limits = { maxResults: 100 }
  })

  it('should register incidents tool', () => {
    registerIncidentsTool(mockServer, mockApi, limits, false)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'incidents',
      expect.stringContaining('Manage Datadog incidents'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerIncidentsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'list' })

    expect(result).toBeDefined()
    expect(mockApi.listIncidents).toHaveBeenCalled()
  })

  it('should handle get action', async () => {
    registerIncidentsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'get', id: 'incident-123' })

    expect(result).toBeDefined()
    expect(mockApi.getIncident).toHaveBeenCalledWith({
      incidentId: 'incident-123'
    })
  })

  it('should handle create action', async () => {
    registerIncidentsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'create',
      config: { title: 'New Incident' }
    })

    expect(result).toBeDefined()
    expect(mockApi.createIncident).toHaveBeenCalled()
  })

  it('should handle update action', async () => {
    registerIncidentsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'update',
      id: 'incident-123',
      config: { title: 'Updated' }
    })

    expect(result).toBeDefined()
    expect(mockApi.updateIncident).toHaveBeenCalled()
  })

  it('should handle delete action', async () => {
    registerIncidentsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'delete',
      id: 'incident-123'
    })

    expect(result).toBeDefined()
    expect(mockApi.deleteIncident).toHaveBeenCalledWith({
      incidentId: 'incident-123'
    })
  })

  it('should handle search action', async () => {
    registerIncidentsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'search',
      query: 'test'
    })

    expect(result).toBeDefined()
    expect(mockApi.searchIncidents).toHaveBeenCalled()
  })

  it('should throw error for unknown action', async () => {
    registerIncidentsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })

  it('should throw error for get without id', async () => {
    registerIncidentsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'get' })).rejects.toThrow()
  })

  it('should block write operations in read-only mode', async () => {
    registerIncidentsTool(mockServer, mockApi, limits, true)

    await expect(registeredHandler({ action: 'create', config: {} })).rejects.toThrow()
  })
})
