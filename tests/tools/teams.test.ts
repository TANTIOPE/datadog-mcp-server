/**
 * Unit tests for the teams tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { teams as fixtures } from '../helpers/fixtures.js'

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

      const response = await api.listTeams({})

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0].attributes?.name).toBe('Platform Team')
      expect(response.data?.[0].attributes?.handle).toBe('platform-team')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listTeams, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listTeams({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listTeams, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listTeams({})).rejects.toMatchObject({
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

      const response = await api.getTeam({ teamId: 'team-001' })

      expect(response.data?.id).toBe('team-001')
      expect(response.data?.attributes?.name).toBe('Platform Team')
      expect(response.data?.attributes?.description).toBe('Core platform engineering team')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getTeam('nonexistent'), () => {
          return errorResponse(404, 'Team not found')
        })
      )

      await expect(api.getTeam({ teamId: 'nonexistent' })).rejects.toMatchObject({
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

      const response = await api.getTeamMemberships({ teamId: 'team-001' })

      expect(response.data).toHaveLength(2)
    })

    it('should handle 404 not found error for team members', async () => {
      server.use(
        http.get(endpoints.getTeamMembers('nonexistent'), () => {
          return errorResponse(404, 'Team not found')
        })
      )

      await expect(api.getTeamMemberships({ teamId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
