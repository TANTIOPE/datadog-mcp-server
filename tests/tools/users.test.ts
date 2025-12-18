/**
 * Unit tests for the users tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { users as fixtures } from '../helpers/fixtures.js'

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

      const response = await api.listUsers({})

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0].attributes?.name).toBe('John Doe')
      expect(response.data?.[0].attributes?.email).toBe('john.doe@example.com')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listUsers, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listUsers({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listUsers, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listUsers({})).rejects.toMatchObject({
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

      const response = await api.getUser({ userId: 'user-001' })

      expect(response.data?.id).toBe('user-001')
      expect(response.data?.attributes?.name).toBe('John Doe')
      expect(response.data?.attributes?.status).toBe('Active')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getUser('nonexistent'), () => {
          return errorResponse(404, 'User not found')
        })
      )

      await expect(api.getUser({ userId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
