/**
 * Unit tests for the security tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { security as securityFixtures } from '../helpers/fixtures.js'
import { listRules, getRule, searchSignals } from '../../src/tools/security.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

const defaultSite = 'datadoghq.com'

describe('Security Tool', () => {
  let api: v2.SecurityMonitoringApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.SecurityMonitoringApi(config)
  })

  describe('listRules', () => {
    it('should list security rules successfully', async () => {
      server.use(
        http.get(endpoints.listSecurityRules, () => {
          return jsonResponse(securityFixtures.rules)
        })
      )

      const result = await listRules(api, {}, defaultLimits)

      expect(result.rules).toHaveLength(2)
      expect(result.rules[0].name).toBe('Brute Force Detection')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listSecurityRules, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listRules(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listSecurityRules, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listRules(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('getRule', () => {
    it('should get a single security rule by ID', async () => {
      server.use(
        http.get(endpoints.getSecurityRule('rule-001'), () => {
          return jsonResponse(securityFixtures.singleRule)
        })
      )

      const result = await getRule(api, 'rule-001')

      expect(result.rule.id).toBe('rule-001')
      expect(result.rule.name).toBe('Brute Force Detection')
      expect(result.rule.isEnabled).toBe(true)
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getSecurityRule('nonexistent'), () => {
          return errorResponse(404, 'Rule not found')
        })
      )

      await expect(getRule(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('searchSignals', () => {
    it('should search security signals successfully', async () => {
      server.use(
        http.post(endpoints.searchSecuritySignals, () => {
          return jsonResponse(securityFixtures.signals)
        })
      )

      const result = await searchSignals(api, {}, defaultLimits, defaultSite)

      expect(result.signals).toHaveLength(2)
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.searchSecuritySignals, () => {
          return errorResponse(400, 'Invalid query')
        })
      )

      await expect(
        searchSignals(api, {}, defaultLimits, defaultSite)
      ).rejects.toMatchObject({
        code: 400
      })
    })

    it('should handle empty search results', async () => {
      server.use(
        http.post(endpoints.searchSecuritySignals, () => {
          return jsonResponse({ data: [] })
        })
      )

      const result = await searchSignals(api, {}, defaultLimits, defaultSite)

      expect(result.signals).toHaveLength(0)
    })
  })
})
