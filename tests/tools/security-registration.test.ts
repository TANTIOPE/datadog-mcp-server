import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerSecurityTool } from '../../src/tools/security.js'
import type { v2 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerSecurityTool', () => {
  let mockServer: McpServer
  let mockApi: v2.SecurityMonitoringApi
  let limits: LimitsConfig
  let registeredHandler: any

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listSecurityMonitoringRules: vi.fn().mockResolvedValue({
        data: [{ id: 'rule-1', name: 'Test Rule' }]
      }),
      getSecurityMonitoringRule: vi.fn().mockResolvedValue({
        id: 'rule-1',
        name: 'Test Rule'
      }),
      searchSecurityMonitoringSignals: vi.fn().mockResolvedValue({
        data: [{ id: 'signal-1' }],
        meta: { page: {} }
      }),
      listSecurityMonitoringSignals: vi.fn().mockResolvedValue({
        data: [{ id: 'signal-1' }],
        meta: { page: {} }
      })
    } as unknown as v2.SecurityMonitoringApi

    limits = { maxResults: 100 }
  })

  it('should register security tool', () => {
    registerSecurityTool(mockServer, mockApi, limits)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'security',
      expect.stringContaining('Query Datadog Security Monitoring'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle rules action without id', async () => {
    registerSecurityTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'rules' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.listSecurityMonitoringRules).toHaveBeenCalled()
  })

  it('should handle rules action with id', async () => {
    registerSecurityTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'rules', id: 'rule-1' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.getSecurityMonitoringRule).toHaveBeenCalledWith({ ruleId: 'rule-1' })
  })

  it('should handle signals action', async () => {
    registerSecurityTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'signals', query: 'test' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalled()
  })

  it('should handle findings action', async () => {
    registerSecurityTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'findings' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalled()
  })

  it('should throw error for unknown action', async () => {
    registerSecurityTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown')
  })
})
