import { describe, it, expect, vi } from 'vitest'
import { listIncidents, getIncident, formatIncident } from '../../src/tools/incidents.js'
import { v2 } from '@datadog/datadog-api-client'

describe('listIncidents', () => {
  const mockApi = {
    listIncidents: vi.fn()
  } as unknown as v2.IncidentsApi

  const limits = { defaultLimit: 50 }

  it('should list all incidents without status filter', async () => {
    const mockResponse = {
      data: [
        {
          id: 'inc-1',
          attributes: {
            title: 'Database Outage',
            state: 'active',
            severity: 'SEV-1'
          }
        },
        {
          id: 'inc-2',
          attributes: {
            title: 'API Slowdown',
            state: 'resolved',
            severity: 'SEV-3'
          }
        }
      ]
    }

    mockApi.listIncidents = vi.fn().mockResolvedValue(mockResponse)

    const result = await listIncidents(mockApi, {}, limits)

    expect(result.incidents).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(mockApi.listIncidents).toHaveBeenCalledWith({ pageSize: 50 })
  })

  it('should filter incidents by active status', async () => {
    const mockResponse = {
      data: [
        {
          id: 'inc-1',
          attributes: {
            title: 'Active Incident',
            state: 'active',
            severity: 'SEV-1'
          }
        },
        {
          id: 'inc-2',
          attributes: {
            title: 'Resolved Incident',
            state: 'resolved',
            severity: 'SEV-3'
          }
        }
      ]
    }

    mockApi.listIncidents = vi.fn().mockResolvedValue(mockResponse)

    const result = await listIncidents(mockApi, { status: 'active' }, limits)

    expect(result.incidents).toHaveLength(1)
    expect(result.incidents[0]?.id).toBe('inc-1')
    expect(result.incidents[0]?.state).toBe('active')
  })

  it('should filter incidents by resolved status', async () => {
    const mockResponse = {
      data: [
        {
          id: 'inc-1',
          attributes: {
            title: 'Active Incident',
            state: 'active'
          }
        },
        {
          id: 'inc-2',
          attributes: {
            title: 'Resolved Incident',
            state: 'resolved'
          }
        }
      ]
    }

    mockApi.listIncidents = vi.fn().mockResolvedValue(mockResponse)

    const result = await listIncidents(mockApi, { status: 'resolved' }, limits)

    expect(result.incidents).toHaveLength(1)
    expect(result.incidents[0]?.id).toBe('inc-2')
  })

  it('should filter incidents by stable status', async () => {
    const mockResponse = {
      data: [
        {
          id: 'inc-1',
          attributes: {
            title: 'Stable Incident',
            state: 'stable'
          }
        },
        {
          id: 'inc-2',
          attributes: {
            title: 'Active Incident',
            state: 'active'
          }
        }
      ]
    }

    mockApi.listIncidents = vi.fn().mockResolvedValue(mockResponse)

    const result = await listIncidents(mockApi, { status: 'stable' }, limits)

    expect(result.incidents).toHaveLength(1)
    expect(result.incidents[0]?.state).toBe('stable')
  })

  it('should use AI-specified limit without capping', async () => {
    const mockResponse = {
      data: []
    }

    mockApi.listIncidents = vi.fn().mockResolvedValue(mockResponse)

    await listIncidents(mockApi, { limit: 200 }, limits)

    expect(mockApi.listIncidents).toHaveBeenCalledWith({ pageSize: 200 })
  })

  it('should handle empty data array', async () => {
    const mockResponse = {
      data: []
    }

    mockApi.listIncidents = vi.fn().mockResolvedValue(mockResponse)

    const result = await listIncidents(mockApi, {}, limits)

    expect(result.incidents).toHaveLength(0)
    expect(result.total).toBe(0)
  })

  it('should handle null data', async () => {
    const mockResponse = {
      data: null
    }

    mockApi.listIncidents = vi.fn().mockResolvedValue(mockResponse)

    const result = await listIncidents(mockApi, {}, limits)

    expect(result.incidents).toHaveLength(0)
    expect(result.total).toBe(0)
  })

  it('should apply limit after status filtering', async () => {
    const mockResponse = {
      data: [
        { id: 'inc-1', attributes: { state: 'active' } },
        { id: 'inc-2', attributes: { state: 'active' } },
        { id: 'inc-3', attributes: { state: 'resolved' } }
      ]
    }

    mockApi.listIncidents = vi.fn().mockResolvedValue(mockResponse)

    const result = await listIncidents(mockApi, { status: 'active', limit: 1 }, limits)

    expect(result.incidents).toHaveLength(1)
    expect(result.incidents[0]?.id).toBe('inc-1')
  })
})

