import { beforeEach, describe, expect, it } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import {
  getOnCallSchedule,
  getScheduleResponder,
  getTeamResponders
} from '../../src/tools/on_call.js'

describe('On-Call Tool', () => {
  let api: v2.OnCallApi

  beforeEach(() => {
    api = new v2.OnCallApi(createMockConfig())
  })

  it('gets a schedule with included resources', async () => {
    server.use(
      http.get(endpoints.getOnCallSchedule('schedule-1'), ({ request }) => {
        expect(new URL(request.url).searchParams.get('include')).toBe('teams,layers')
        return jsonResponse({
          data: {
            id: 'schedule-1',
            type: 'schedules',
            attributes: { name: 'Primary', time_zone: 'UTC' }
          },
          included: [{ id: 'team-1', type: 'teams' }]
        })
      })
    )

    const result = await getOnCallSchedule(api, 'schedule-1', 'teams,layers')

    expect(result.schedule?.id).toBe('schedule-1')
    expect(result.included).toHaveLength(1)
  })

  it('gets the schedule responder at a timestamp', async () => {
    server.use(
      http.get(endpoints.getScheduleResponder('schedule-1'), ({ request }) => {
        const params = new URL(request.url).searchParams
        expect(params.get('include')).toBe('user')
        expect(params.get('filter[at_ts]')).toBe('2026-09-20T00:00:00Z')
        return jsonResponse({
          data: {
            id: 'shift-1',
            type: 'shifts',
            relationships: { user: { data: { id: 'user-1', type: 'users' } } }
          },
          included: [{ id: 'user-1', type: 'users', attributes: { name: 'Primary SRE' } }]
        })
      })
    )

    const result = await getScheduleResponder(api, 'schedule-1', 'user', '2026-09-20T00:00:00Z')

    expect(result.shift?.id).toBe('shift-1')
    expect(result.included).toHaveLength(1)
  })

  it('gets current team responders', async () => {
    server.use(
      http.get(endpoints.getTeamResponders('team-1'), ({ request }) => {
        expect(new URL(request.url).searchParams.get('include')).toBe(
          'responders,escalations.responders'
        )
        return jsonResponse({
          data: {
            id: 'team-1',
            type: 'team_oncall_responders',
            relationships: {
              responders: { data: [{ id: 'user-1', type: 'users' }] }
            }
          }
        })
      })
    )

    const result = await getTeamResponders(api, 'team-1', 'responders,escalations.responders')

    expect(result.team?.id).toBe('team-1')
  })

  it('propagates forbidden responses for permission handling', async () => {
    server.use(
      http.get(endpoints.getOnCallSchedule('schedule-1'), () =>
        errorResponse(403, 'Requires on_call_read permission')
      )
    )

    await expect(getOnCallSchedule(api, 'schedule-1')).rejects.toMatchObject({ code: 403 })
  })
})
