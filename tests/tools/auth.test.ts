/**
 * Unit tests for the auth tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1, v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { auth as fixtures, users as userFixtures } from '../helpers/fixtures.js'

describe('Auth Tool', () => {
  let authApi: v1.AuthenticationApi
  let usersApi: v2.UsersApi

  beforeEach(() => {
    const config = createMockConfig()
    authApi = new v1.AuthenticationApi(config)
    usersApi = new v2.UsersApi(config)
  })

  describe('validate', () => {
    it('should return valid when both API key and App key are valid', async () => {
      // Setup successful responses for both API key validation and user list
      server.use(
        http.get(endpoints.validateApiKey, () => {
          return jsonResponse(fixtures.valid)
        }),
        http.get(endpoints.listUsers, () => {
          return jsonResponse(userFixtures.list)
        })
      )

      // Validate API key
      const authResult = await authApi.validate()
      expect(authResult.valid).toBe(true)

      // App key validation via users list
      const usersResult = await usersApi.listUsers({ pageSize: 1 })
      expect(usersResult.data).toBeDefined()
    })

    it('should handle invalid API key', async () => {
      server.use(
        http.get(endpoints.validateApiKey, () => {
          return jsonResponse(fixtures.invalid)
        })
      )

      const result = await authApi.validate()
      expect(result.valid).toBe(false)
    })

    it('should handle 401 unauthorized for API key validation', async () => {
      server.use(
        http.get(endpoints.validateApiKey, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(authApi.validate()).rejects.toMatchObject({
        code: 401
      })
    })

    it('should detect invalid App key when API key is valid but users call fails with 403', async () => {
      server.use(
        http.get(endpoints.validateApiKey, () => {
          return jsonResponse(fixtures.valid)
        }),
        http.get(endpoints.listUsers, () => {
          return errorResponse(403, 'Forbidden - Invalid application key')
        })
      )

      // API key validation should succeed
      const authResult = await authApi.validate()
      expect(authResult.valid).toBe(true)

      // App key validation via users list should fail
      await expect(usersApi.listUsers({ pageSize: 1 })).rejects.toMatchObject({
        code: 403
      })
    })

    it('should detect invalid App key when API key is valid but users call fails with 401', async () => {
      server.use(
        http.get(endpoints.validateApiKey, () => {
          return jsonResponse(fixtures.valid)
        }),
        http.get(endpoints.listUsers, () => {
          return errorResponse(401, 'Invalid application key')
        })
      )

      // API key validation should succeed
      const authResult = await authApi.validate()
      expect(authResult.valid).toBe(true)

      // App key validation via users list should fail
      await expect(usersApi.listUsers({ pageSize: 1 })).rejects.toMatchObject({
        code: 401
      })
    })
  })
})
