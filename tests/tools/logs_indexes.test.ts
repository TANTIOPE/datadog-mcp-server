/**
 * Unit tests for the logs_indexes tool.
 *
 * Covers each action's happy path, required-field validation on writes,
 * snake_case normalization on update, 401/403/404/429 error propagation,
 * read-only enforcement, schema rejection of create/delete (UI-only per Datadog),
 * and verbose payload behavior.
 *
 * Requirements covered:
 *   - Requirement 4  (list / get / verbose / error mapping)
 *   - Requirement 5  (update only — create/delete must not appear in the enum)
 *   - Requirement 6  (reorder / get_order / read-only)
 *   - Requirement 10 (testing contract)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { v1 } from '@datadog/datadog-api-client'
import { z } from 'zod'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { logsIndexesFixtures as fixtures } from '../helpers/fixtures.js'
import {
  listIndexes,
  getIndex,
  updateIndex,
  reorderIndexes,
  getIndexOrder,
  registerLogsIndexesTool
} from '../../src/tools/logs_indexes.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

describe('Logs Indexes Tool', () => {
  let api: v1.LogsIndexesApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.LogsIndexesApi(config)
  })

  describe('listIndexes', () => {
    it('should list indexes with default summary projection', async () => {
      server.use(
        http.get(endpoints.listLogsIndexes, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listIndexes(api)

      expect(result.indexes).toHaveLength(3)
      expect(result.total).toBe(3)
      const first = (result.indexes as Array<Record<string, unknown>>)[0]
      expect(first.name).toBe('main')
      expect(first.filterQuery).toBe('*')
      expect(first.numRetentionDays).toBe(15)
      expect(first.numFlexLogsRetentionDays).toBe(360)
      expect(first.dailyLimit).toBe(1000000000)
      expect(first.isRateLimited).toBe(false)
      expect(first.exclusionFiltersCount).toBe(2)
      // Default projection does NOT include the full exclusionFilters array.
      expect(first.exclusionFilters).toBeUndefined()
      // Raw payload only appears under verbose.
      expect(result.raw).toBeUndefined()
    })

    it('should include the full SDK payload when verbose=true', async () => {
      server.use(
        http.get(endpoints.listLogsIndexes, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listIndexes(api, true)

      expect(result.indexes).toHaveLength(3)
      // exclusionFilters array is retained in the summary under verbose.
      const first = (result.indexes as Array<Record<string, unknown>>)[0]
      expect(Array.isArray(first.exclusionFilters)).toBe(true)
      expect((first.exclusionFilters as unknown[]).length).toBe(2)
      // Raw payload is attached for callers that need fields outside the projection.
      expect(result.raw).toBeDefined()
    })

    it('should propagate 401 unauthorized error on list', async () => {
      server.use(
        http.get(endpoints.listLogsIndexes, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listIndexes(api)).rejects.toMatchObject({ code: 401 })
    })
  })

  describe('getIndex', () => {
    it('should get a single index by name', async () => {
      server.use(
        http.get(endpoints.getLogsIndex('main'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getIndex(api, 'main')

      const idx = result.index as Record<string, unknown>
      expect(idx.name).toBe('main')
      expect(idx.filterQuery).toBe('*')
      expect(idx.numRetentionDays).toBe(15)
      expect(idx.numFlexLogsRetentionDays).toBe(360)
      expect(idx.exclusionFiltersCount).toBe(1)
      expect(result.raw).toBeUndefined()
    })

    it('should include raw payload when verbose=true on get', async () => {
      server.use(
        http.get(endpoints.getLogsIndex('main'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getIndex(api, 'main', true)

      expect(result.raw).toBeDefined()
      const idx = result.index as Record<string, unknown>
      expect(Array.isArray(idx.exclusionFilters)).toBe(true)
    })

    it('should propagate 404 not found error on get', async () => {
      server.use(
        http.get(endpoints.getLogsIndex('missing'), () => {
          return errorResponse(404, 'Index not found')
        })
      )

      await expect(getIndex(api, 'missing')).rejects.toMatchObject({ code: 404 })
    })
  })

  describe('updateIndex', () => {
    it('should update an index and normalize snake_case keys (num_retention_days → numRetentionDays)', async () => {
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.put(endpoints.updateLogsIndex('main'), async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.updated)
        })
      )

      const result = await updateIndex(api, 'main', {
        filter: { query: '*' },
        num_retention_days: 30,
        daily_limit: 2000000000,
        exclusion_filters: [
          {
            name: 'Exclude debug logs',
            is_enabled: true,
            filter: {
              query: 'status:debug',
              sample_rate: 1.0
            }
          }
        ]
      })

      expect(result.success).toBe(true)
      const idx = result.index as Record<string, unknown>
      expect(idx.name).toBe('main')
      expect(idx.numRetentionDays).toBe(30)
      expect(idx.dailyLimit).toBe(2000000000)
      // Verify snake_case keys were normalized to camelCase BEFORE the SDK re-serialized
      // them to snake_case on the wire (round-trip through the SDK model).
      expect(receivedBody).toBeDefined()
      expect(receivedBody?.num_retention_days).toBe(30)
      expect(receivedBody?.daily_limit).toBe(2000000000)
    })

    it('should include raw payload when verbose=true on update', async () => {
      server.use(
        http.put(endpoints.updateLogsIndex('main'), () => {
          return jsonResponse(fixtures.updated)
        })
      )

      const result = await updateIndex(
        api,
        'main',
        {
          filter: { query: '*' },
          num_retention_days: 30
        },
        true
      )

      expect(result.success).toBe(true)
      expect(result.raw).toBeDefined()
    })

    it('should throw when filter.query is missing on update', async () => {
      await expect(
        updateIndex(api, 'main', {
          num_retention_days: 15
        })
      ).rejects.toThrow(/filter\.query/)
    })

    it('should throw when numRetentionDays is missing on update', async () => {
      await expect(
        updateIndex(api, 'main', {
          filter: { query: '*' }
        })
      ).rejects.toThrow(/numRetentionDays/)
    })

    it('should propagate 403 forbidden error on update', async () => {
      server.use(
        http.put(endpoints.updateLogsIndex('main'), () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(
        updateIndex(api, 'main', {
          filter: { query: '*' },
          num_retention_days: 15
        })
      ).rejects.toMatchObject({ code: 403 })
    })
  })

  describe('reorderIndexes', () => {
    it('should reorder indexes and return the new order', async () => {
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.put(endpoints.updateLogsIndexOrder, async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.order)
        })
      )

      const result = await reorderIndexes(api, ['main', 'security', 'low-volume'])

      expect(result.success).toBe(true)
      expect((result.order as { indexNames: string[] }).indexNames).toEqual([
        'main',
        'security',
        'low-volume'
      ])
      // SDK serializes camelCase indexNames → wire index_names.
      expect(receivedBody?.index_names).toEqual(['main', 'security', 'low-volume'])
    })

    it('should propagate 429 rate limit error on reorder', async () => {
      server.use(
        http.put(endpoints.updateLogsIndexOrder, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(reorderIndexes(api, ['main', 'security'])).rejects.toMatchObject({ code: 429 })
    })
  })

  describe('getIndexOrder', () => {
    it('should return the current index order', async () => {
      server.use(
        http.get(endpoints.getLogsIndexOrder, () => {
          return jsonResponse(fixtures.order)
        })
      )

      const result = await getIndexOrder(api)

      expect((result.order as { indexNames: string[] }).indexNames).toEqual([
        'main',
        'security',
        'low-volume'
      ])
    })
  })

  describe('registerLogsIndexesTool — read-only enforcement, dispatch, and schema', () => {
    let mockServer: McpServer
    let registeredHandler: (params: Record<string, unknown>) => Promise<unknown>
    let capturedSchema: Record<string, z.ZodTypeAny>

    beforeEach(() => {
      mockServer = {
        tool: vi.fn(
          (
            _name: string,
            _description: string,
            schema: Record<string, z.ZodTypeAny>,
            handler: (params: Record<string, unknown>) => Promise<unknown>
          ) => {
            capturedSchema = schema
            registeredHandler = handler
          }
        )
      } as unknown as McpServer
    })

    it('should register the tool with the expected name and description', () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, false)

      expect(mockServer.tool).toHaveBeenCalledWith(
        'logs_indexes',
        expect.stringContaining('Datadog Logs indexes'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should expose a description stating that create/delete are UI-only per Datadog', () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, false)

      // Inspect the description that was registered.
      const calls = (mockServer.tool as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const description = calls[0][1] as string
      expect(description).toMatch(/UI-only/i)
    })

    it('should reject action=create at Zod parse time (UI-only per Datadog)', () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, false)

      const actionSchema = capturedSchema.action
      const result = actionSchema.safeParse('create')
      expect(result.success).toBe(false)
    })

    it('should reject action=delete at Zod parse time (UI-only per Datadog)', () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, false)

      const actionSchema = capturedSchema.action
      const result = actionSchema.safeParse('delete')
      expect(result.success).toBe(false)
    })

    it('should accept the documented actions (list, get, update, reorder, get_order)', () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, false)

      const actionSchema = capturedSchema.action
      for (const action of ['list', 'get', 'update', 'reorder', 'get_order']) {
        expect(actionSchema.safeParse(action).success).toBe(true)
      }
    })

    it('should require name for action=get and throw EINVALID_PARAM via requireParam', async () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'get' })).rejects.toThrow(/name/)
    })

    it('should require name for action=update and throw EINVALID_PARAM via requireParam', async () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, false)

      await expect(
        registeredHandler({ action: 'update', config: { filter: { query: '*' } } })
      ).rejects.toThrow(/name/)
    })

    it('should require config for action=update and throw EINVALID_PARAM via requireParam', async () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'update', name: 'main' })).rejects.toThrow(/config/)
    })

    it('should require index_names for action=reorder and throw EINVALID_PARAM via requireParam', async () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'reorder' })).rejects.toThrow(/index_names/)
    })

    it('should block action=update when readOnly=true', async () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, true)

      await expect(
        registeredHandler({
          action: 'update',
          name: 'main',
          config: { filter: { query: '*' }, num_retention_days: 15 }
        })
      ).rejects.toThrow(/read-only/)
    })

    it('should block action=reorder when readOnly=true', async () => {
      registerLogsIndexesTool(mockServer, api, defaultLimits, true)

      await expect(
        registeredHandler({ action: 'reorder', index_names: ['main', 'security'] })
      ).rejects.toThrow(/read-only/)
    })

    it('should allow read actions (list/get/get_order) when readOnly=true', async () => {
      server.use(
        http.get(endpoints.listLogsIndexes, () => jsonResponse(fixtures.list)),
        http.get(endpoints.getLogsIndex('main'), () => jsonResponse(fixtures.single)),
        http.get(endpoints.getLogsIndexOrder, () => jsonResponse(fixtures.order))
      )

      registerLogsIndexesTool(mockServer, api, defaultLimits, true)

      // These three should NOT throw under read-only mode.
      await expect(registeredHandler({ action: 'list' })).resolves.toBeDefined()
      await expect(registeredHandler({ action: 'get', name: 'main' })).resolves.toBeDefined()
      await expect(registeredHandler({ action: 'get_order' })).resolves.toBeDefined()
    })
  })
})
