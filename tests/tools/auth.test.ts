/**
 * Unit tests for the auth tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1, v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { auth as fixtures, users as userFixtures } from '../helpers/fixtures.js'
import { validateCredentials } from '../../src/tools/auth.js'
import type { DatadogClients } from '../../src/config/datadog.js'

describe('Auth Tool', () => {
  let clients: DatadogClients

  beforeEach(() => {
    const config = createMockConfig()
    clients = {
      monitors: new v1.MonitorsApi(config),
      dashboards: new v1.DashboardsApi(config),
      dashboardLists: new v1.DashboardListsApi(config),
      logs: new v2.LogsApi(config),
      metricsV1: new v1.MetricsApi(config),
      metricsV2: new v2.MetricsApi(config),
      eventsV1: new v1.EventsApi(config),
      eventsV2: new v2.EventsApi(config),
      incidents: new v2.IncidentsApi(config),
      downtimes: new v2.DowntimesApi(config),
      hosts: new v1.HostsApi(config),
      slo: new v1.ServiceLevelObjectivesApi(config),
      synthetics: new v1.SyntheticsApi(config),
      rum: new v2.RUMApi(config),
      security: new v2.SecurityMonitoringApi(config),
      notebooks: new v1.NotebooksApi(config),
      users: new v2.UsersApi(config),
      teams: new v2.TeamsApi(config),
      tags: new v1.TagsApi(config),
      usage: new v1.UsageMeteringApi(config),
      spans: new v2.SpansApi(config),
      services: new v2.ServiceDefinitionApi(config),
      auth: new v1.AuthenticationApi(config)
    }
  })

  describe('validateCredentials', () => {
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

      const result = await validateCredentials(clients)
      expect(result.apiKeyValid).toBe(true)
      expect(result.appKeyValid).toBe(true)
    })

    it('should handle invalid API key', async () => {
      server.use(
        http.get(endpoints.validateApiKey, () => {
          return jsonResponse(fixtures.invalid)
        })
      )

      const result = await validateCredentials(clients)
      expect(result.apiKeyValid).toBe(false)
    })

    it('should handle 401 unauthorized for API key validation', async () => {
      server.use(
        http.get(endpoints.validateApiKey, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(validateCredentials(clients)).rejects.toMatchObject({
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

      const result = await validateCredentials(clients)
      expect(result.apiKeyValid).toBe(true)
      expect(result.appKeyValid).toBe(false)
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

      const result = await validateCredentials(clients)
      expect(result.apiKeyValid).toBe(true)
      expect(result.appKeyValid).toBe(false)
    })
  })
})
