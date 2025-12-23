import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'create', 'update', 'delete', 'trigger', 'results'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z
    .string()
    .optional()
    .describe('Test public ID (required for get/update/delete/trigger/results)'),
  ids: z.array(z.string()).optional().describe('Multiple test IDs (for bulk trigger)'),
  testType: z
    .enum(['api', 'browser'])
    .optional()
    .describe('Test type filter (for list) or type for create'),
  locations: z.array(z.string()).optional().describe('Filter by locations (for list)'),
  tags: z.array(z.string()).optional().describe('Filter by tags (for list)'),
  limit: z.number().min(1).optional().describe('Maximum number of tests to return (default: 50)'),
  config: z
    .record(z.unknown())
    .optional()
    .describe(
      'Test configuration (for create/update). Includes: name, type, config, options, locations, message.'
    )
}

interface SyntheticTestSummary {
  publicId: string
  name: string
  type: string
  subtype: string | null
  status: string
  message: string
  tags: string[]
  locations: string[]
  monitorId: number | null
}

export function formatTest(t: v1.SyntheticsTestDetails): SyntheticTestSummary {
  return {
    publicId: t.publicId ?? '',
    name: t.name ?? '',
    type: String(t.type ?? 'unknown'),
    subtype: t.subtype ? String(t.subtype) : null,
    status: String(t.status ?? 'unknown'),
    message: t.message ?? '',
    tags: t.tags ?? [],
    locations: t.locations ?? [],
    monitorId: t.monitorId ?? null
  }
}

export async function listTests(
  api: v1.SyntheticsApi,
  params: { locations?: string[]; tags?: string[]; limit?: number },
  limits: LimitsConfig
) {
  const effectiveLimit = params.limit ?? limits.defaultLimit

  // Note: listTests API only accepts pageSize/pageNumber, filtering done client-side
  const response = await api.listTests({
    pageSize: effectiveLimit
  })

  let tests = (response.tests ?? []).map(formatTest)

  // Client-side filtering by tags
  if (params.tags && params.tags.length > 0) {
    tests = tests.filter((t) => params.tags!.some((tag) => t.tags.includes(tag)))
  }

  // Client-side filtering by locations
  if (params.locations && params.locations.length > 0) {
    tests = tests.filter((t) => params.locations!.some((loc) => t.locations.includes(loc)))
  }

  tests = tests.slice(0, effectiveLimit)

  const summary = {
    total: response.tests?.length ?? 0,
    api: tests.filter((t) => t.type === 'api').length,
    browser: tests.filter((t) => t.type === 'browser').length,
    passing: tests.filter((t) => t.status === 'OK' || t.status === 'live').length,
    failing: tests.filter((t) => t.status === 'Alert').length
  }

  return { tests, summary }
}

export async function getTest(api: v1.SyntheticsApi, id: string) {
  // Try API test first, then browser
  try {
    const response = await api.getAPITest({ publicId: id })
    return { test: formatTest(response) }
  } catch {
    const response = await api.getBrowserTest({ publicId: id })
    return { test: formatTest(response) }
  }
}

/**
 * Recursively convert snake_case keys to camelCase in an object
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

export function normalizeConfigKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(normalizeConfigKeys)
  if (typeof obj !== 'object') return obj

  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const camelKey = snakeToCamel(key)
    normalized[camelKey] = normalizeConfigKeys(value)
  }
  return normalized
}

/**
 * Normalize synthetics test config to handle snake_case -> camelCase
 */
export function normalizeSyntheticsConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  // Recursively convert all snake_case keys to camelCase
  const normalized = normalizeConfigKeys(config) as Record<string, unknown>

  // Validate required fields
  if (!normalized.name) {
    throw new Error("Synthetics test config requires 'name' field")
  }
  if (
    !normalized.locations ||
    !Array.isArray(normalized.locations) ||
    normalized.locations.length === 0
  ) {
    throw new Error("Synthetics test config requires 'locations' array (e.g., ['aws:us-east-1'])")
  }

  return normalized
}

export async function createTest(
  api: v1.SyntheticsApi,
  config: Record<string, unknown>,
  testType?: 'api' | 'browser'
) {
  const normalizedConfig = normalizeSyntheticsConfig(config)
  const type = testType ?? (normalizedConfig.type === 'browser' ? 'browser' : 'api')

  if (type === 'browser') {
    const body = normalizedConfig as unknown as v1.SyntheticsBrowserTest
    const response = await api.createSyntheticsBrowserTest({ body })
    return {
      success: true,
      test: formatTest(response)
    }
  } else {
    const body = normalizedConfig as unknown as v1.SyntheticsAPITest
    const response = await api.createSyntheticsAPITest({ body })
    return {
      success: true,
      test: formatTest(response)
    }
  }
}

