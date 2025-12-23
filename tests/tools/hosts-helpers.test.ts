import { describe, it, expect, vi } from 'vitest'
import { formatHost, listHosts, getHostTotals, muteHost } from '../../src/tools/hosts.js'
import { v1 } from '@datadog/datadog-api-client'

describe('formatHost', () => {
  it('should format complete host data', () => {
    const host: v1.Host = {
      hostName: 'web-server-01',
      aliases: ['web01', 'prod-web'],
      apps: ['nginx', 'docker'],
      sources: ['aws', 'datadog-agent'],
      up: true,
      isMuted: false,
      muteTimeout: null,
      lastReportedTime: 1705315200, // 2024-01-15T10:40:00Z
      meta: {
        cpuCores: 8,
        platform: 'linux',
        gohai: 'gohai-data'
      }
    }

    const result = formatHost(host)

    expect(result).toEqual({
      hostName: 'web-server-01',
      aliases: ['web01', 'prod-web'],
      apps: ['nginx', 'docker'],
      sources: ['aws', 'datadog-agent'],
      up: true,
      isMuted: false,
      muteTimeout: null,
      lastReportedTime: '2024-01-15T10:40:00.000Z',
      meta: {
        cpuCores: 8,
        platform: 'linux',
        gohai: 'gohai-data'
      }
    })
  })

  it('should handle missing optional fields', () => {
    const host: v1.Host = {
      hostName: 'minimal-host'
    }

    const result = formatHost(host)

    expect(result).toEqual({
      hostName: 'minimal-host',
      aliases: [],
      apps: [],
      sources: [],
      up: false,
      isMuted: false,
      muteTimeout: null,
      lastReportedTime: '',
      meta: {
        cpuCores: null,
        platform: null,
        gohai: null
      }
    })
  })

  it('should handle muted host', () => {
    const host: v1.Host = {
      hostName: 'muted-host',
      isMuted: true,
      muteTimeout: 1705406400
    }

    const result = formatHost(host)

    expect(result.isMuted).toBe(true)
    expect(result.muteTimeout).toBe(1705406400)
  })

  it('should handle missing meta object', () => {
    const host: v1.Host = {
      hostName: 'no-meta-host',
      meta: undefined
    }

    const result = formatHost(host)

    expect(result.meta).toEqual({
      cpuCores: null,
      platform: null,
      gohai: null
    })
  })

  it('should handle partial meta object', () => {
    const host: v1.Host = {
      hostName: 'partial-meta-host',
      meta: {
        cpuCores: 4,
        platform: undefined,
        gohai: undefined
      }
    }

    const result = formatHost(host)

    expect(result.meta).toEqual({
      cpuCores: 4,
      platform: null,
      gohai: null
    })
  })

  it('should convert lastReportedTime from POSIX', () => {
    const host: v1.Host = {
      hostName: 'time-test-host',
      lastReportedTime: 1609459200 // 2021-01-01T00:00:00Z
    }

    const result = formatHost(host)

    expect(result.lastReportedTime).toBe('2021-01-01T00:00:00.000Z')
  })

  it('should handle missing lastReportedTime', () => {
    const host: v1.Host = {
      hostName: 'no-time-host',
      lastReportedTime: undefined
    }

    const result = formatHost(host)

    expect(result.lastReportedTime).toBe('')
  })

  it('should handle empty arrays', () => {
    const host: v1.Host = {
      hostName: 'empty-arrays-host',
      aliases: [],
      apps: [],
      sources: []
    }

    const result = formatHost(host)

    expect(result.aliases).toEqual([])
    expect(result.apps).toEqual([])
    expect(result.sources).toEqual([])
  })
})

