import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { v2 } from '@datadog/datadog-api-client'
import { z } from 'zod'
import { DatadogErrorCode, handleDatadogError, requireParam } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'

const ActionSchema = z.enum(['get_schedule', 'schedule_responder', 'team_responders'])

const InputSchema = {
  action: ActionSchema.describe('On-Call lookup to perform'),
  scheduleId: z
    .string()
    .optional()
    .describe('Schedule ID (required for get_schedule and schedule_responder)'),
  teamId: z.string().optional().describe('Team ID (required for team_responders)'),
  include: z
    .string()
    .optional()
    .describe('Comma-separated related resources to include. Allowed values depend on the action.'),
  atTimestamp: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('RFC 3339 timestamp for schedule_responder; defaults to the current time')
}

export async function getOnCallSchedule(api: v2.OnCallApi, scheduleId: string, include?: string) {
  const response = await api.getOnCallSchedule({ scheduleId, include })

  return {
    schedule: response.data ?? null,
    included: response.included ?? []
  }
}

export async function getScheduleResponder(
  api: v2.OnCallApi,
  scheduleId: string,
  include?: string,
  atTimestamp?: string
) {
  const response = await api.getScheduleOnCallUser({
    scheduleId,
    include,
    filterAtTs: atTimestamp
  })

  return {
    shift: response.data ?? null,
    included: response.included ?? []
  }
}

export async function getTeamResponders(api: v2.OnCallApi, teamId: string, include?: string) {
  const response = await api.getTeamOnCallUsers({ teamId, include })

  return {
    team: response.data ?? null,
    included: response.included ?? []
  }
}

export function registerOnCallTool(server: McpServer, api: v2.OnCallApi): void {
  server.tool(
    'on_call',
    'Query Datadog On-Call schedules and responders. Actions: get_schedule (schedule configuration by ID), schedule_responder (on-call user for a schedule now or at a timestamp), team_responders (current responders and escalations for a team). Requires on_call_read permission.',
    InputSchema,
    async ({ action, scheduleId, teamId, include, atTimestamp }) => {
      try {
        switch (action) {
          case 'get_schedule':
            return toolResult(
              await getOnCallSchedule(api, requireParam(scheduleId, 'scheduleId', action), include)
            )

          case 'schedule_responder':
            return toolResult(
              await getScheduleResponder(
                api,
                requireParam(scheduleId, 'scheduleId', action),
                include,
                atTimestamp
              )
            )

          case 'team_responders':
            return toolResult(
              await getTeamResponders(api, requireParam(teamId, 'teamId', action), include)
            )

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        if ((error as { code?: number }).code === 403) {
          throw new McpError(
            DatadogErrorCode.Forbidden,
            'Authorization denied: Datadog application key requires on_call_read permission'
          )
        }
        handleDatadogError(error)
      }
    }
  )
}
