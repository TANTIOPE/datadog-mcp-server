/**
 * Unit tests for the incidents tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { incidents as fixtures } from '../helpers/fixtures.js'

describe('Incidents Tool', () => {
  let api: v2.IncidentsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.IncidentsApi(config)
  })

  describe('listIncidents', () => {
    it('should list incidents successfully', async () => {
      server.use(
        http.get(endpoints.listIncidents, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listIncidents({})

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0].id).toBe('inc-001')
      expect(response.data?.[0].attributes?.title).toBe('Database connection failures')
      expect(response.data?.[0].attributes?.state).toBe('active')
    })

    it('should handle pagination', async () => {
      server.use(
        http.get(endpoints.listIncidents, ({ request }) => {
          const url = new URL(request.url)
          const pageSize = url.searchParams.get('page[size]')

          expect(pageSize).toBeTruthy()
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listIncidents({ pageSize: 10 })

      expect(response.data).toHaveLength(2)
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listIncidents, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listIncidents({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listIncidents, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listIncidents({})).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listIncidents, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(api.listIncidents({})).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getIncident', () => {
    it('should get a single incident by ID', async () => {
      server.use(
        http.get(endpoints.getIncident('inc-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const response = await api.getIncident({ incidentId: 'inc-001' })

      expect(response.data?.id).toBe('inc-001')
      expect(response.data?.attributes?.title).toBe('Database connection failures')
      expect(response.data?.attributes?.severity).toBe('SEV-2')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getIncident('nonexistent'), () => {
          return errorResponse(404, 'Incident not found')
        })
      )

      await expect(api.getIncident({ incidentId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('searchIncidents', () => {
    it('should search incidents by query', async () => {
      server.use(
        http.get(endpoints.searchIncidents, ({ request }) => {
          const url = new URL(request.url)
          const query = url.searchParams.get('query')

          expect(query).toBe('database')
          return jsonResponse(fixtures.search)
        })
      )

      const response = await api.searchIncidents({ query: 'database' })

      expect(response.data?.attributes?.incidents).toHaveLength(2)
    })

    it('should handle empty search results', async () => {
      server.use(
        http.get(endpoints.searchIncidents, () => {
          return jsonResponse({
            data: {
              attributes: {
                facets: {
                  fields: [],
                  state: []
                },
                incidents: [],
                total: 0
              },
              type: 'incidents_search'
            },
            meta: { pagination: { size: 0 } }
          })
        })
      )

      const response = await api.searchIncidents({ query: 'nonexistent' })

      expect(response.data?.attributes?.incidents).toHaveLength(0)
    })
  })

  describe('createIncident', () => {
    it('should create a new incident', async () => {
      server.use(
        http.post(endpoints.createIncident, () => {
          return jsonResponse(fixtures.created)
        })
      )

      const response = await api.createIncident({
        body: {
          data: {
            type: 'incidents',
            attributes: {
              title: 'New Incident',
              customerImpacted: false
            }
          }
        }
      })

      expect(response.data?.id).toBe('inc-003')
      expect(response.data?.attributes?.title).toBe('New Incident')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createIncident, () => {
          return errorResponse(400, 'Title is required')
        })
      )

      await expect(api.createIncident({
        body: {
          data: {
            type: 'incidents',
            attributes: {
              title: '',
              customerImpacted: false
            }
          }
        }
      })).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateIncident', () => {
    it('should update an existing incident', async () => {
      server.use(
        http.patch(endpoints.updateIncident('inc-001'), async ({ request }) => {
          const _body = await request.json() as Record<string, unknown>
          return jsonResponse({
            data: {
              ...fixtures.single.data,
              attributes: {
                ...fixtures.single.data.attributes,
                state: 'resolved'
              }
            }
          })
        })
      )

      const response = await api.updateIncident({
        incidentId: 'inc-001',
        body: {
          data: {
            type: 'incidents',
            id: 'inc-001',
            attributes: {
              state: 'resolved'
            }
          }
        }
      })

      expect(response.data?.attributes?.state).toBe('resolved')
    })
  })

  describe('deleteIncident', () => {
    it('should delete an incident', async () => {
      server.use(
        http.delete(endpoints.deleteIncident('inc-001'), () => {
          return new Response(null, { status: 204 })
        })
      )

      // deleteIncident returns void on success
      await expect(api.deleteIncident({ incidentId: 'inc-001' })).resolves.not.toThrow()
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.deleteIncident('nonexistent'), () => {
          return errorResponse(404, 'Incident not found')
        })
      )

      await expect(api.deleteIncident({ incidentId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
