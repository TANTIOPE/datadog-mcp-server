/**
 * Unit tests for the incidents tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { incidents as fixtures } from '../helpers/fixtures.js'
import {
  listIncidents,
  getIncident,
  searchIncidents,
  createIncident,
  updateIncident,
  deleteIncident
} from '../../src/tools/incidents.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

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

      const result = await listIncidents(api, {}, defaultLimits)

      expect(result.incidents).toHaveLength(2)
      expect(result.incidents[0].id).toBe('inc-001')
      expect(result.incidents[0].title).toBe('Database connection failures')
      expect(result.incidents[0].state).toBe('active')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listIncidents, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listIncidents(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listIncidents, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listIncidents(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listIncidents, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(listIncidents(api, {}, defaultLimits)).rejects.toMatchObject({
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

      const result = await getIncident(api, 'inc-001')

      expect(result.incident.id).toBe('inc-001')
      expect(result.incident.title).toBe('Database connection failures')
      expect(result.incident.severity).toBe('SEV-2')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getIncident('nonexistent'), () => {
          return errorResponse(404, 'Incident not found')
        })
      )

      await expect(getIncident(api, 'nonexistent')).rejects.toMatchObject({
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

      const result = await searchIncidents(api, 'database', defaultLimits)

      expect(result.incidents).toHaveLength(2)
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

      const result = await searchIncidents(api, 'nonexistent', defaultLimits)

      expect(result.incidents).toHaveLength(0)
    })
  })

  describe('createIncident', () => {
    it('should create a new incident', async () => {
      server.use(
        http.post(endpoints.createIncident, () => {
          return jsonResponse(fixtures.created)
        })
      )

      const result = await createIncident(api, {
        title: 'New Incident',
        customerImpacted: false
      })

      expect(result.success).toBe(true)
      expect(result.incident.id).toBe('inc-003')
      expect(result.incident.title).toBe('New Incident')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createIncident, () => {
          return errorResponse(400, 'Title is required')
        })
      )

      await expect(
        createIncident(api, {
          title: '',
          customerImpacted: false
        })
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateIncident', () => {
    it('should update an existing incident', async () => {
      server.use(
        http.patch(endpoints.updateIncident('inc-001'), async () => {
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

      const result = await updateIncident(api, 'inc-001', {
        state: 'resolved'
      })

      expect(result.success).toBe(true)
      expect(result.incident.state).toBe('resolved')
    })
  })

  describe('deleteIncident', () => {
    it('should delete an incident', async () => {
      server.use(
        http.delete(endpoints.deleteIncident('inc-001'), () => {
          return new Response(null, { status: 204 })
        })
      )

      const result = await deleteIncident(api, 'inc-001')

      expect(result.success).toBe(true)
      expect(result.message).toContain('inc-001')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.deleteIncident('nonexistent'), () => {
          return errorResponse(404, 'Incident not found')
        })
      )

      await expect(deleteIncident(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
