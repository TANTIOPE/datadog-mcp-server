/**
 * Unit tests for the synthetics tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { synthetics as fixtures } from '../helpers/fixtures.js'
import {
  listTests,
  getTest,
  createTest,
  updateTest,
  deleteTests,
  triggerTests,
  getTestResults
} from '../../src/tools/synthetics.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

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

      const result = await listTests(api, {}, defaultLimits)

      expect(result.tests).toHaveLength(2)
      expect(result.tests[0].publicId).toBe('abc-123-xyz')
      expect(result.tests[0].name).toBe('API Health Check')
    })

    it('should filter by tags', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listTests(api, { tags: ['env:production'] }, defaultLimits)

      expect(result.tests).toHaveLength(2)
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listTests(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listTests(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listSyntheticsTests, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(listTests(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getTest', () => {
    it('should get a test by public ID', async () => {
      server.use(
        http.get(endpoints.getApiTest('abc-123-xyz'), () => {
          return jsonResponse(fixtures.apiTest)
        })
      )

      const result = await getTest(api, 'abc-123-xyz')

      expect(result.test.publicId).toBe('abc-123-xyz')
      expect(result.test.name).toBe('API Health Check')
      expect(result.test.type).toBe('api')
    })

    it('should handle 404 not found error', async () => {
      // getTest tries API first then browser, need to mock both
      server.use(
        http.get(endpoints.getApiTest('nonexistent'), () => {
          return errorResponse(404, 'Test not found')
        }),
        http.get(endpoints.getBrowserTest('nonexistent'), () => {
          return errorResponse(404, 'Test not found')
        })
      )

      await expect(getTest(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createTest', () => {
    it('should create a new test', async () => {
      server.use(
        http.post(endpoints.createApiTest, () => {
          return jsonResponse(fixtures.created)
        })
      )

      const result = await createTest(api, {
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
      })

      expect(result.success).toBe(true)
      expect(result.test.publicId).toBe('new-test-123')
    })

    it('should validate config requires locations', async () => {
      // The createTest function validates config BEFORE calling API
      // So this tests the validation, not the API error
      await expect(
        createTest(api, {
          name: 'Invalid Test',
          type: 'api'
        })
      ).rejects.toThrow(/locations/)
    })
  })

  describe('updateTest', () => {
    it('should update an existing test', async () => {
      server.use(
        // updateTest first GETs the test to determine type
        http.get(endpoints.getApiTest('abc-123-xyz'), () => {
          return jsonResponse(fixtures.apiTest)
        }),
        http.put(endpoints.updateApiTest('abc-123-xyz'), () => {
          return jsonResponse({
            ...fixtures.apiTest,
            name: 'Updated API Test'
          })
        })
      )

      const result = await updateTest(api, 'abc-123-xyz', {
        name: 'Updated API Test',
        type: 'api',
        subtype: 'http',
        message: 'Updated test',
        config: fixtures.apiTest.config,
        locations: fixtures.apiTest.locations,
        options: { tickEvery: 300 }
      })

      expect(result.success).toBe(true)
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

      const result = await deleteTests(api, ['abc-123-xyz'])

      expect(result.success).toBe(true)
      expect(result.message).toContain('1')
    })
  })

  describe('triggerTests', () => {
    it('should trigger synthetic tests', async () => {
      server.use(
        http.post(endpoints.triggerSyntheticsTests, () => {
          return jsonResponse(fixtures.triggerResults)
        })
      )

      const result = await triggerTests(api, ['abc-123-xyz', 'def-456-uvw'])

      // triggerTests returns { triggered, total } not { results }
      expect(result.triggered).toHaveLength(2)
      expect(result.triggered[0].publicId).toBe('abc-123-xyz')
    })
  })

  describe('getTestResults', () => {
    it('should get latest results for a test', async () => {
      server.use(
        http.get(endpoints.getApiTestResults('abc-123-xyz'), () => {
          return jsonResponse(fixtures.apiResults)
        })
      )

      const result = await getTestResults(api, 'abc-123-xyz')

      expect(result.results).toHaveLength(2)
    })

    it('should handle 404 not found error', async () => {
      // getTestResults tries API first then browser, need to mock both
      server.use(
        http.get(endpoints.getApiTestResults('nonexistent'), () => {
          return errorResponse(404, 'Test not found')
        }),
        http.get(endpoints.getBrowserTestResults('nonexistent'), () => {
          return errorResponse(404, 'Test not found')
        })
      )

      await expect(getTestResults(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
