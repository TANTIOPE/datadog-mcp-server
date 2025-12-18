import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerTeamsTool } from '../../src/tools/teams.js'
import type { v2 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LimitsConfig } from '../../src/config/schema.js'

describe('registerTeamsTool', () => {
  let mockServer: McpServer
  let mockApi: v2.TeamsApi
  let limits: LimitsConfig
  let registeredHandler: any

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      listTeams: vi.fn().mockResolvedValue({
        data: [{ id: 'team-1', attributes: { name: 'Team 1' } }]
      }),
      getTeam: vi.fn().mockResolvedValue({
        data: { id: 'team-1', attributes: { name: 'Team 1' } }
      }),
      getTeamMemberships: vi.fn().mockResolvedValue({
        data: [{ id: 'member-1', attributes: { role: 'admin' } }]
      })
    } as unknown as v2.TeamsApi

    limits = { maxResults: 100 }
  })

  it('should register teams tool', () => {
    registerTeamsTool(mockServer, mockApi, limits)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'teams',
      expect.stringContaining('Manage Datadog teams'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should handle list action', async () => {
    registerTeamsTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'list' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.listTeams).toHaveBeenCalled()
  })

  it('should handle get action', async () => {
    registerTeamsTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'get', id: 'team-1' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.getTeam).toHaveBeenCalledWith({ teamId: 'team-1' })
  })

  it('should handle members action', async () => {
    registerTeamsTool(mockServer, mockApi, limits)

    const result = await registeredHandler({ action: 'members', id: 'team-1' })

    expect(result.content[0].text).toBeDefined()
    expect(mockApi.getTeamMemberships).toHaveBeenCalled()
  })

  it('should throw error for unknown action', async () => {
    registerTeamsTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })

  it('should throw error for get without id', async () => {
    registerTeamsTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'get' })).rejects.toThrow()
  })

  it('should throw error for members without id', async () => {
    registerTeamsTool(mockServer, mockApi, limits)

    await expect(registeredHandler({ action: 'members' })).rejects.toThrow()
  })
})
