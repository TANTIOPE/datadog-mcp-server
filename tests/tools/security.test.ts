/**
 * Unit tests for the security tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { security as securityFixtures } from '../helpers/fixtures.js'

describe('Security Tool', () => {
  let api: v2.SecurityMonitoringApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.SecurityMonitoringApi(config)
  })

  describe('listSecurityRules', () => {
    it('should list security rules successfully', async () => {
      server.use(
        http.get(endpoints.listSecurityRules, () => {
          return jsonResponse(securityFixtures.rules)
        })
      )

      const response = await api.listSecurityMonitoringRules({})

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0].name).toBe('Brute Force Detection')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listSecurityRules, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listSecurityMonitoringRules({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listSecurityRules, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listSecurityMonitoringRules({})).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('getSecurityRule', () => {
    it('should get a single security rule by ID', async () => {
      server.use(
        http.get(endpoints.getSecurityRule('rule-001'), () => {
          return jsonResponse(securityFixtures.singleRule)
        })
      )

      const response = await api.getSecurityMonitoringRule({ ruleId: 'rule-001' })

      expect(response.id).toBe('rule-001')
      expect(response.name).toBe('Brute Force Detection')
      expect(response.isEnabled).toBe(true)
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getSecurityRule('nonexistent'), () => {
          return errorResponse(404, 'Rule not found')
        })
      )

      await expect(api.getSecurityMonitoringRule({ ruleId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('searchSecuritySignals', () => {
    it('should search security signals successfully', async () => {
      server.use(
        http.post(endpoints.searchSecuritySignals, () => {
          return jsonResponse(securityFixtures.signals)
        })
      )

      const response = await api.searchSecurityMonitoringSignals({})

      expect(response.data).toHaveLength(2)
      // The SDK may return UnparsedObject for enum values
      const type = response.data?.[0].type
      const typeValue = (type as { _data?: string })?._data ?? type
      expect(typeValue).toBe('security_signal')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.searchSecuritySignals, () => {
          return errorResponse(400, 'Invalid query')
        })
      )

      await expect(api.searchSecurityMonitoringSignals({})).rejects.toMatchObject({
        code: 400
      })
    })

    it('should handle empty search results', async () => {
      server.use(
        http.post(endpoints.searchSecuritySignals, () => {
          return jsonResponse({ data: [] })
        })
      )

      const response = await api.searchSecurityMonitoringSignals({})

      expect(response.data).toHaveLength(0)
    })
  })
})