describe('getIncident', () => {
  const mockApi = {
    getIncident: vi.fn()
  } as unknown as v2.IncidentsApi

  it('should get incident by ID', async () => {
    const mockResponse = {
      data: {
        id: 'inc-123',
        attributes: {
          title: 'Production Outage',
          state: 'active',
          severity: 'SEV-1'
        }
      }
    }

    mockApi.getIncident = vi.fn().mockResolvedValue(mockResponse)

    const result = await getIncident(mockApi, 'inc-123')

    expect(result.incident?.id).toBe('inc-123')
    expect(result.incident?.title).toBe('Production Outage')
    expect(mockApi.getIncident).toHaveBeenCalledWith({ incidentId: 'inc-123' })
  })

  it('should handle null data', async () => {
    const mockResponse = {
      data: null
    }

    mockApi.getIncident = vi.fn().mockResolvedValue(mockResponse)

    const result = await getIncident(mockApi, 'nonexistent')

    expect(result.incident).toBe(null)
  })
})

describe('formatIncident', () => {
  it('should format complete incident data', () => {
    const incident: v2.IncidentResponseData = {
      id: 'inc-456',
      type: 'incidents',
      attributes: {
        title: 'API Failure',
        state: 'active',
        severity: 'SEV-2',
        customerImpactScope: 'All users affected',
        customerImpacted: true,
        created: new Date('2024-01-15T10:00:00Z'),
        modified: new Date('2024-01-15T11:00:00Z'),
        resolved: new Date('2024-01-15T12:00:00Z'),
        timeToDetect: 300,
        timeToRepair: 3600
      },
      relationships: {
        commanderUser: {
          data: {
            id: 'user-789',
            type: 'users'
          }
        }
      }
    }

    const result = formatIncident(incident)

    expect(result).toEqual({
      id: 'inc-456',
      title: 'API Failure',
      status: 'active',
      severity: 'SEV-2',
      state: 'active',
      customerImpactScope: 'All users affected',
      customerImpacted: true,
      commander: {
        name: null,
        email: null,
        handle: 'user-789'
      },
      createdAt: '2024-01-15T10:00:00.000Z',
      modifiedAt: '2024-01-15T11:00:00.000Z',
      resolvedAt: '2024-01-15T12:00:00.000Z',
      timeToDetect: 300,
      timeToRepair: 3600
    })
  })

  it('should handle missing attributes', () => {
    const incident: v2.IncidentResponseData = {
      id: 'inc-minimal',
      type: 'incidents'
    }

    const result = formatIncident(incident)

    expect(result).toEqual({
      id: 'inc-minimal',
      title: '',
      status: 'unknown',
      severity: null,
      state: null,
      customerImpactScope: null,
      customerImpacted: false,
      commander: {
        name: null,
        email: null,
        handle: null
      },
      createdAt: '',
      modifiedAt: '',
      resolvedAt: null,
      timeToDetect: null,
      timeToRepair: null
    })
  })

  it('should handle missing relationships', () => {
    const incident: v2.IncidentResponseData = {
      id: 'inc-no-rel',
      type: 'incidents',
      attributes: {
        title: 'Incident without commander'
      }
    }

    const result = formatIncident(incident)

    expect(result.commander).toEqual({
      name: null,
      email: null,
      handle: null
    })
  })

  it('should handle missing optional timestamps', () => {
    const incident: v2.IncidentResponseData = {
      id: 'inc-ongoing',
      type: 'incidents',
      attributes: {
        title: 'Ongoing Incident',
        state: 'active'
        // No resolved timestamp
      }
    }

    const result = formatIncident(incident)

    expect(result.resolvedAt).toBe(null)
  })

  it('should handle missing optional metrics', () => {
    const incident: v2.IncidentResponseData = {
      id: 'inc-no-metrics',
      type: 'incidents',
      attributes: {
        title: 'Incident without metrics'
        // No timeToDetect or timeToRepair
      }
    }

    const result = formatIncident(incident)

    expect(result.timeToDetect).toBe(null)
    expect(result.timeToRepair).toBe(null)
  })
})
