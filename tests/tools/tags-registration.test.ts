import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerTagsTool } from '../../src/tools/tags.js'
import type { v1 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerTagsTool', () => {
  let mockServer: McpServer
  let mockApi: v1.TagsApi
  let limits: LimitsConfig
  let registeredHandler: any

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listHostTags: vi.fn().mockResolvedValue({
        tags: { host1: ['tag1', 'tag2'] }
      }),
      getHostTags: vi.fn().mockResolvedValue({
        tags: ['tag1', 'tag2']
      }),
      createHostTags: vi.fn().mockResolvedValue({
        host: 'host1',
        tags: ['tag1', 'tag2', 'tag3']
      }),
      updateHostTags: vi.fn().mockResolvedValue({
        host: 'host1',
        tags: ['tag1', 'tag2']
      }),
      deleteHostTags: vi.fn().mockResolvedValue(undefined)
    } as unknown as v1.TagsApi

    limits = { maxResults: 100 }
  })

  it('should register tags tool', () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'tags',
      expect.stringContaining('Manage Datadog host tags'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'list' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.listHostTags).toHaveBeenCalled()
  })

  it('should handle get action', async () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({ action: 'get', hostName: 'host1' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.getHostTags).toHaveBeenCalledWith({
      hostName: 'host1',
      source: undefined
    })
  })

  it('should handle add action', async () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'add',
      hostName: 'host1',
      tags: ['tag3']
    })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.createHostTags).toHaveBeenCalled()
  })

  it('should handle update action', async () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'update',
      hostName: 'host1',
      tags: ['tag1', 'tag2']
    })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.updateHostTags).toHaveBeenCalled()
  })

  it('should handle delete action', async () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    const result = await registeredHandler({
      action: 'delete',
      hostName: 'host1'
    })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.deleteHostTags).toHaveBeenCalledWith({
      hostName: 'host1',
      source: undefined
    })
  })

  it('should throw error for unknown action', async () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })

  it('should throw error for get without hostName', async () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'get' })).rejects.toThrow()
  })

  it('should throw error for add without hostName', async () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'add', tags: ['tag1'] })).rejects.toThrow()
  })

  it('should throw error for add without tags', async () => {
    registerTagsTool(mockServer, mockApi, limits, false)

    await expect(registeredHandler({ action: 'add', hostName: 'host1' })).rejects.toThrow()
  })

  it('should block write operations in read-only mode', async () => {
    registerTagsTool(mockServer, mockApi, limits, true)

    await expect(
      registeredHandler({ action: 'add', hostName: 'host1', tags: ['tag1'] })
    ).rejects.toThrow()
  })
})
