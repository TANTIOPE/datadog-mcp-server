import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { v2 } from '@datadog/datadog-api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerOnCallTool } from '../../src/tools/on_call.js'

describe('registerOnCallTool', () => {
  let mockServer: McpServer
  let mockApi: v2.OnCallApi
  let registeredHandler: (
    params: Record<string, unknown>
  ) => Promise<{ content: Array<{ text: string }> }>

  beforeEach(() => {
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredHandler = handler
      })
    } as unknown as McpServer

    mockApi = {
      getOnCallSchedule: vi.fn().mockResolvedValue({ data: { id: 'schedule-1' } }),
      getScheduleOnCallUser: vi.fn().mockResolvedValue({ data: { id: 'shift-1' } }),
      getTeamOnCallUsers: vi.fn().mockResolvedValue({ data: { id: 'team-1' } })
    } as unknown as v2.OnCallApi
  })

  it('registers the on_call tool', () => {
    registerOnCallTool(mockServer, mockApi)

    expect(mockServer.tool).toHaveBeenCalledWith(
      'on_call',
      expect.stringContaining('Query Datadog On-Call'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('handles get_schedule', async () => {
    registerOnCallTool(mockServer, mockApi)

    const result = await registeredHandler({
      action: 'get_schedule',
      scheduleId: 'schedule-1',
      include: 'teams,layers'
    })

    expect(result.content[0].text).toContain('schedule-1')
    expect(mockApi.getOnCallSchedule).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      include: 'teams,layers'
    })
  })

  it('handles schedule_responder', async () => {
    registerOnCallTool(mockServer, mockApi)

    const result = await registeredHandler({
      action: 'schedule_responder',
      scheduleId: 'schedule-1',
      include: 'user',
      atTimestamp: '2026-09-20T00:00:00Z'
    })

    expect(result.content[0].text).toContain('shift-1')
    expect(mockApi.getScheduleOnCallUser).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      include: 'user',
      filterAtTs: '2026-09-20T00:00:00Z'
    })
  })

  it('handles team_responders', async () => {
    registerOnCallTool(mockServer, mockApi)

    const result = await registeredHandler({
      action: 'team_responders',
      teamId: 'team-1',
      include: 'responders'
    })

    expect(result.content[0].text).toContain('team-1')
    expect(mockApi.getTeamOnCallUsers).toHaveBeenCalledWith({
      teamId: 'team-1',
      include: 'responders'
    })
  })

  it('requires the relevant resource ID', async () => {
    registerOnCallTool(mockServer, mockApi)

    await expect(registeredHandler({ action: 'get_schedule' })).rejects.toThrow()
    await expect(registeredHandler({ action: 'schedule_responder' })).rejects.toThrow()
    await expect(registeredHandler({ action: 'team_responders' })).rejects.toThrow()
  })

  it('explains the required permission for forbidden responses', async () => {
    mockApi.getOnCallSchedule = vi.fn().mockRejectedValue({ code: 403 })
    registerOnCallTool(mockServer, mockApi)

    await expect(
      registeredHandler({ action: 'get_schedule', scheduleId: 'schedule-1' })
    ).rejects.toThrow('on_call_read')
  })

  it('rejects unknown actions', async () => {
    registerOnCallTool(mockServer, mockApi)

    await expect(registeredHandler({ action: 'unknown' })).rejects.toThrow(
      'Unknown action: unknown'
    )
  })
})
