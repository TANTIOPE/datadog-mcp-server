import { describe, it, expect, vi } from 'vitest'
import { searchSignals, listFindings } from '../../src/tools/security.js'
import { v2 } from '@datadog/datadog-api-client'

describe('searchSignals', () => {
  const mockApi = {
    searchSecurityMonitoringSignals: vi.fn()
  } as unknown as v2.SecurityMonitoringApi

  const limits = { defaultLimit: 50 }

  it('should search signals with query filter', async () => {
    const mockResponse = {
      data: [
        {
          id: 'signal-1',
          type: 'signal',
          attributes: {
            timestamp: new Date('2024-01-15T12:00:00Z'),
            message: 'Security event detected',
            tags: ['env:prod'],
            custom: {}
          }
        }
      ],
      meta: {
        page: {
          after: 'cursor-123'
        }
      }
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    const result = await searchSignals(
      mockApi,
      {
        query: 'attack:sql_injection',
        pageSize: 50
      },
      limits
    )

    expect(result.signals).toHaveLength(1)
    expect(result.signals[0]?.id).toBe('signal-1')
    expect(result.meta.nextCursor).toBe('cursor-123')
    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: 'attack:sql_injection'
          }),
          page: expect.objectContaining({
            limit: 50
          })
        })
      })
    )
  })

  it('should filter signals by severity', async () => {
    const mockResponse = {
      data: [],
      meta: {}
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    await searchSignals(
      mockApi,
      {
        severity: 'critical',
        pageSize: 10
      },
      limits
    )

    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: 'severity:critical *'
          })
        })
      })
    )
  })

  it('should filter signals by status', async () => {
    const mockResponse = {
      data: [],
      meta: {}
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    await searchSignals(
      mockApi,
      {
        status: 'open',
        pageSize: 10
      },
      limits
    )

    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: 'status:open *'
          })
        })
      })
    )
  })

  it('should combine severity and status filters', async () => {
    const mockResponse = {
      data: [],
      meta: {}
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    await searchSignals(
      mockApi,
      {
        severity: 'high',
        status: 'under_review',
        pageSize: 10
      },
      limits
    )

    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: 'status:under_review severity:high *'
          })
        })
      })
    )
  })

  it('should use default time range if not provided', async () => {
    const mockResponse = {
      data: [],
      meta: {}
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    await searchSignals(mockApi, { pageSize: 10 }, limits)

    const call = mockApi.searchSecurityMonitoringSignals.mock.calls[0]?.[0]
    expect(call.body.filter.from).toBeInstanceOf(Date)
    expect(call.body.filter.to).toBeInstanceOf(Date)
  })

  it('should use AI-specified pageSize without capping', async () => {
    const mockResponse = {
      data: [],
      meta: {}
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    await searchSignals(
      mockApi,
      {
        pageSize: 1000
      },
      limits
    )

    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          page: expect.objectContaining({
            limit: 1000
          })
        })
      })
    )
  })

  it('should handle pagination cursor', async () => {
    const mockResponse = {
      data: [],
      meta: {
        page: {
          after: 'next-cursor'
        }
      }
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    const result = await searchSignals(
      mockApi,
      {
        pageCursor: 'current-cursor',
        pageSize: 10
      },
      limits
    )

    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          page: expect.objectContaining({
            cursor: 'current-cursor'
          })
        })
      })
    )
    expect(result.meta.nextCursor).toBe('next-cursor')
  })
})

describe('listFindings', () => {
  const mockApi = {
    searchSecurityMonitoringSignals: vi.fn()
  } as unknown as v2.SecurityMonitoringApi

  const limits = { defaultLimit: 50 }

  it('should list findings with default workload security query', async () => {
    const mockResponse = {
      data: [
        {
          id: 'finding-1',
          type: 'signal',
          attributes: {
            timestamp: new Date('2024-01-15T12:00:00Z'),
            message: 'Security finding detected',
            tags: ['finding:workload_security'],
            custom: {}
          }
        }
      ],
      meta: {}
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    const result = await listFindings(mockApi, { pageSize: 50 }, limits)

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.id).toBe('finding-1')
    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query:
              '@workflow.rule.type:workload_security OR @workflow.rule.type:cloud_configuration'
          }),
          page: expect.objectContaining({
            limit: 50
          })
        })
      })
    )
  })

  it('should use custom query if provided', async () => {
    const mockResponse = {
      data: [],
      meta: {}
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    await listFindings(
      mockApi,
      {
        query: 'custom:finding',
        pageSize: 10
      },
      limits
    )

    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          filter: expect.objectContaining({
            query: 'custom:finding'
          })
        })
      })
    )
  })

  it('should use AI-specified pageSize without capping', async () => {
    const mockResponse = {
      data: [],
      meta: {}
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    await listFindings(
      mockApi,
      {
        pageSize: 500
      },
      limits
    )

    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          page: expect.objectContaining({
            limit: 500
          })
        })
      })
    )
  })

  it('should handle pagination cursor', async () => {
    const mockResponse = {
      data: [],
      meta: {
        page: {
          after: 'findings-cursor'
        }
      }
    }

    mockApi.searchSecurityMonitoringSignals = vi.fn().mockResolvedValue(mockResponse)

    const result = await listFindings(
      mockApi,
      {
        pageCursor: 'prev-cursor',
        pageSize: 10
      },
      limits
    )

    expect(mockApi.searchSecurityMonitoringSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          page: expect.objectContaining({
            cursor: 'prev-cursor'
          })
        })
      })
    )
    expect(result.meta.nextCursor).toBe('findings-cursor')
  })
})
