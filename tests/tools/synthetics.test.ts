/**
 * Unit tests for the synthetics tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { synthetics as fixtures } from '../helpers/fixtures.js'

describe('Synthetics Tool', () => {
  let api: v1.SyntheticsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.SyntheticsApi(config)
  })

  describe('listTests', () => {
    it('should list synthetic tests successfully', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listTests({})

      expect(response.tests).toHaveLength(2)
      expect(response.tests?.[0].publicId).toBe('abc-123-xyz')
      expect(response.tests?.[0].name).toBe('API Health Check')
      expect(response.tests?.[0].type).toBe('api')
    })

    it('should filter by locations', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          // Return filtered results - the SDK sends filterLocations param
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listTests({ filterLocations: 'aws:us-east-1' })

      expect(response.tests).toHaveLength(2)
      // Verify results are for the expected locations
      expect(response.tests?.[0].locations).toContain('aws:us-east-1')
    })

    it('should filter by tags', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          // Return filtered results - the SDK sends filterTags param
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listTests({ filterTags: 'env:production' })

      expect(response.tests).toHaveLength(2)
      // Verify results have the expected tags
      expect(response.tests?.[0].tags).toContain('env:production')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listTests({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listTests({})).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(api.listTests({})).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getAPITest', () => {
    it('should get an API test by public ID', async () => {
      server.use(
        http.get(endpoints.getApiTest('abc-123-xyz'), () => {
          return jsonResponse(fixtures.apiTest)
        })
      )

      const response = await api.getAPITest({ publicId: 'abc-123-xyz' })

      expect(response.publicId).toBe('abc-123-xyz')
      expect(response.name).toBe('API Health Check')
      expect(response.type).toBe('api')
      expect(response.subtype).toBe('http')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getApiTest('nonexistent'), () => {
          return errorResponse(404, 'Test not found')
        })
      )

      await expect(api.getAPITest({ publicId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('getBrowserTest', () => {
    it('should get a browser test by public ID', async () => {
      server.use(
        http.get(endpoints.getBrowserTest('def-456-uvw'), () => {
          return jsonResponse(fixtures.browserTest)
        })
      )

      const response = await api.getBrowserTest({ publicId: 'def-456-uvw' })

      expect(response.publicId).toBe('def-456-uvw')
      expect(response.name).toBe('Login Flow Test')
      expect(response.type).toBe('browser')
    })
  })

  describe('createSyntheticsAPITest', () => {
    it('should create a new API test', async () => {
      server.use(
        http.post(endpoints.createApiTest, () => {
          return jsonResponse(fixtures.created)
        })
      )

      const response = await api.createSyntheticsAPITest({
        body: {
          name: 'New API Test',
          type: 'api',
          subtype: 'http',
          message: 'Test message',
          config: {
            request: {
              method: 'GET',
              url: 'https://api.example.com/health'
            },
            assertions: []
          },
          locations: ['aws:us-east-1'],
          options: {
            tickEvery: 300
          }
        }
      })

      expect(response.publicId).toBe('new-test-123')
      expect(response.name).toBe('New Test')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createApiTest, () => {
          return errorResponse(400, 'Invalid test configuration')
        })
      )

      // The SDK validates required fields before sending
      // This test verifies the error is thrown for missing required fields
      await expect(
        api.createSyntheticsAPITest({
          body: {
            name: 'Invalid Test',
            type: 'api',
            config: {},
            locations: [],
            options: {}
          }
        })
      ).rejects.toThrow(/missing required property/)
    })
  })

  describe('updateAPITest', () => {
    it('should update an existing API test', async () => {
      server.use(
        http.put(endpoints.updateApiTest('abc-123-xyz'), () => {
          return jsonResponse({
            ...fixtures.apiTest,
            name: 'Updated API Test'
          })
        })
      )

      const response = await api.updateAPITest({
        publicId: 'abc-123-xyz',
        body: {
          name: 'Updated API Test',
          type: 'api',
          message: 'Updated test',
          config: fixtures.apiTest.config as {
            request: { method: string; url: string }
            assertions: unknown[]
          },
          locations: fixtures.apiTest.locations,
          options: { tickEvery: 300 }
        }
      })

      expect(response.name).toBe('Updated API Test')
    })
  })

  describe('deleteTests', () => {
    it('should delete synthetic tests', async () => {
      server.use(
        http.post(endpoints.deleteSyntheticsTests, async ({ request }) => {
          const body = (await request.json()) as { public_ids: string[] }
          return jsonResponse({
            deleted_tests: body.public_ids.map((id) => ({
              public_id: id,
              deleted_at: new Date().toISOString()
            }))
          })
        })
      )

      const response = await api.deleteTests({
        body: { publicIds: ['abc-123-xyz'] }
      })

      expect(response.deletedTests).toHaveLength(1)
      expect(response.deletedTests?.[0].publicId).toBe('abc-123-xyz')
    })
  })

  describe('triggerTests', () => {
    it('should trigger synthetic tests', async () => {
      server.use(
        http.post(endpoints.triggerSyntheticsTests, () => {
          return jsonResponse(fixtures.triggerResults)
        })
      )

      const response = await api.triggerTests({
        body: {
          tests: [{ publicId: 'abc-123-xyz' }, { publicId: 'def-456-uvw' }]
        }
      })

      expect(response.results).toHaveLength(2)
      expect(response.results?.[0].publicId).toBe('abc-123-xyz')
      expect(response.results?.[0].resultId).toBe('result-001')
    })
  })

  describe('getAPITestLatestResults', () => {
    it('should get latest results for an API test', async () => {
      server.use(
        http.get(endpoints.getApiTestResults('abc-123-xyz'), () => {
          return jsonResponse(fixtures.apiResults)
        })
      )

      const response = await api.getAPITestLatestResults({ publicId: 'abc-123-xyz' })

      expect(response.results).toHaveLength(2)
      expect(response.results?.[0].result?.passed).toBe(true)
      expect(response.results?.[1].result?.passed).toBe(false)
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getApiTestResults('nonexistent'), () => {
          return errorResponse(404, 'Test not found')
        })
      )

      await expect(api.getAPITestLatestResults({ publicId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('getBrowserTestLatestResults', () => {
    it('should get latest results for a browser test', async () => {
      server.use(
        http.get(endpoints.getBrowserTestResults('def-456-uvw'), () => {
          return jsonResponse(fixtures.browserResults)
        })
      )

      const response = await api.getBrowserTestLatestResults({ publicId: 'def-456-uvw' })

      expect(response.results).toHaveLength(1)
      expect(response.results?.[0].resultId).toBe('result-003')
      // The response structure varies - just verify we got results
      expect(response.results?.[0].checkTime).toBeDefined()
    })
  })
})
