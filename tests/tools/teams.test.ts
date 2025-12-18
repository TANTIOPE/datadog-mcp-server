/**
 * Unit tests for the teams tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { teams as fixtures } from '../helpers/fixtures.js'
import { listTeams, getTeam, getTeamMembers } from '../../src/tools/teams.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

describe('Teams Tool', () => {
  let api: v2.TeamsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.TeamsApi(config)
  })

  describe('listTeams', () => {
    it('should list teams successfully', async () => {
      server.use(
        http.get(endpoints.listTeams, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listTeams(api, {}, defaultLimits)

      expect(result.teams).toHaveLength(2)
      expect(result.teams[0].name).toBe('Platform Team')
      expect(result.teams[0].handle).toBe('platform-team')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listTeams, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listTeams(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listTeams, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listTeams(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('getTeam', () => {
    it('should get a single team by ID', async () => {
      server.use(
        http.get(endpoints.getTeam('team-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getTeam(api, 'team-001')

      expect(result.team.id).toBe('team-001')
      expect(result.team.name).toBe('Platform Team')
      expect(result.team.description).toBe('Core platform engineering team')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getTeam('nonexistent'), () => {
          return errorResponse(404, 'Team not found')
        })
      )

      await expect(getTeam(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('getTeamMembers', () => {
    it('should get team members successfully', async () => {
      server.use(
        http.get(endpoints.getTeamMembers('team-001'), () => {
          return jsonResponse(fixtures.members)
        })
      )

      const result = await getTeamMembers(api, 'team-001', defaultLimits)

      expect(result.members).toHaveLength(2)
    })

    it('should handle 404 not found error for team members', async () => {
      server.use(
        http.get(endpoints.getTeamMembers('nonexistent'), () => {
          return errorResponse(404, 'Team not found')
        })
      )

      await expect(getTeamMembers(api, 'nonexistent', defaultLimits)).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