describe('listHosts', () => {
  const mockApi = {
    listHosts: vi.fn()
  } as unknown as v1.HostsApi

  const limits = { maxResults: 100 }

  it('should list hosts with pagination', async () => {
    const mockResponse = {
      hostList: [
        {
          hostName: 'host-1',
          up: true
        },
        {
          hostName: 'host-2',
          up: true
        }
      ],
      totalReturned: 2,
      totalMatching: 50
    }

    mockApi.listHosts = vi.fn().mockResolvedValue(mockResponse)

    const result = await listHosts(mockApi, { from: 0, count: 2 }, limits)

    expect(result.hosts).toHaveLength(2)
    expect(result.totalReturned).toBe(2)
    expect(result.totalMatching).toBe(50)
    expect(mockApi.listHosts).toHaveBeenCalledWith({
      filter: undefined,
      from: 0,
      count: 2,
      sortField: undefined,
      sortDir: undefined
    })
  })

  it('should use AI-specified count without capping', async () => {
    const mockResponse = {
      hostList: []
    }

    mockApi.listHosts = vi.fn().mockResolvedValue(mockResponse)

    const limits = { defaultLimit: 50 }

    await listHosts(mockApi, { count: 200 }, limits)

    // AI controls limits - no server-side cap
    expect(mockApi.listHosts).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 200
      })
    )
  })

  it('should handle null hostList', async () => {
    const mockResponse = {
      hostList: null,
      totalReturned: 0,
      totalMatching: 0
    }

    mockApi.listHosts = vi.fn().mockResolvedValue(mockResponse)

    const result = await listHosts(mockApi, {}, limits)

    expect(result.hosts).toHaveLength(0)
  })

  it('should handle missing totals', async () => {
    const mockResponse = {
      hostList: [{ hostName: 'host-1' }]
    }

    mockApi.listHosts = vi.fn().mockResolvedValue(mockResponse)

    const result = await listHosts(mockApi, {}, limits)

    expect(result.totalReturned).toBe(1)
    expect(result.totalMatching).toBe(1)
  })
})

describe('getHostTotals', () => {
  const mockApi = {
    getHostTotals: vi.fn()
  } as unknown as v1.HostsApi

  it('should get host totals', async () => {
    const mockResponse = {
      totalUp: 150,
      totalActive: 200
    }

    mockApi.getHostTotals = vi.fn().mockResolvedValue(mockResponse)

    const result = await getHostTotals(mockApi)

    expect(result.totals.totalUp).toBe(150)
    expect(result.totals.totalActive).toBe(200)
    expect(mockApi.getHostTotals).toHaveBeenCalledWith({})
  })

  it('should handle missing totals', async () => {
    const mockResponse = {}

    mockApi.getHostTotals = vi.fn().mockResolvedValue(mockResponse)

    const result = await getHostTotals(mockApi)

    expect(result.totals.totalUp).toBe(0)
    expect(result.totals.totalActive).toBe(0)
  })
})

describe('muteHost', () => {
  const mockApi = {
    muteHost: vi.fn()
  } as unknown as v1.HostsApi

  it('should mute host indefinitely', async () => {
    mockApi.muteHost = vi.fn().mockResolvedValue({})

    const result = await muteHost(mockApi, 'web-01', {})

    expect(result.success).toBe(true)
    expect(result.message).toBe('Host web-01 muted indefinitely')
    expect(mockApi.muteHost).toHaveBeenCalledWith({
      hostName: 'web-01',
      body: {
        message: undefined,
        end: undefined,
        override: undefined
      }
    })
  })

  it('should mute host with end timestamp', async () => {
    mockApi.muteHost = vi.fn().mockResolvedValue({})

    const endTimestamp = 1705401600 // 2024-01-16T10:40:00Z

    const result = await muteHost(mockApi, 'web-01', { end: endTimestamp })

    expect(result.success).toBe(true)
    expect(result.message).toBe('Host web-01 muted until 2024-01-16T10:40:00.000Z')
  })

  it('should mute host with message and override', async () => {
    mockApi.muteHost = vi.fn().mockResolvedValue({})

    const result = await muteHost(mockApi, 'web-01', {
      message: 'Maintenance window',
      override: true
    })

    expect(result.success).toBe(true)
    expect(mockApi.muteHost).toHaveBeenCalledWith({
      hostName: 'web-01',
      body: {
        message: 'Maintenance window',
        end: undefined,
        override: true
      }
    })
  })
})
