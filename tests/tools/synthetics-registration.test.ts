import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerSyntheticsTool } from '../../src/tools/synthetics.js'
import type { v1 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerSyntheticsTool', () => {
  let mockServer: McpServer
  let mockApi: v1.SyntheticsApi
  let limits: LimitsConfig
  let registeredHandler: (params: Record<string, unknown>) => Promise<unknown>

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listTests: vi.fn().mockResolvedValue({
        tests: [{ publicId: 'test-123' }]
      }),
      getTest: vi.fn().mockResolvedValue({
        publicId: 'test-123',
        name: 'Test'
      }),
      getAPITest: vi.fn().mockResolvedValue({
        publicId: 'test-123',
        name: 'Test'
      }),
      getBrowserTest: vi.fn().mockResolvedValue({
        publicId: 'test-123',
        name: 'Test'
      }),
      createSyntheticsAPITest: vi.fn().mockResolvedValue({
        publicId: 'test-new',
        name: 'New Test'
      }),
      updateAPITest: vi.fn().mockResolvedValue({
        publicId: 'test-123',
        name: 'Updated Test'
      }),
      deleteTests: vi.fn().mockResolvedValue({
        deletedTests: [{ publicId: 'test-123' }]
      }),
      triggerCITests: vi.fn().mockResolvedValue({
        results: []
      }),
      getBrowserTestLatestResults: vi.fn().mockResolvedValue({
        results: []
      })
    } as unknown as v1.SyntheticsApi

    limits = { maxResults: 100 }
  })

  it('should register synthetics tool', () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'synthetics',
      expect.stringContaining('Manage Datadog Synthetic tests'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'list' })

    expect(result).toBeDefined()
    expect(mockApi.listTests).toHaveBeenCalled()
  })

  it('should handle get action', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'get', id: 'test-123' })

    expect(result).toBeDefined()
    expect(mockApi.getTest).toHaveBeenCalledWith({ publicId: 'test-123' })
  })

  it('should handle create action', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'create',
      config: { name: 'New Test', type: 'api', locations: ['aws:us-east-1'] }
    })

    expect(result).toBeDefined()
    expect(mockApi.createSyntheticsAPITest).toHaveBeenCalled()
  })

  it('should handle update action', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'update',
      id: 'test-123',
      config: { name: 'Updated', locations: ['aws:us-east-1'] }
    })

    expect(result).toBeDefined()
    expect(mockApi.updateAPITest).toHaveBeenCalled()
  })

  it('should handle delete action', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'delete', id: 'test-123' })

    expect(result).toBeDefined()
    expect(mockApi.deleteTests).toHaveBeenCalled()
  })

  it('should handle trigger action', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'trigger',
      ids: ['test-123']
    })

    expect(result).toBeDefined()
    expect(mockApi.triggerCITests).toHaveBeenCalled()
  })

  it('should handle results action', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'results', id: 'test-123' })

    expect(result).toBeDefined()
    expect(mockApi.getBrowserTestLatestResults).toHaveBeenCalled()
  })

  it('should throw error for unknown action', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })

  it('should throw error for get without id', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'get' })).rejects.toThrow()
  })

  it('should block write operations in read-only mode', async () => {
    registerSyntheticsTool(mockServer, mockApi, limits, true)

    await expect(registeredHandler({ action: 'create', config: {} })).rejects.toThrow()
  })
})
