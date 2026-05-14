/**
 * Unit tests for the logs_archives tool.
 *
 * Covers each action's happy path, required-field validation on writes,
 * snake_case normalization on create, destination discriminator validation,
 * destination round-trip pass-through, 401/403/404/429 error propagation,
 * read-only enforcement, and verbose payload behavior.
 *
 * Requirements covered:
 *   - Requirement 7 (list / get / create / update / delete / read-only /
 *     destination discriminator / pass-through / verbose)
 *   - Requirement 8 (reorder / get_order / read-only)
 *   - Requirement 10 (testing contract)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { logsArchivesFixtures as fixtures } from '../helpers/fixtures.js'
import {
  listArchives,
  getArchive,
  createArchive,
  updateArchive,
  deleteArchive,
  reorderArchives,
  getArchiveOrder,
  registerLogsArchivesTool
} from '../../src/tools/logs_archives.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
} as unknown as LimitsConfig

describe('Logs Archives Tool', () => {
  let api: v2.LogsArchivesApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.LogsArchivesApi(config)
  })

  describe('listArchives', () => {
    it('should list archives with default summary projection (s3, gcs, azure variants)', async () => {
      server.use(
        http.get(endpoints.listLogsArchives, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listArchives(api)

      expect(result.archives).toHaveLength(3)
      expect(result.total).toBe(3)

      const archives = result.archives as Array<Record<string, unknown>>
      // S3 variant
      expect(archives[0]?.id).toBe('archive-s3-001')
      expect(archives[0]?.name).toBe('Production logs to S3')
      expect(archives[0]?.query).toBe('env:production')
      expect(archives[0]?.destinationType).toBe('s3')
      expect(archives[0]?.destinationContainer).toBe('company-prod-logs')
      expect(archives[0]?.includeTags).toBe(true)
      expect(archives[0]?.rehydrationTags).toEqual(['source:rehydrated'])
      expect(archives[0]?.state).toBe('WORKING')
      // Default projection omits destination credential blob
      expect(archives[0]?.destination).toBeUndefined()

      // GCS variant
      expect(archives[1]?.destinationType).toBe('gcs')
      expect(archives[1]?.destinationContainer).toBe('company-staging-logs')

      // Azure variant — fixture uses container, not bucket
      expect(archives[2]?.destinationType).toBe('azure')
      expect(archives[2]?.destinationContainer).toBe('datadog-archive')

      // Raw payload only appears under verbose.
      expect(result.raw).toBeUndefined()
    })

    it('should include the full SDK payload when verbose=true', async () => {
      server.use(
        http.get(endpoints.listLogsArchives, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listArchives(api, true)

      expect(result.archives).toHaveLength(3)
      const archives = result.archives as Array<Record<string, unknown>>
      // Destination round-trip surfaces credential / integration fields under verbose.
      const dest = archives[0]?.destination as Record<string, unknown> | undefined
      expect(dest).toBeDefined()
      expect(dest?.type).toBe('s3')
      expect(dest?.bucket).toBe('company-prod-logs')
      // Raw payload attached for callers that need fields outside the projection.
      expect(result.raw).toBeDefined()
    })

    it('should propagate 401 unauthorized error on list', async () => {
      server.use(
        http.get(endpoints.listLogsArchives, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listArchives(api)).rejects.toMatchObject({ code: 401 })
    })
  })

  describe('getArchive', () => {
    it('should get a single archive by ID', async () => {
      server.use(
        http.get(endpoints.getLogsArchive('archive-s3-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getArchive(api, 'archive-s3-001')
      const archive = result.archive as Record<string, unknown>

      expect(archive.id).toBe('archive-s3-001')
      expect(archive.name).toBe('Production logs to S3')
      expect(archive.query).toBe('env:production')
      expect(archive.destinationType).toBe('s3')
      expect(archive.destinationContainer).toBe('company-prod-logs')
    })

    it('should expose full destination under verbose=true', async () => {
      server.use(
        http.get(endpoints.getLogsArchive('archive-s3-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getArchive(api, 'archive-s3-001', true)
      const archive = result.archive as Record<string, unknown>
      const destination = archive.destination as Record<string, unknown> | undefined

      // Provider integration block survives round-trip via SDK.
      expect(destination).toBeDefined()
      expect(destination?.type).toBe('s3')
      expect(destination?.bucket).toBe('company-prod-logs')
      expect(result.raw).toBeDefined()
    })

    it('should propagate 404 not found error on get', async () => {
      server.use(
        http.get(endpoints.getLogsArchive('missing'), () => {
          return errorResponse(404, 'Archive not found')
        })
      )

      await expect(getArchive(api, 'missing')).rejects.toMatchObject({ code: 404 })
    })
  })

  describe('createArchive', () => {
    it('should create a new archive with snake_case input normalized (include_tags → includeTags)', async () => {
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.post(endpoints.createLogsArchive, async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.created)
        })
      )

      const result = await createArchive(api, {
        name: 'New Archive',
        query: 'service:new-service',
        destination: {
          type: 's3',
          bucket: 'company-new-archive',
          path: '/datadog',
          region: 'eu-west-1',
          integration: {
            account_id: '123456789012',
            role_name: 'DatadogLogsArchiveRole'
          }
        },
        include_tags: true,
        rehydration_tags: ['source:new'],
        rehydration_max_scan_size_in_gb: 50
      })

      expect(result.success).toBe(true)
      const archive = result.archive as Record<string, unknown>
      expect(archive.id).toBe('archive-new-001')
      expect(archive.destinationType).toBe('s3')

      // Verify wire payload — SDK serializes camelCase model → snake_case on the wire.
      // The snake_case normalization in normalizeArchiveConfig flipped include_tags →
      // includeTags before the SDK; the SDK then serialized it back to include_tags.
      expect(receivedBody).toBeDefined()
      const data = receivedBody?.data as Record<string, unknown> | undefined
      const attributes = data?.attributes as Record<string, unknown> | undefined
      expect(attributes?.name).toBe('New Archive')
      expect(attributes?.query).toBe('service:new-service')
      expect(attributes?.include_tags).toBe(true)
    })

    it('should pass destination provider credential fields through unchanged (round-trip)', async () => {
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.post(endpoints.createLogsArchive, async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.created)
        })
      )

      await createArchive(api, {
        name: 'Round-trip S3 Archive',
        query: 'env:audit',
        destination: {
          type: 's3',
          bucket: 'audit-archive-bucket',
          path: '/datadog/audit',
          integration: {
            account_id: '999999999999',
            role_name: 'DatadogArchiveRoundtripRole'
          }
        }
      })

      expect(receivedBody).toBeDefined()
      const data = receivedBody?.data as Record<string, unknown>
      const attributes = data?.attributes as Record<string, unknown>
      const destination = attributes?.destination as Record<string, unknown>

      // Destination block forwarded verbatim — type, bucket, path, and integration
      // credential block survive the SDK boundary without local field-dropping.
      expect(destination?.type).toBe('s3')
      expect(destination?.bucket).toBe('audit-archive-bucket')
      expect(destination?.path).toBe('/datadog/audit')
      const integration = destination?.integration as Record<string, unknown>
      expect(integration?.account_id).toBe('999999999999')
      expect(integration?.role_name).toBe('DatadogArchiveRoundtripRole')
    })

    it('should throw when name is missing on create', async () => {
      await expect(
        createArchive(api, {
          query: 'env:production',
          destination: { type: 's3', bucket: 'b' }
        })
      ).rejects.toThrow(/name/)
    })

    it('should throw when query is missing on create', async () => {
      await expect(
        createArchive(api, {
          name: 'No Query Archive',
          destination: { type: 's3', bucket: 'b' }
        })
      ).rejects.toThrow(/query/)
    })

    it('should throw when destination is missing on create', async () => {
      await expect(
        createArchive(api, {
          name: 'No Destination Archive',
          query: 'env:production'
        })
      ).rejects.toThrow(/destination/)
    })

    it('should reject destination.type=unknown with discriminator error', async () => {
      await expect(
        createArchive(api, {
          name: 'Bad Destination Archive',
          query: 'env:production',
          destination: { type: 'unknown', bucket: 'whatever' }
        })
      ).rejects.toThrow('destination.type must be one of: s3, gcs, azure_storage')
    })

    it('should accept destination.type=azure_storage and remap to azure on the wire', async () => {
      // The input contract per spec: callers submit 'azure_storage' (advertised
      // in the tool surface). Internally we remap to 'azure' (the SDK / wire
      // discriminator) before the SDK serializes the body to Datadog.
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.post(endpoints.createLogsArchive, async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.created)
        })
      )

      await createArchive(api, {
        name: 'Azure archive',
        query: 'env:production',
        destination: {
          type: 'azure_storage',
          container: 'datadog-archive',
          storage_account: 'mystorage',
          path: '/datadog',
          integration: {
            tenant_id: 'tenant-uuid',
            client_id: 'client-uuid'
          }
        }
      })

      expect(receivedBody).toBeDefined()
      const data = receivedBody?.data as Record<string, unknown>
      const attributes = data?.attributes as Record<string, unknown>
      const destination = attributes?.destination as Record<string, unknown>
      // Wire discriminator must be 'azure' (Datadog API expectation), not the
      // 'azure_storage' value the caller submitted.
      expect(destination?.type).toBe('azure')
      expect(destination?.container).toBe('datadog-archive')
    })

    it('should propagate 429 rate limit error on create', async () => {
      server.use(
        http.post(endpoints.createLogsArchive, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(
        createArchive(api, {
          name: 'Rate-limited Archive',
          query: 'env:production',
          destination: {
            type: 's3',
            bucket: 'rate-limited-bucket',
            integration: { account_id: '1', role_name: 'r' }
          }
        })
      ).rejects.toMatchObject({ code: 429 })
    })
  })

  describe('updateArchive', () => {
    it('should update an archive and return the updated summary', async () => {
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.put(endpoints.updateLogsArchive('archive-s3-001'), async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.updated)
        })
      )

      const result = await updateArchive(api, 'archive-s3-001', {
        name: 'Production logs to S3 (updated)',
        query: 'env:production AND service:api',
        destination: {
          type: 's3',
          bucket: 'company-prod-logs',
          path: '/datadog/api',
          region: 'us-east-1',
          integration: {
            account_id: '123456789012',
            role_name: 'DatadogLogsArchiveRole'
          }
        },
        include_tags: true
      })

      expect(result.success).toBe(true)
      const archive = result.archive as Record<string, unknown>
      expect(archive.id).toBe('archive-s3-001')
      expect(archive.name).toBe('Production logs to S3 (updated)')
      expect(archive.query).toBe('env:production AND service:api')

      // Wire payload verifies the body was sent.
      const data = receivedBody?.data as Record<string, unknown>
      const attributes = data?.attributes as Record<string, unknown>
      expect(attributes?.name).toBe('Production logs to S3 (updated)')
      expect(attributes?.include_tags).toBe(true)
    })

    it('should propagate 403 forbidden error on update', async () => {
      server.use(
        http.put(endpoints.updateLogsArchive('archive-s3-001'), () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(
        updateArchive(api, 'archive-s3-001', {
          name: 'Forbidden Update',
          query: 'env:production',
          destination: {
            type: 's3',
            bucket: 'b',
            integration: { account_id: '1', role_name: 'r' }
          }
        })
      ).rejects.toMatchObject({ code: 403 })
    })

    it('should throw when destination.type is invalid on update', async () => {
      await expect(
        updateArchive(api, 'archive-s3-001', {
          name: 'Bad Update',
          query: 'env:production',
          destination: { type: 'not-a-valid-type', bucket: 'b' }
        })
      ).rejects.toThrow('destination.type must be one of: s3, gcs, azure_storage')
    })
  })

  describe('deleteArchive', () => {
    it('should delete an archive', async () => {
      server.use(
        http.delete(endpoints.deleteLogsArchive('archive-s3-001'), () => {
          return new Response(null, { status: 204 })
        })
      )

      const result = await deleteArchive(api, 'archive-s3-001')

      expect(result.success).toBe(true)
      expect(result.message).toContain('archive-s3-001')
    })
  })

  describe('reorderArchives', () => {
    it('should reorder archives and return the new order', async () => {
      let receivedBody: Record<string, unknown> | undefined
      server.use(
        http.put(endpoints.updateLogsArchiveOrder, async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse(fixtures.order)
        })
      )

      const result = await reorderArchives(api, [
        'archive-s3-001',
        'archive-gcs-001',
        'archive-azure-001'
      ])

      expect(result.success).toBe(true)
      expect((result.order as { archiveIds: string[] }).archiveIds).toEqual([
        'archive-s3-001',
        'archive-gcs-001',
        'archive-azure-001'
      ])

      // SDK serializes camelCase archiveIds → wire archive_ids.
      const data = receivedBody?.data as Record<string, unknown>
      expect(data?.type).toBe('archive_order')
      const attributes = data?.attributes as Record<string, unknown>
      expect(attributes?.archive_ids).toEqual([
        'archive-s3-001',
        'archive-gcs-001',
        'archive-azure-001'
      ])
    })
  })

  describe('getArchiveOrder', () => {
    it('should return the current archive order', async () => {
      server.use(
        http.get(endpoints.getLogsArchiveOrder, () => {
          return jsonResponse(fixtures.order)
        })
      )

      const result = await getArchiveOrder(api)

      expect((result.order as { archiveIds: string[] }).archiveIds).toEqual([
        'archive-s3-001',
        'archive-gcs-001',
        'archive-azure-001'
      ])
    })
  })

  describe('registerLogsArchivesTool — read-only enforcement & dispatch', () => {
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
      registerLogsArchivesTool(mockServer, api, defaultLimits, false)

      expect(mockServer.tool).toHaveBeenCalledWith(
        'logs_archives',
        expect.stringContaining('Datadog Logs archives'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should require id for action=get and throw via requireParam', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'get' })).rejects.toThrow(/id/)
    })

    it('should require config for action=create and throw via requireParam', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'create' })).rejects.toThrow(/config/)
    })

    it('should require id for action=update and throw via requireParam', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, false)

      await expect(
        registeredHandler({
          action: 'update',
          config: {
            name: 'x',
            query: '*',
            destination: { type: 's3', bucket: 'b' }
          }
        })
      ).rejects.toThrow(/id/)
    })

    it('should require config for action=update and throw via requireParam', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'update', id: 'archive-s3-001' })).rejects.toThrow(
        /config/
      )
    })

    it('should require id for action=delete and throw via requireParam', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'delete' })).rejects.toThrow(/id/)
    })

    it('should require archive_ids for action=reorder and throw via requireParam', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, false)

      await expect(registeredHandler({ action: 'reorder' })).rejects.toThrow(/archive_ids/)
    })

    it('should block action=create when readOnly=true', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, true)

      await expect(
        registeredHandler({
          action: 'create',
          config: {
            name: 'x',
            query: '*',
            destination: { type: 's3', bucket: 'b' }
          }
        })
      ).rejects.toThrow(/read-only/)
    })

    it('should block action=update when readOnly=true', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, true)

      await expect(
        registeredHandler({
          action: 'update',
          id: 'archive-s3-001',
          config: {
            name: 'x',
            query: '*',
            destination: { type: 's3', bucket: 'b' }
          }
        })
      ).rejects.toThrow(/read-only/)
    })

    it('should block action=delete when readOnly=true', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, true)

      await expect(registeredHandler({ action: 'delete', id: 'archive-s3-001' })).rejects.toThrow(
        /read-only/
      )
    })

    it('should block action=reorder when readOnly=true', async () => {
      registerLogsArchivesTool(mockServer, api, defaultLimits, true)

      await expect(
        registeredHandler({
          action: 'reorder',
          archive_ids: ['archive-s3-001', 'archive-gcs-001']
        })
      ).rejects.toThrow(/read-only/)
    })

    it('should allow read actions (list/get/get_order) when readOnly=true', async () => {
      server.use(
        http.get(endpoints.listLogsArchives, () => jsonResponse(fixtures.list)),
        http.get(endpoints.getLogsArchive('archive-s3-001'), () => jsonResponse(fixtures.single)),
        http.get(endpoints.getLogsArchiveOrder, () => jsonResponse(fixtures.order))
      )

      registerLogsArchivesTool(mockServer, api, defaultLimits, true)

      await expect(registeredHandler({ action: 'list' })).resolves.toBeDefined()
      await expect(
        registeredHandler({ action: 'get', id: 'archive-s3-001' })
      ).resolves.toBeDefined()
      await expect(registeredHandler({ action: 'get_order' })).resolves.toBeDefined()
    })
  })
})
