/**
 * Unit tests for the hosts tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { hosts as fixtures } from '../helpers/fixtures.js'

describe('Hosts Tool', () => {
  let api: v1.HostsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.HostsApi(config)
  })

  describe('listHosts', () => {
    it('should list hosts successfully', async () => {
      server.use(
        http.get(endpoints.listHosts, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listHosts({})

      expect(response.hostList).toHaveLength(2)
      expect(response.hostList?.[0].hostName).toBe('prod-server-1')
      expect(response.hostList?.[0].isMuted).toBe(false)
      expect(response.totalMatching).toBe(2)
    })

    it('should filter hosts by name', async () => {
      server.use(
        http.get(endpoints.listHosts, ({ request }) => {
          const url = new URL(request.url)
          const filter = url.searchParams.get('filter')

          if (filter === 'prod-server-1') {
            return jsonResponse({
              ...fixtures.list,
              host_list: [fixtures.list.host_list[0]],
              total_matching: 1,
              total_returned: 1
            })
          }
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listHosts({ filter: 'prod-server-1' })

      expect(response.hostList).toHaveLength(1)
      expect(response.hostList?.[0].hostName).toBe('prod-server-1')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listHosts, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listHosts({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listHosts, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listHosts({})).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listHosts, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(api.listHosts({})).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getHostTotals', () => {
    it('should get host totals successfully', async () => {
      server.use(
        http.get(endpoints.getHostTotals, () => {
          return jsonResponse(fixtures.totals)
        })
      )

      const response = await api.getHostTotals({})

      expect(response.totalActive).toBe(50)
      expect(response.totalUp).toBe(48)
    })
  })

  describe('muteHost', () => {
    it('should mute a host successfully', async () => {
      server.use(
        http.post(endpoints.muteHost('prod-server-1'), () => {
          return jsonResponse(fixtures.mute)
        })
      )

      const response = await api.muteHost({
        hostName: 'prod-server-1',
        body: {
          message: 'Maintenance window',
          end: 1705837800
        }
      })

      expect(response.hostname).toBe('prod-server-1')
      expect(response.action).toBe('Muted')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.post(endpoints.muteHost('nonexistent-host'), () => {
          return errorResponse(404, 'Host not found')
        })
      )

      await expect(
        api.muteHost({
          hostName: 'nonexistent-host',
          body: {}
        })
      ).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('unmuteHost', () => {
    it('should unmute a host successfully', async () => {
      server.use(
        http.post(endpoints.unmuteHost('prod-server-1'), () => {
          return jsonResponse({
            hostname: 'prod-server-1',
            action: 'Unmuted'
          })
        })
      )

      const response = await api.unmuteHost({
        hostName: 'prod-server-1'
      })

      expect(response.hostname).toBe('prod-server-1')
      expect(response.action).toBe('Unmuted')
    })
  })
})