export async function updateTest(
  api: v1.SyntheticsApi,
  id: string,
  config: Record<string, unknown>
) {
  // Normalize config first
  const normalizedConfig = normalizeConfigKeys(config) as Record<string, unknown>

  // Determine test type by fetching it first
  let testType: 'api' | 'browser'
  try {
    await api.getAPITest({ publicId: id })
    testType = 'api'
  } catch {
    testType = 'browser'
  }

  if (testType === 'browser') {
    const body = normalizedConfig as unknown as v1.SyntheticsBrowserTest
    const response = await api.updateBrowserTest({ publicId: id, body })
    return {
      success: true,
      test: formatTest(response)
    }
  } else {
    const body = normalizedConfig as unknown as v1.SyntheticsAPITest
    const response = await api.updateAPITest({ publicId: id, body })
    return {
      success: true,
      test: formatTest(response)
    }
  }
}

export async function deleteTests(api: v1.SyntheticsApi, ids: string[]) {
  await api.deleteTests({
    body: { publicIds: ids }
  })
  return {
    success: true,
    message: `Deleted ${ids.length} test(s): ${ids.join(', ')}`
  }
}

export async function triggerTests(api: v1.SyntheticsApi, ids: string[]) {
  const response = await api.triggerTests({
    body: {
      tests: ids.map((id) => ({ publicId: id }))
    }
  })

  const results =
    response.results?.map((r) => ({
      publicId: r.publicId ?? '',
      resultId: r.resultId ?? '',
      triggered: true
    })) ?? []

  return {
    triggered: results,
    total: results.length
  }
}

export async function getTestResults(api: v1.SyntheticsApi, id: string) {
  // Try API test results first, then browser
  try {
    const response = await api.getAPITestLatestResults({ publicId: id })
    const results = (response.results ?? []).map((r) => ({
      resultId: r.resultId ?? '',
      status: r.result?.passed ? 'passed' : 'failed',
      checkTime: r.checkTime ? new Date(r.checkTime * 1000).toISOString() : '',
      responseTime: r.result?.timings?.total ?? null
    }))
    return { results, testType: 'api' }
  } catch {
    const response = await api.getBrowserTestLatestResults({ publicId: id })
    const results = (response.results ?? []).map((r) => ({
      resultId: r.resultId ?? '',
      // Browser tests don't have 'passed' - determine from errorCount
      status: (r.result?.errorCount ?? 0) === 0 ? 'passed' : 'failed',
      checkTime: r.checkTime ? new Date(r.checkTime * 1000).toISOString() : '',
      duration: r.result?.duration ?? null
    }))
    return { results, testType: 'browser' }
  }
}

export function registerSyntheticsTool(
  server: McpServer,
  api: v1.SyntheticsApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  _site: string = 'datadoghq.com'
): void {
  server.tool(
    'synthetics',
    'Manage Datadog Synthetic tests (API and Browser). Actions: list, get, create, update, delete, trigger, results. Use for: uptime monitoring, API testing, user journey testing, performance testing, canary deployments.',
    InputSchema,
    async ({ action, id, ids, testType, locations, tags, limit, config }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(await listTests(api, { locations, tags, limit }, limits))

          case 'get': {
            const testId = requireParam(id, 'id', 'get')
            return toolResult(await getTest(api, testId))
          }

          case 'create': {
            const testConfig = requireParam(config, 'config', 'create')
            return toolResult(await createTest(api, testConfig, testType))
          }

          case 'update': {
            const testId = requireParam(id, 'id', 'update')
            const testConfig = requireParam(config, 'config', 'update')
            return toolResult(await updateTest(api, testId, testConfig))
          }

          case 'delete': {
            const testIds = ids ?? (id ? [id] : undefined)
            const deleteIds = requireParam(testIds, 'id or ids', 'delete')
            return toolResult(await deleteTests(api, deleteIds))
          }

          case 'trigger': {
            const testIds = ids ?? (id ? [id] : undefined)
            const triggerIds = requireParam(testIds, 'id or ids', 'trigger')
            return toolResult(await triggerTests(api, triggerIds))
          }

          case 'results': {
            const testId = requireParam(id, 'id', 'results')
            return toolResult(await getTestResults(api, testId))
          }

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
