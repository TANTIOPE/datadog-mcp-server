/**
 * Unit tests for the downtimes tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { downtimes as fixtures } from '../helpers/fixtures.js'

describe('Downtimes Tool', () => {
  let api: v2.DowntimesApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.DowntimesApi(config)
  })

  describe('listDowntimes', () => {
    it('should list downtimes successfully', async () => {
      server.use(
        http.get(endpoints.listDowntimes, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listDowntimes({})

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0].id).toBe('dt-001')
      expect(response.data?.[0].attributes?.status).toBe('active')
    })

    it('should filter by currentOnly', async () => {
      server.use(
        http.get(endpoints.listDowntimes, ({ request }) => {
          const url = new URL(request.url)
          const currentOnly = url.searchParams.get('current_only')

          if (currentOnly === 'true') {
            return jsonResponse({
              data: [fixtures.list.data[0]]
            })
          }
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listDowntimes({ currentOnly: true })

      expect(response.data).toHaveLength(1)
      expect(response.data?.[0].attributes?.status).toBe('active')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listDowntimes, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listDowntimes({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listDowntimes, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listDowntimes({})).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listDowntimes, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(api.listDowntimes({})).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getDowntime', () => {
    it('should get a single downtime by ID', async () => {
      server.use(
        http.get(endpoints.getDowntime('dt-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const response = await api.getDowntime({ downtimeId: 'dt-001' })

      expect(response.data?.id).toBe('dt-001')
      expect(response.data?.attributes?.scope).toBe('env:production')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getDowntime('nonexistent'), () => {
          return errorResponse(404, 'Downtime not found')
        })
      )

      await expect(api.getDowntime({ downtimeId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createDowntime', () => {
    it('should create a new downtime', async () => {
      server.use(
        http.post(endpoints.createDowntime, () => {
          return jsonResponse(fixtures.created)
        })
      )

      const response = await api.createDowntime({
        body: {
          data: {
            type: 'downtime',
            attributes: {
              scope: 'env:staging',
              monitorIdentifier: {
                monitorTags: ['env:staging']
              },
              schedule: {
                start: new Date().toISOString()
              }
            }
          }
        }
      })

      expect(response.data?.id).toBe('dt-003')
      expect(response.data?.attributes?.scope).toBe('env:staging')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createDowntime, () => {
          return errorResponse(400, 'Invalid scope format')
        })
      )

      await expect(
        api.createDowntime({
          body: {
            data: {
              type: 'downtime',
              attributes: {
                scope: 'invalid',
                monitorIdentifier: {
                  monitorTags: ['invalid']
                }
              }
            }
          }
        })
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateDowntime', () => {
    it('should update an existing downtime', async () => {
      server.use(
        http.patch(endpoints.updateDowntime('dt-001'), async ({ request }) => {
          const _body = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            data: {
              ...fixtures.single.data,
              attributes: {
                ...fixtures.single.data.attributes,
                message: 'Updated message'
              }
            }
          })
        })
      )

      const response = await api.updateDowntime({
        downtimeId: 'dt-001',
        body: {
          data: {
            type: 'downtime',
            id: 'dt-001',
            attributes: {
              message: 'Updated message'
            }
          }
        }
      })

      expect(response.data?.attributes?.message).toBe('Updated message')
    })
  })

  describe('cancelDowntime', () => {
    it('should cancel a downtime', async () => {
      server.use(
        http.delete(endpoints.cancelDowntime('dt-001'), () => {
          return new Response(null, { status: 204 })
        })
      )

      // cancelDowntime returns void on success
      await expect(api.cancelDowntime({ downtimeId: 'dt-001' })).resolves.not.toThrow()
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.cancelDowntime('nonexistent'), () => {
          return errorResponse(404, 'Downtime not found')
        })
      )

      await expect(api.cancelDowntime({ downtimeId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('listMonitorDowntimes', () => {
    it('should list downtimes for a specific monitor', async () => {
      server.use(
        http.get(endpoints.listMonitorDowntimes(12345), () => {
          return jsonResponse({
            data: [fixtures.list.data[0]]
          })
        })
      )

      const response = await api.listMonitorDowntimes({ monitorId: 12345 })

      expect(response.data).toHaveLength(1)
      expect(response.data?.[0].id).toBe('dt-001')
    })
  })
})
