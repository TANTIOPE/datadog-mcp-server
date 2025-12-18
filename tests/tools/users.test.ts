/**
 * Unit tests for the users tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { users as fixtures } from '../helpers/fixtures.js'
import { listUsers, getUser } from '../../src/tools/users.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

describe('Users Tool', () => {
  let api: v2.UsersApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.UsersApi(config)
  })

  describe('listUsers', () => {
    it('should list users successfully', async () => {
      server.use(
        http.get(endpoints.listUsers, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listUsers(api, {}, defaultLimits)

      expect(result.users).toHaveLength(2)
      expect(result.users[0].name).toBe('John Doe')
      expect(result.users[0].email).toBe('john.doe@example.com')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listUsers, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listUsers(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listUsers, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listUsers(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('getUser', () => {
    it('should get a single user by ID', async () => {
      server.use(
        http.get(endpoints.getUser('user-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getUser(api, 'user-001')

      expect(result.user.id).toBe('user-001')
      expect(result.user.name).toBe('John Doe')
      expect(result.user.status).toBe('Active')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getUser('nonexistent'), () => {
          return errorResponse(404, 'User not found')
        })
      )

      await expect(getUser(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
