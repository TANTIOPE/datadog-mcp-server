import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerNotebooksTool } from '../../src/tools/notebooks.js'
import type { v1 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerNotebooksTool', () => {
  let mockServer: McpServer
  let mockApi: v1.NotebooksApi
  let limits: LimitsConfig
  let registeredHandler: (params: Record<string, unknown>) => Promise<unknown>

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listNotebooks: vi.fn().mockResolvedValue({
        data: [{ id: 1, attributes: { name: 'notebook1' } }]
      }),
      getNotebook: vi.fn().mockResolvedValue({
        data: { id: 1, attributes: { name: 'notebook1' } }
      }),
      createNotebook: vi.fn().mockResolvedValue({
        data: { id: 1, attributes: { name: 'new-notebook' } }
      }),
      updateNotebook: vi.fn().mockResolvedValue({
        data: { id: 1, attributes: { name: 'updated-notebook' } }
      }),
      deleteNotebook: vi.fn().mockResolvedValue(undefined)
    } as unknown as v1.NotebooksApi

    limits = { maxResults: 100 }
  })

  it('should register notebooks tool', () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'notebooks',
      expect.stringContaining('Manage Datadog Notebooks'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'list' })

    expect(result).toBeDefined()
    expect(mockApi.listNotebooks).toHaveBeenCalled()
  })

  it('should handle get action', async () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'get', id: 1 })

    expect(result).toBeDefined()
    expect(mockApi.getNotebook).toHaveBeenCalledWith({ notebookId: 1 })
  })

  it('should handle create action', async () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    const result = await registeredHandler({
      action: 'create',
      name: 'test-notebook',
      cells: []
    })

    expect(result).toBeDefined()
    expect(mockApi.createNotebook).toHaveBeenCalled()
  })

  it('should handle update action', async () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    const result = await registeredHandler({
      action: 'update',
      id: 1,
      name: 'updated-notebook'
    })

    expect(result).toBeDefined()
    expect(mockApi.updateNotebook).toHaveBeenCalled()
  })

  it('should handle delete action', async () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'delete', id: 1 })

    expect(result).toBeDefined()
    expect(mockApi.deleteNotebook).toHaveBeenCalledWith({ notebookId: 1 })
  })

  it('should throw error for unknown action', async () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })

  it('should throw error for get without id', async () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'get' })).rejects.toThrow()
  })

  it('should throw error for update without id', async () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'update' })).rejects.toThrow()
  })

  it('should throw error for delete without id', async () => {
    registerNotebooksTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'delete' })).rejects.toThrow()
  })
})
