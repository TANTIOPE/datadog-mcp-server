/**
 * Unit tests for the logs_pipelines tool.
 *
 * Covers each action's happy path, required-field validation on writes,
 * snake_case normalization on update, 401/403/404/429 error propagation,
 * read-only enforcement, and verbose payload behavior.
 *
 * Requirements covered:
 *   - Requirement 1 (list / get / verbose / error mapping)
 *   - Requirement 2 (create / update / delete / read-only / required params / pass-through)
 *   - Requirement 3 (reorder / get_order / read-only)
 *   - Requirement 10 (testing contract)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { logsPipelinesFixtures as fixtures } from '../helpers/fixtures.js'
import {
  listPipelines,
  getPipeline,
  createPipeline,
  updatePipeline,
  deletePipeline,
  reorderPipelines,
  getPipelineOrder,
  registerLogsPipelinesTool
} from '../../src/tools/logs_pipelines.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

describe('Logs Pipelines Tool', () => {
  let api: v1.LogsPipelinesApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.LogsPipelinesApi(config)
  })

  describe('listPipelines', () => {
    it('should list pipelines with default summary projection', async () => {
      server.use(
        http.get(endpoints.listLogsPipelines, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listPipelines(api)

      expect(result.pipelines).toHaveLength(3)
      expect(result.total).toBe(3)
      const first = (result.pipelines as Array<Record<string, unknown>>)[0]
      expect(first.id).toBe('pipeline-001')
      expect(first.name).toBe('NGINX access logs')
      expect(first.filterQuery).toBe('source:nginx')
      expect(first.isEnabled).toBe(true)
      expect(first.isReadOnly).toBe(false)
      expect(first.type).toBe('pipeline')
      expect(first.processorsCount).toBe(2)
      // Default projection does NOT include the full processors array.
      expect(first.processors).toBeUndefined()
      // Raw payload only appears under verbose.
      expect(result.raw).toBeUndefined()
    })

    it('should include the full SDK payload when verbose=true', async () => {
      server.use(
        http.get(endpoints.listLogsPipelines, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listPipelines(api, true)

      expect(result.pipelines).toHaveLength(3)
      // Processors array is retained in the summary under verbose.
      const first = (result.pipelines as Array<Record<string, unknown>>)[0]
      expect(Array.isArray(first.processors)).toBe(true)
      expect((first.processors as unknown[]).length).toBe(2)
      // Raw payload is attached for callers that need fields outside the projection.
      expect(result.raw).toBeDefined()
      expect(Array.isArray(result.raw)).toBe(true)
    })

    it('should propagate 401 unauthorized error on list', async () => {
      server.use(
        http.get(endpoints.listLogsPipelines, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listPipelines(api)).rejects.toMatchObject({ code: 401 })
    })
  })

  describe('getPipeline', () => {
    it('should get a single pipeline by ID', async () => {
      server.use(
        http.get(endpoints.getLogsPipeline('pipeline-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getPipeline(api, 'pipeline-001')

      expect((result.pipeline as Record<string, unknown>).id).toBe('pipeline-001')
      expect((result.pipeline as Record<string, unknown>).name).toBe('NGINX access logs')
      expect((result.pipeline as Record<string, unknown>).filterQuery).toBe('source:nginx')
      expect((result.pipeline as Record<string, unknown>).processorsCount).toBe(1)
    })

    it('should propagate 404 not found error on get', async () => {
      server.use(
        http.get(endpoints.getLogsPipeline('missing'), () => {
          return errorResponse(404, 'Pipeline not found')
        })
      )

      await expect(getPipeline(api, 'missing')).rejects.toMatchObject({ code: 404 })
    })
  })

  describe('createPipeline', () => {
    it('should create a new pipeline with snake_case input normalized', async () => {
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.post(endpoints.createLogsPipeline, async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.created)
        })
      )

      const result = await createPipeline(api, {
        name: 'New Pipeline',
        filter: { query: 'service:new-service' },
        is_enabled: true,
        processors: []
      })

      expect(result.success).toBe(true)
      expect((result.pipeline as Record<string, unknown>).id).toBe('pipeline-new-001')
      // SDK serializes camelCase model back to snake_case on the wire.
      expect(receivedBody).toBeDefined()
      expect(receivedBody?.name).toBe('New Pipeline')
      expect(receivedBody?.is_enabled).toBe(true)
    })

    it('should throw EINVALID_PARAM when name is missing on create', async () => {
      await expect(
        createPipeline(api, {
          filter: { query: 'service:foo' }
        })
      ).rejects.toThrow(/name/)
    })

    it('should throw EINVALID_PARAM when filter.query is missing on create', async () => {
      await expect(
        createPipeline(api, {
          name: 'No filter pipeline'
        })
      ).rejects.toThrow(/filter\.query/)
    })

    it('should propagate 429 rate limit error on create', async () => {
      server.use(
        http.post(endpoints.createLogsPipeline, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(
        createPipeline(api, {
          name: 'Rate-limited Pipeline',
          filter: { query: 'service:foo' }
        })
      ).rejects.toMatchObject({ code: 429 })
    })
  })

  describe('updatePipeline', () => {
    it('should update a pipeline and normalize snake_case keys (filter_query → filterQuery)', async () => {
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.put(endpoints.updateLogsPipeline('pipeline-001'), async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.updated)
        })
      )

      const result = await updatePipeline(api, 'pipeline-001', {
        name: 'NGINX access logs (updated)',
        filter: { query: 'source:nginx AND env:production' },
        is_enabled: false,
        is_read_only: false
      })

      expect(result.success).toBe(true)
      expect((result.pipeline as Record<string, unknown>).id).toBe('pipeline-001')
      expect((result.pipeline as Record<string, unknown>).filterQuery).toBe(
        'source:nginx AND env:production'
      )
      // Verify snake_case was normalized inside the tool before the SDK serialized it.
      expect(receivedBody).toBeDefined()
      expect(receivedBody?.is_enabled).toBe(false)
    })

    it('should propagate 403 forbidden error on update', async () => {
      server.use(
        http.put(endpoints.updateLogsPipeline('pipeline-001'), () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(
        updatePipeline(api, 'pipeline-001', {
          name: 'Updated',
          filter: { query: 'source:nginx' }
        })
      ).rejects.toMatchObject({ code: 403 })
    })

    it('should throw when name is missing on update (PUT is full-replacement)', async () => {
      // Datadog's PUT replaces the full resource — omitting name must fail at
      // the input surface, not produce a cryptic API error downstream.
      await expect(
        updatePipeline(api, 'pipeline-001', {
          filter: { query: 'source:nginx' }
        })
      ).rejects.toThrow(/name/)
    })

    it('should throw when filter.query is missing on update (PUT is full-replacement)', async () => {
      await expect(
        updatePipeline(api, 'pipeline-001', {
          name: 'Missing filter'
        })
      ).rejects.toThrow(/filter\.query/)
    })
  })

  describe('deletePipeline', () => {
    it('should delete a pipeline', async () => {
      server.use(
        http.delete(endpoints.deleteLogsPipeline('pipeline-001'), () => {
          return new Response(null, { status: 204 })
        })
      )

      const result = await deletePipeline(api, 'pipeline-001')

      expect(result.success).toBe(true)
      expect(result.message).toContain('pipeline-001')
    })
  })

  describe('reorderPipelines', () => {
    it('should reorder pipelines and return the new order', async () => {
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.put(endpoints.updateLogsPipelineOrder, async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.order)
        })
      )

      const result = await reorderPipelines(api, ['pipeline-003', 'pipeline-001', 'pipeline-002'])

      expect(result.success).toBe(true)
      expect((result.order as { pipelineIds: string[] }).pipelineIds).toEqual([
        'pipeline-003',
        'pipeline-001',
        'pipeline-002'
      ])
      // SDK serializes camelCase pipelineIds → wire pipeline_ids.
      expect(receivedBody?.pipeline_ids).toEqual(['pipeline-003', 'pipeline-001', 'pipeline-002'])
    })
  })

  describe('getPipelineOrder', () => {
    it('should return the current pipeline order', async () => {
      server.use(
        http.get(endpoints.getLogsPipelineOrder, () => {
          return jsonResponse(fixtures.order)
        })
      )

      const result = await getPipelineOrder(api)

      expect((result.order as { pipelineIds: string[] }).pipelineIds).toEqual([
        'pipeline-003',
        'pipeline-001',
        'pipeline-002'
      ])
    })
  })

  describe('registerLogsPipelinesTool — read-only enforcement & dispatch', () => {
    let mockServer: McpServer
    let registeredHandler: (params: Record<string, unknown>) => Promise<unknown>

    beforeEach(() => {
      mockServer = {
        tool: vi.fn(
          (
            _name: string,
            _description: string,
            _schema: unknown,
            handler: (params: Record<string, unknown>) => Promise<unknown>
          ) => {
            registeredHandler = handler
          }
        )
      } as unknown as McpServer
    })

    it('should register the tool with the expected name and description', () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, false)

      expect(mockServer.tool).toHaveBeenCalledWith(
        'logs_pipelines',
        expect.stringContaining('Datadog Logs pipelines'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should require id for action=get and throw EINVALID_PARAM via requireParam', async () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'get' })).rejects.toThrow(/id/)
    })

    it('should require config for action=create and throw EINVALID_PARAM via requireParam', async () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'create' })).rejects.toThrow(/config/)
    })

    it('should require id for action=update and throw EINVALID_PARAM via requireParam', async () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'update', config: { name: 'x' } })).rejects.toThrow(
        /id/
      )
    })

    it('should require id for action=delete and throw EINVALID_PARAM via requireParam', async () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'delete' })).rejects.toThrow(/id/)
    })

    it('should require pipeline_ids for action=reorder and throw EINVALID_PARAM via requireParam', async () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'reorder' })).rejects.toThrow(/pipeline_ids/)
    })

    it('should block action=create when readOnly=true', async () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, true)

      await expect(
        registeredHandler({
          action: 'create',
          config: { name: 'x', filter: { query: '*' } }
        })
      ).rejects.toThrow(/read-only/)
    })

    it('should block action=update when readOnly=true', async () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, true)

      await expect(
        registeredHandler({
          action: 'update',
          id: 'pipeline-001',
          config: { name: 'x', filter: { query: '*' } }
        })
      ).rejects.toThrow(/read-only/)
    })

    it('should block action=delete when readOnly=true', async () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, true)

      await expect(registeredHandler({ action: 'delete', id: 'pipeline-001' })).rejects.toThrow(
        /read-only/
      )
    })

    it('should block action=reorder when readOnly=true', async () => {
      registerLogsPipelinesTool(mockServer, api, defaultLimits, true)

      await expect(
        registeredHandler({ action: 'reorder', pipeline_ids: ['a', 'b'] })
      ).rejects.toThrow(/read-only/)
    })

    it('should allow read actions (list/get/get_order) when readOnly=true', async () => {
      server.use(
        http.get(endpoints.listLogsPipelines, () => jsonResponse(fixtures.list)),
        http.get(endpoints.getLogsPipeline('pipeline-001'), () => jsonResponse(fixtures.single)),
        http.get(endpoints.getLogsPipelineOrder, () => jsonResponse(fixtures.order))
      )

      registerLogsPipelinesTool(mockServer, api, defaultLimits, true)

      // These three should NOT throw under read-only mode.
      await expect(registeredHandler({ action: 'list' })).resolves.toBeDefined()
      await expect(registeredHandler({ action: 'get', id: 'pipeline-001' })).resolves.toBeDefined()
      await expect(registeredHandler({ action: 'get_order' })).resolves.toBeDefined()
    })
  })
})
