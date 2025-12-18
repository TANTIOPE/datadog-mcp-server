import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDatadogClients } from '../../src/config/datadog.js'
import type { DatadogConfig } from '../../src/config/schema.js'
import { client } from '@datadog/datadog-api-client'

// Mock the Datadog SDK
vi.mock('@datadog/datadog-api-client', () => {
  const mockConfiguration = {
    setServerVariables: vi.fn(),
    unstableOperations: {}
  }

  const createConfiguration = vi.fn(() => mockConfiguration)

  // Mock API classes
  class MockApi {
    constructor(public config: unknown) {}
  }

  return {
    client: {
      createConfiguration
    },
    v1: {
      MonitorsApi: MockApi,
      DashboardsApi: MockApi,
      DashboardListsApi: MockApi,
      MetricsApi: MockApi,
      EventsApi: MockApi,
      HostsApi: MockApi,
      ServiceLevelObjectivesApi: MockApi,
      SyntheticsApi: MockApi,
      NotebooksApi: MockApi,
      TagsApi: MockApi,
      UsageMeteringApi: MockApi,
      AuthenticationApi: MockApi
    },
    v2: {
      LogsApi: MockApi,
      MetricsApi: MockApi,
      EventsApi: MockApi,
      IncidentsApi: MockApi,
      DowntimesApi: MockApi,
      RUMApi: MockApi,
      SecurityMonitoringApi: MockApi,
      UsersApi: MockApi,
      TeamsApi: MockApi,
      SpansApi: MockApi,
      ServiceDefinitionApi: MockApi
    }
  }
})

describe('Datadog Client Creation', () => {
  const mockConfig: DatadogConfig = {
    apiKey: 'test-api-key',
    appKey: 'test-app-key',
    site: 'datadoghq.com'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createDatadogClients', () => {
    it('should create all required API clients', () => {
      const clients = createDatadogClients(mockConfig)

      // Verify all v1 APIs
      expect(clients.monitors).toBeDefined()
      expect(clients.dashboards).toBeDefined()
      expect(clients.dashboardLists).toBeDefined()
      expect(clients.metricsV1).toBeDefined()
      expect(clients.eventsV1).toBeDefined()
      expect(clients.hosts).toBeDefined()
      expect(clients.slo).toBeDefined()
      expect(clients.synthetics).toBeDefined()
      expect(clients.notebooks).toBeDefined()
      expect(clients.tags).toBeDefined()
      expect(clients.usage).toBeDefined()
      expect(clients.auth).toBeDefined()

      // Verify all v2 APIs
      expect(clients.logs).toBeDefined()
      expect(clients.metricsV2).toBeDefined()
      expect(clients.eventsV2).toBeDefined()
      expect(clients.incidents).toBeDefined()
      expect(clients.downtimes).toBeDefined()
      expect(clients.rum).toBeDefined()
      expect(clients.security).toBeDefined()
      expect(clients.users).toBeDefined()
      expect(clients.teams).toBeDefined()
      expect(clients.spans).toBeDefined()
      expect(clients.services).toBeDefined()
    })

    it('should create configuration with correct auth credentials', () => {
      createDatadogClients(mockConfig)

      expect(client.createConfiguration).toHaveBeenCalledWith({
        authMethods: {
          apiKeyAuth: 'test-api-key',
          appKeyAuth: 'test-app-key'
        }
      })
    })

    it('should not set server variables for default site', () => {
      const mockConfiguration = (client.createConfiguration as unknown)()

      createDatadogClients(mockConfig)

      expect(mockConfiguration.setServerVariables).not.toHaveBeenCalled()
    })

    it('should set server variables for EU site', () => {
      const mockConfiguration = (client.createConfiguration as unknown)()

      const euConfig: DatadogConfig = {
        ...mockConfig,
        site: 'datadoghq.eu'
      }

      createDatadogClients(euConfig)

      expect(mockConfiguration.setServerVariables).toHaveBeenCalledWith({
        site: 'datadoghq.eu'
      })
    })

    it('should set server variables for US3 site', () => {
      const mockConfiguration = (client.createConfiguration as unknown)()

      const us3Config: DatadogConfig = {
        ...mockConfig,
        site: 'us3.datadoghq.com'
      }

      createDatadogClients(us3Config)

      expect(mockConfiguration.setServerVariables).toHaveBeenCalledWith({
        site: 'us3.datadoghq.com'
      })
    })

    it('should enable unstable operations for incidents API', () => {
      const mockConfiguration = (client.createConfiguration as unknown)()

      createDatadogClients(mockConfig)

      expect(mockConfiguration.unstableOperations).toEqual({
        'v2.listIncidents': true,
        'v2.getIncident': true,
        'v2.searchIncidents': true,
        'v2.createIncident': true,
        'v2.updateIncident': true,
        'v2.deleteIncident': true
      })
    })

    it('should return clients with correct configuration', () => {
      const mockConfiguration = (client.createConfiguration as unknown)()

      const clients = createDatadogClients(mockConfig)

      // Check that each client was instantiated with the configuration
      expect(clients.monitors.config).toBe(mockConfiguration)
      expect(clients.logs.config).toBe(mockConfiguration)
      expect(clients.incidents.config).toBe(mockConfiguration)
    })
  })
})
