import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerAllTools } from '../../src/tools/index.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { DatadogClients } from '../../src/config/datadog.js'
import type { LimitsConfig, FeaturesConfig } from '../../src/config/schema.js'

// Mock all register functions
vi.mock('../../src/tools/monitors.js', () => ({ registerMonitorsTool: vi.fn() }))
vi.mock('../../src/tools/dashboards.js', () => ({ registerDashboardsTool: vi.fn() }))
vi.mock('../../src/tools/logs.js', () => ({ registerLogsTool: vi.fn() }))
vi.mock('../../src/tools/metrics.js', () => ({ registerMetricsTool: vi.fn() }))
vi.mock('../../src/tools/traces.js', () => ({ registerTracesTool: vi.fn() }))
vi.mock('../../src/tools/events.js', () => ({ registerEventsTool: vi.fn() }))
vi.mock('../../src/tools/incidents.js', () => ({ registerIncidentsTool: vi.fn() }))
vi.mock('../../src/tools/slos.js', () => ({ registerSlosTool: vi.fn() }))
vi.mock('../../src/tools/synthetics.js', () => ({ registerSyntheticsTool: vi.fn() }))
vi.mock('../../src/tools/hosts.js', () => ({ registerHostsTool: vi.fn() }))
vi.mock('../../src/tools/downtimes.js', () => ({ registerDowntimesTool: vi.fn() }))
vi.mock('../../src/tools/rum.js', () => ({ registerRumTool: vi.fn() }))
vi.mock('../../src/tools/security.js', () => ({ registerSecurityTool: vi.fn() }))
vi.mock('../../src/tools/notebooks.js', () => ({ registerNotebooksTool: vi.fn() }))
vi.mock('../../src/tools/users.js', () => ({ registerUsersTool: vi.fn() }))
vi.mock('../../src/tools/teams.js', () => ({ registerTeamsTool: vi.fn() }))
vi.mock('../../src/tools/tags.js', () => ({ registerTagsTool: vi.fn() }))
vi.mock('../../src/tools/usage.js', () => ({ registerUsageTool: vi.fn() }))
vi.mock('../../src/tools/auth.js', () => ({ registerAuthTool: vi.fn() }))

import { registerMonitorsTool } from '../../src/tools/monitors.js'
import { registerDashboardsTool } from '../../src/tools/dashboards.js'
import { registerLogsTool } from '../../src/tools/logs.js'
import { registerMetricsTool } from '../../src/tools/metrics.js'
import { registerTracesTool } from '../../src/tools/traces.js'
import { registerEventsTool } from '../../src/tools/events.js'
import { registerIncidentsTool } from '../../src/tools/incidents.js'
import { registerSlosTool } from '../../src/tools/slos.js'
import { registerSyntheticsTool } from '../../src/tools/synthetics.js'
import { registerHostsTool } from '../../src/tools/hosts.js'
import { registerDowntimesTool } from '../../src/tools/downtimes.js'
import { registerRumTool } from '../../src/tools/rum.js'
import { registerSecurityTool } from '../../src/tools/security.js'
import { registerNotebooksTool } from '../../src/tools/notebooks.js'
import { registerUsersTool } from '../../src/tools/users.js'
import { registerTeamsTool } from '../../src/tools/teams.js'
import { registerTagsTool } from '../../src/tools/tags.js'
import { registerUsageTool } from '../../src/tools/usage.js'
import { registerAuthTool } from '../../src/tools/auth.js'

import type { DatadogConfig } from '../../src/config/schema.js'

describe('Tool Registration', () => {
  let mockServer: McpServer
  let mockClients: DatadogClients
  let mockLimits: LimitsConfig
  let mockFeatures: FeaturesConfig
  let mockDatadogConfig: DatadogConfig

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()

    // Create mock objects
    mockServer = {} as McpServer
    mockClients = {
      monitors: {} as unknown,
      dashboards: {} as unknown,
      logs: {} as unknown,
      metricsV1: {} as unknown,
      metricsV2: {} as unknown,
      spans: {} as unknown,
      services: {} as unknown,
      eventsV1: {} as unknown,
      eventsV2: {} as unknown,
      incidents: {} as unknown,
      slo: {} as unknown,
      synthetics: {} as unknown,
      hosts: {} as unknown,
      downtimes: {} as unknown,
      rum: {} as unknown,
      security: {} as unknown,
      notebooks: {} as unknown,
      users: {} as unknown,
      teams: {} as unknown,
      tags: {} as unknown,
      usage: {} as unknown
    }
    mockLimits = {
      maxResults: 100,
      maxLogLines: 500,
      defaultLimit: 25,
      maxMetricDataPoints: 1000,
      defaultTimeRangeHours: 24
    }
    mockFeatures = {
      readOnly: false,
      disabledTools: []
    }
    mockDatadogConfig = {
      apiKey: 'test-api-key',
      appKey: 'test-app-key',
      site: 'datadoghq.com'
    }
  })

  it('should register all tools when none are disabled', () => {
    registerAllTools(
      mockServer,
      mockClients,
      mockLimits,
      mockFeatures,
      'datadoghq.com',
      mockDatadogConfig
    )

    expect(registerMonitorsTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.monitors,
      mockClients.eventsV2,
      mockLimits,
      false,
      'datadoghq.com'
    )
    expect(registerDashboardsTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.dashboards,
      mockLimits,
      false,
      { apiKey: 'test-api-key', appKey: 'test-app-key', site: 'datadoghq.com' }
    )
    expect(registerLogsTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.logs,
      mockLimits,
      'datadoghq.com'
    )
    expect(registerMetricsTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.metricsV1,
      mockClients.metricsV2,
      mockLimits,
      'datadoghq.com'
    )
    expect(registerTracesTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.spans,
      mockClients.services,
      mockLimits,
      'datadoghq.com'
    )
    expect(registerEventsTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.eventsV1,
      mockClients.eventsV2,
      mockClients.monitors,
      mockLimits,
      false,
      'datadoghq.com'
    )
    expect(registerIncidentsTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.incidents,
      mockLimits,
      false,
      'datadoghq.com'
    )
    expect(registerSlosTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.slo,
      mockLimits,
      false,
      'datadoghq.com'
    )
    expect(registerSyntheticsTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.synthetics,
      mockLimits,
      false,
      'datadoghq.com'
    )
    expect(registerHostsTool).toHaveBeenCalledWith(mockServer, mockClients.hosts, mockLimits, false)
    expect(registerDowntimesTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.downtimes,
      mockLimits,
      false
    )
    expect(registerRumTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.rum,
      mockLimits,
      'datadoghq.com'
    )
    expect(registerSecurityTool).toHaveBeenCalledWith(mockServer, mockClients.security, mockLimits)
    expect(registerNotebooksTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.notebooks,
      mockLimits,
      false,
      'datadoghq.com'
    )
    expect(registerUsersTool).toHaveBeenCalledWith(mockServer, mockClients.users, mockLimits)
    expect(registerTeamsTool).toHaveBeenCalledWith(mockServer, mockClients.teams, mockLimits)
    expect(registerTagsTool).toHaveBeenCalledWith(mockServer, mockClients.tags, mockLimits, false)
    expect(registerUsageTool).toHaveBeenCalledWith(mockServer, mockClients.usage, mockLimits)
    expect(registerAuthTool).toHaveBeenCalledWith(mockServer, mockClients)
  })

  it('should not register disabled tools', () => {
    mockFeatures.disabledTools = ['monitors', 'logs', 'incidents']

    registerAllTools(
      mockServer,
      mockClients,
      mockLimits,
      mockFeatures,
      'datadoghq.com',
      mockDatadogConfig
    )

    expect(registerMonitorsTool).not.toHaveBeenCalled()
    expect(registerLogsTool).not.toHaveBeenCalled()
    expect(registerIncidentsTool).not.toHaveBeenCalled()

    // Others should still be registered
    expect(registerDashboardsTool).toHaveBeenCalled()
    expect(registerMetricsTool).toHaveBeenCalled()
    expect(registerEventsTool).toHaveBeenCalled()
  })

  it('should pass readOnly flag correctly', () => {
    mockFeatures.readOnly = true

    registerAllTools(
      mockServer,
      mockClients,
      mockLimits,
      mockFeatures,
      'datadoghq.com',
      mockDatadogConfig
    )

    expect(registerMonitorsTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.monitors,
      mockClients.eventsV2,
      mockLimits,
      true,
      'datadoghq.com'
    )
    expect(registerIncidentsTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.incidents,
      mockLimits,
      true,
      'datadoghq.com'
    )
    expect(registerSlosTool).toHaveBeenCalledWith(
      mockServer,
      mockClients.slo,
      mockLimits,
      true,
      'datadoghq.com'
    )
  })

  it('should pass site parameter to all tools that need it', () => {
    const euConfig = { ...mockDatadogConfig, site: 'datadoghq.eu' }
    registerAllTools(mockServer, mockClients, mockLimits, mockFeatures, 'datadoghq.eu', euConfig)

    expect(registerMonitorsTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'datadoghq.eu'
    )
    expect(registerLogsTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'datadoghq.eu'
    )
    expect(registerEventsTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'datadoghq.eu'
    )
  })

  it('should use default site when not provided', () => {
    registerAllTools(
      mockServer,
      mockClients,
      mockLimits,
      mockFeatures,
      undefined,
      mockDatadogConfig
    )

    expect(registerMonitorsTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'datadoghq.com'
    )
  })

  it('should handle empty disabledTools array', () => {
    mockFeatures.disabledTools = []

    registerAllTools(
      mockServer,
      mockClients,
      mockLimits,
      mockFeatures,
      'datadoghq.com',
      mockDatadogConfig
    )

    // All tools should be registered
    expect(registerMonitorsTool).toHaveBeenCalled()
    expect(registerDashboardsTool).toHaveBeenCalled()
    expect(registerLogsTool).toHaveBeenCalled()
    expect(registerAuthTool).toHaveBeenCalled()
  })

  it('should handle disabling all tools', () => {
    mockFeatures.disabledTools = [
      'monitors',
      'dashboards',
      'logs',
      'metrics',
      'traces',
      'events',
      'incidents',
      'slos',
      'synthetics',
      'hosts',
      'downtimes',
      'rum',
      'security',
      'notebooks',
      'users',
      'teams',
      'tags',
      'usage',
      'auth'
    ]

    registerAllTools(
      mockServer,
      mockClients,
      mockLimits,
      mockFeatures,
      'datadoghq.com',
      mockDatadogConfig
    )

    // None should be registered
    expect(registerMonitorsTool).not.toHaveBeenCalled()
    expect(registerDashboardsTool).not.toHaveBeenCalled()
    expect(registerLogsTool).not.toHaveBeenCalled()
    expect(registerMetricsTool).not.toHaveBeenCalled()
    expect(registerTracesTool).not.toHaveBeenCalled()
    expect(registerEventsTool).not.toHaveBeenCalled()
    expect(registerIncidentsTool).not.toHaveBeenCalled()
    expect(registerSlosTool).not.toHaveBeenCalled()
    expect(registerSyntheticsTool).not.toHaveBeenCalled()
    expect(registerHostsTool).not.toHaveBeenCalled()
    expect(registerDowntimesTool).not.toHaveBeenCalled()
    expect(registerRumTool).not.toHaveBeenCalled()
    expect(registerSecurityTool).not.toHaveBeenCalled()
    expect(registerNotebooksTool).not.toHaveBeenCalled()
    expect(registerUsersTool).not.toHaveBeenCalled()
    expect(registerTeamsTool).not.toHaveBeenCalled()
    expect(registerTagsTool).not.toHaveBeenCalled()
    expect(registerUsageTool).not.toHaveBeenCalled()
    expect(registerAuthTool).not.toHaveBeenCalled()
  })
})
