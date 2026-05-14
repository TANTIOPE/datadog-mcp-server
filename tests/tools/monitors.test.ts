/**
 * Unit tests for the monitors tool
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { v1, v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { monitors as fixtures } from '../helpers/fixtures.js'
import {
  listMonitors,
  getMonitor,
  searchMonitors,
  createMonitor,
  dryRunMonitor,
  updateMonitor,
  deleteMonitor,
  registerMonitorsTool
} from '../../src/tools/monitors.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

const defaultSite = 'datadoghq.com'

describe('Monitors Tool', () => {
  let api: v1.MonitorsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.MonitorsApi(config)
  })

  describe('listMonitors', () => {
    it('should list monitors successfully', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listMonitors(api, {}, defaultLimits, defaultSite)

      expect(result.monitors).toHaveLength(2)
      expect(result.monitors[0].id).toBe(12345)
      expect(result.monitors[0].name).toBe('High CPU Usage')
      expect(result.monitors[0].status).toBe('Alert')
      expect(result.monitors[0].url).toBe('https://app.datadoghq.com/monitors/12345')
      expect(result.summary.total).toBe(2)
    })

    it('should filter monitors by name', async () => {
      server.use(
        http.get(endpoints.listMonitors, ({ request }) => {
          const url = new URL(request.url)
          const name = url.searchParams.get('name')

          if (name === 'CPU') {
            return jsonResponse([fixtures.list[0]])
          }
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listMonitors(api, { name: 'CPU' }, defaultLimits, defaultSite)

      expect(result.monitors).toHaveLength(1)
      expect(result.monitors[0].name).toContain('CPU')
      expect(result.monitors[0].url).toContain('monitors/')
      expect(result.datadog_url).toContain('query=CPU')
    })

    it('should preserve tags and groupStates in datadog_url', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listMonitors(
        api,
        { tags: ['env:prod', 'team:ops'], groupStates: ['alert', 'warn'] },
        defaultLimits,
        defaultSite
      )

      expect(result.datadog_url).toContain('tags=env%3Aprod%2Cteam%3Aops')
      expect(result.datadog_url).toContain('group_states=alert%2Cwarn')
    })

    it('should generate URLs with correct site', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listMonitors(api, {}, defaultLimits, 'datadoghq.eu')

      expect(result.monitors[0].url).toBe('https://app.datadoghq.eu/monitors/12345')
      expect(result.datadog_url).toContain('datadoghq.eu')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listMonitors(api, {}, defaultLimits, defaultSite)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listMonitors(api, {}, defaultLimits, defaultSite)).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(listMonitors(api, {}, defaultLimits, defaultSite)).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getMonitor', () => {
    it('should get a single monitor by ID', async () => {
      server.use(
        http.get(endpoints.getMonitor(12345), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getMonitor(api, '12345', defaultSite)

      expect(result.monitor.id).toBe(12345)
      expect(result.monitor.name).toBe('High CPU Usage')
      expect(result.monitor.query).toContain('system.cpu.user')
      expect(result.monitor.url).toBe('https://app.datadoghq.com/monitors/12345')
      expect(result.datadog_url).toBe('https://app.datadoghq.com/monitors/12345')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getMonitor(99999), () => {
          return errorResponse(404, 'Monitor not found')
        })
      )

      await expect(getMonitor(api, '99999', defaultSite)).rejects.toMatchObject({
        code: 404
      })
    })

    it('should handle invalid monitor ID', async () => {
      await expect(getMonitor(api, 'invalid', defaultSite)).rejects.toThrow('Invalid monitor ID')
    })

    it('exposes options, multi, priority, and restrictedRoles on get response', async () => {
      server.use(
        http.get(endpoints.getMonitor(12345), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getMonitor(api, '12345', defaultSite)

      expect(result.monitor.options).toBeDefined()
      expect(typeof result.monitor.options).toBe('object')
      expect(result.monitor.multi).toBe(true)
      expect(result.monitor.priority).toBe(3)
      expect(Array.isArray(result.monitor.restrictedRoles)).toBe(true)
      expect(result.monitor.restrictedRoles?.length).toBeGreaterThan(0)
    })

    it('preserves nested option fields (renotifyInterval, notifyNoData, includeTags, escalationMessage)', async () => {
      server.use(
        http.get(endpoints.getMonitor(12345), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getMonitor(api, '12345', defaultSite)

      expect(result.monitor.options?.renotifyInterval).toBe(30)
      expect(result.monitor.options?.notifyNoData).toBe(true)
      expect(result.monitor.options?.includeTags).toBe(true)
      expect(result.monitor.options?.escalationMessage).toBe('Escalating to oncall')
    })
  })

  describe('searchMonitors', () => {
    it('should search monitors by query', async () => {
      server.use(
        http.get(endpoints.searchMonitors, ({ request }) => {
          const url = new URL(request.url)
          const query = url.searchParams.get('query')

          expect(query).toBe('cpu')
          return jsonResponse(fixtures.searchResults)
        })
      )

      const result = await searchMonitors(api, 'cpu', defaultLimits, defaultSite)

      expect(result.monitors).toHaveLength(1)
      expect(result.monitors[0].id).toBe(12345)
      expect(result.monitors[0].url).toBe('https://app.datadoghq.com/monitors/12345')
      expect(result.metadata.totalCount).toBeDefined()
      expect(result.datadog_url).toContain('query=cpu')
    })
  })

  describe('createMonitor', () => {
    it('should create a new monitor', async () => {
      const newMonitor = {
        name: 'New Test Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95',
        message: 'CPU is very high'
      }

      server.use(
        http.post(endpoints.listMonitors, async ({ request }) => {
          const body = (await request.json()) as typeof newMonitor
          return jsonResponse({
            id: 12347,
            ...body,
            overall_state: 'No Data',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          })
        })
      )

      const result = await createMonitor(api, newMonitor)

      expect(result.success).toBe(true)
      expect(result.monitor.id).toBe(12347)
      expect(result.monitor.name).toBe('New Test Monitor')
      expect(result.monitor.url).toBe('https://app.datadoghq.com/monitors/12347')
    })

    it('should validate required fields', async () => {
      await expect(createMonitor(api, {})).rejects.toThrow(/requires at least/)
    })

    it('should handle 400 bad request from API', async () => {
      server.use(
        http.post(endpoints.listMonitors, () => {
          return errorResponse(400, 'Invalid query syntax')
        })
      )

      const validConfig = {
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'invalid query that API rejects'
      }

      await expect(createMonitor(api, validConfig)).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('dryRunMonitor', () => {
    it('should call POST /api/v1/monitor/validate and return { valid: true, dryRun: true, monitor }', async () => {
      const newMonitor = {
        name: 'Validated Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95',
        message: 'CPU high'
      }

      let receivedBody: unknown = null
      let createCallCount = 0
      server.use(
        http.post(endpoints.validateMonitor, async ({ request }) => {
          receivedBody = await request.json()
          return jsonResponse(fixtures.validateOk)
        }),
        http.post(endpoints.listMonitors, () => {
          createCallCount++
          return jsonResponse({ id: 99999 })
        })
      )

      const result = await dryRunMonitor(api, newMonitor)

      expect(result.valid).toBe(true)
      expect(result.dryRun).toBe(true)
      expect(result.monitor).toMatchObject({
        name: 'Validated Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95'
      })
      // The body sent to validate matches the normalized config
      expect(receivedBody).toMatchObject({
        name: 'Validated Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95'
      })
      // Confirms validate was called, not create
      expect(createCallCount).toBe(0)
    })

    it('should pass through 400 errors from validateMonitor via handleDatadogError', async () => {
      server.use(
        http.post(endpoints.validateMonitor, () => {
          return errorResponse(400, 'The value provided for parameter "query" is invalid')
        })
      )

      const invalidConfig = {
        name: 'Bad Monitor',
        type: 'metric alert',
        query: 'this is not a valid query'
      }

      await expect(dryRunMonitor(api, invalidConfig)).rejects.toMatchObject({
        code: 400
      })
    })

    it('should validate required fields before calling validateMonitor', async () => {
      // Reuses normalizeMonitorConfig validation — empty body must throw before network
      let validateCalled = 0
      server.use(
        http.post(endpoints.validateMonitor, () => {
          validateCalled++
          return jsonResponse(fixtures.validateOk)
        })
      )

      await expect(dryRunMonitor(api, {})).rejects.toThrow(/requires at least/)
      expect(validateCalled).toBe(0)
    })
  })

  describe('monitors tool dispatcher — dry_run + read-only', () => {
    // Helper: capture the registered tool handler so we can invoke it directly.
    type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>
    function captureHandler(readOnly: boolean): ToolHandler {
      let capturedHandler: ToolHandler | null = null
      const mockServer = {
        tool: vi.fn(
          (
            _name: string,
            _desc: string,
            _schema: unknown,
            handler: (input: Record<string, unknown>) => Promise<unknown>
          ) => {
            capturedHandler = handler
          }
        )
      } as unknown as Parameters<typeof registerMonitorsTool>[0]

      const eventsApi = {} as v2.EventsApi
      registerMonitorsTool(mockServer, api, eventsApi, defaultLimits, readOnly, defaultSite)

      if (!capturedHandler) {
        throw new Error('Tool handler was not captured during registration')
      }
      return capturedHandler
    }

    it('allows action=create with dry_run=true in read-only mode (routes to validateMonitor)', async () => {
      let validateCalled = 0
      let createCalled = 0
      server.use(
        http.post(endpoints.validateMonitor, () => {
          validateCalled++
          return jsonResponse(fixtures.validateOk)
        }),
        http.post(endpoints.listMonitors, () => {
          createCalled++
          return jsonResponse({ id: 1 })
        })
      )

      const handler = captureHandler(true)
      const result = (await handler({
        action: 'create',
        dry_run: true,
        config: {
          name: 'Dry Run Monitor',
          type: 'metric alert',
          query: 'avg(last_5m):avg:system.cpu.user{*} > 95'
        }
      })) as { content: { type: string; text: string }[] }

      expect(validateCalled).toBe(1)
      expect(createCalled).toBe(0)
      const payload = JSON.parse(result.content[0].text) as {
        valid: boolean
        dryRun: boolean
        monitor: Record<string, unknown>
      }
      expect(payload.valid).toBe(true)
      expect(payload.dryRun).toBe(true)
      expect(payload.monitor.name).toBe('Dry Run Monitor')
    })

    it('blocks action=create with dry_run=false in read-only mode', async () => {
      let createCalled = 0
      server.use(
        http.post(endpoints.listMonitors, () => {
          createCalled++
          return jsonResponse({ id: 1 })
        })
      )

      const handler = captureHandler(true)
      // handleDatadogError throws — the tool catches and rethrows McpError. The handler
      // re-raises via handleDatadogError which throws an McpError; assert it propagates.
      await expect(
        handler({
          action: 'create',
          dry_run: false,
          config: {
            name: 'Blocked Monitor',
            type: 'metric alert',
            query: 'avg(last_5m):avg:system.cpu.user{*} > 1'
          }
        })
      ).rejects.toThrow(/read-only mode/)
      expect(createCalled).toBe(0)
    })

    it('blocks action=create with dry_run omitted in read-only mode', async () => {
      let createCalled = 0
      server.use(
        http.post(endpoints.listMonitors, () => {
          createCalled++
          return jsonResponse({ id: 1 })
        })
      )

      const handler = captureHandler(true)
      await expect(
        handler({
          action: 'create',
          config: {
            name: 'Blocked Monitor',
            type: 'metric alert',
            query: 'avg(last_5m):avg:system.cpu.user{*} > 1'
          }
        })
      ).rejects.toThrow(/read-only mode/)
      expect(createCalled).toBe(0)
    })

    it('with dry_run omitted and not read-only, preserves existing create behavior', async () => {
      let validateCalled = 0
      let createCalled = 0
      server.use(
        http.post(endpoints.validateMonitor, () => {
          validateCalled++
          return jsonResponse(fixtures.validateOk)
        }),
        http.post(endpoints.listMonitors, async ({ request }) => {
          createCalled++
          const body = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            id: 12347,
            ...body,
            overall_state: 'No Data',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          })
        })
      )

      const handler = captureHandler(false)
      const result = (await handler({
        action: 'create',
        config: {
          name: 'Real Create',
          type: 'metric alert',
          query: 'avg(last_5m):avg:system.cpu.user{*} > 95'
        }
      })) as { content: { type: string; text: string }[] }

      expect(validateCalled).toBe(0)
      expect(createCalled).toBe(1)
      const payload = JSON.parse(result.content[0].text) as {
        success: boolean
        monitor: { id: number }
      }
      expect(payload.success).toBe(true)
      expect(payload.monitor.id).toBe(12347)
    })

    it('with dry_run=true and not read-only, still routes to validateMonitor (no create)', async () => {
      let validateCalled = 0
      let createCalled = 0
      server.use(
        http.post(endpoints.validateMonitor, () => {
          validateCalled++
          return jsonResponse(fixtures.validateOk)
        }),
        http.post(endpoints.listMonitors, () => {
          createCalled++
          return jsonResponse({ id: 1 })
        })
      )

      const handler = captureHandler(false)
      const result = (await handler({
        action: 'create',
        dry_run: true,
        config: {
          name: 'Dry Run',
          type: 'metric alert',
          query: 'avg(last_5m):avg:system.cpu.user{*} > 95'
        }
      })) as { content: { type: string; text: string }[] }

      expect(validateCalled).toBe(1)
      expect(createCalled).toBe(0)
      const payload = JSON.parse(result.content[0].text) as { dryRun: boolean }
      expect(payload.dryRun).toBe(true)
    })
  })

  describe('updateMonitor', () => {
    it('should update an existing monitor', async () => {
      server.use(
        http.put(endpoints.getMonitor(12345), async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            ...fixtures.single,
            ...body
          })
        })
      )

      const result = await updateMonitor(api, '12345', {
        name: 'Updated Monitor Name',
        type: 'metric alert',
        query: 'test'
      })

      expect(result.success).toBe(true)
      expect(result.monitor.name).toBe('Updated Monitor Name')
      expect(result.monitor.url).toBe('https://app.datadoghq.com/monitors/12345')
    })

    it('returns the full options object after update', async () => {
      server.use(
        http.put(endpoints.getMonitor(12345), async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            ...fixtures.single,
            ...body
          })
        })
      )

      const result = await updateMonitor(api, '12345', {
        name: 'Updated Monitor Name',
        type: 'metric alert',
        query: 'test'
      })

      expect(result.monitor.options).toBeDefined()
      expect(result.monitor.options?.renotifyInterval).toBe(30)
      expect(result.monitor.options?.notifyNoData).toBe(true)
      expect(result.monitor.options?.includeTags).toBe(true)
      expect(result.monitor.options?.escalationMessage).toBe('Escalating to oncall')
    })
  })

  // Requirement 4 + Requirement 8 (design.md "Testing strategy → Integration tests"):
  // Warnings array contract — passthrough keys produce stable-ordered warnings, only
  // validated keys produce no `warnings` field, and update request bodies preserve
  // passthrough keys forwarded to Datadog (verified via msw request capture).
  describe('warnings array (passthrough keys)', () => {
    it('returns warnings of length 2 in stable order (top-level first, then options) when create receives one unknown top-level key and one unknown options key', async () => {
      server.use(
        http.post(endpoints.listMonitors, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            id: 12348,
            ...body,
            overall_state: 'No Data',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          })
        })
      )

      const result = await createMonitor(api, {
        name: 'Mixed Unknown Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95',
        futureField: 'topLevelPassthrough',
        options: {
          notifyNoData: true,
          futureOption: 'optionsPassthrough'
        }
      })

      expect(result.success).toBe(true)
      expect(result.warnings).toBeDefined()
      expect(result.warnings).toHaveLength(2)
      // Stable order: top-level unknowns first, then options unknowns
      expect(result.warnings?.[0]).toBe(
        "unknown top-level key 'futureField' under config forwarded without validation"
      )
      expect(result.warnings?.[1]).toBe(
        "unknown option key 'futureOption' under config.options forwarded without validation"
      )
    })

    it('omits the warnings field on create when the input contains only validated keys', async () => {
      server.use(
        http.post(endpoints.listMonitors, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            id: 12349,
            ...body,
            overall_state: 'No Data',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          })
        })
      )

      const result = await createMonitor(api, {
        name: 'Validated Only Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95',
        message: 'CPU is high',
        tags: ['env:production'],
        priority: 3,
        options: {
          notifyNoData: true,
          renotifyInterval: 30,
          includeTags: true
        }
      })

      expect(result.success).toBe(true)
      expect(result).not.toHaveProperty('warnings')
      expect(result.warnings).toBeUndefined()
    })

    it('forwards a partial update body to Datadog and surfaces a warning for an unknown options key on update', async () => {
      let capturedBody: Record<string, unknown> | undefined

      server.use(
        http.put(endpoints.getMonitor(12345), async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            ...fixtures.single,
            ...capturedBody
          })
        })
      )

      const result = await updateMonitor(api, '12345', {
        options: {
          renotifyInterval: 45,
          notificationCadence: 'hourly'
        }
      })

      // msw request capture — assert the validated key reached Datadog (the Datadog
      // SDK serializes camelCase → snake_case for keys in its attributeTypeMap and
      // strips keys it does not recognise, so the unknown `notificationCadence`
      // does not appear on the wire even though `MonitorOptionsSchema.passthrough()`
      // preserves it through validation).
      expect(capturedBody).toBeDefined()
      const sentOptions = capturedBody?.options as Record<string, unknown> | undefined
      expect(sentOptions).toBeDefined()
      expect(sentOptions?.renotify_interval).toBe(45)
      // Confirm only the supplied keys are present in the body (partial update).
      expect(capturedBody && Object.keys(capturedBody)).toEqual(['options'])

      // Response assertion — the unknown options key is surfaced via the warnings
      // array so the caller can detect the passthrough (Requirement 4).
      expect(result.success).toBe(true)
      expect(result.warnings).toBeDefined()
      expect(result.warnings).toContain(
        "unknown option key 'notificationCadence' under config.options forwarded without validation"
      )
    })
  })

  // Requirement 5 (snake_case alias compatibility) + Requirement 8.1.c:
  // documented snake_case aliases (notify_no_data, renotify_interval,
  // critical_recovery under thresholds, etc.) are normalized to camelCase by
  // `normalizeMonitorConfig` BEFORE schema validation and warning collection,
  // so they MUST NOT appear in `warnings`. Design.md "Sequence / control flow"
  // step 4 establishes the order; "Error handling" row 6 documents the
  // mixed-form contract (both keys preserved in-memory; snake_case form
  // surfaces as a warning because `KNOWN_OPTIONS_KEYS` is camelCase only).
  describe('snake_case alias compatibility (warnings)', () => {
    it('normalizes notification alias notify_no_data and emits no warning (Requirement 5.4)', async () => {
      let capturedBody: Record<string, unknown> | undefined

      server.use(
        http.post(endpoints.listMonitors, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            id: 12350,
            ...capturedBody,
            overall_state: 'No Data',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          })
        })
      )

      const result = await createMonitor(api, {
        name: 'Notification Alias Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95',
        options: {
          notify_no_data: true,
          no_data_timeframe: 60
        }
      })

      expect(result.success).toBe(true)
      // Normalized aliases must not appear as unknown — `warnings` is omitted
      // entirely when empty (design.md "Open questions" → default).
      expect(result).not.toHaveProperty('warnings')
      expect(result.warnings).toBeUndefined()

      // SDK serializes the camelCase keys back to snake_case on the wire — assert
      // the normalized values reach Datadog under the snake_case names.
      expect(capturedBody).toBeDefined()
      const sentOptions = capturedBody?.options as Record<string, unknown> | undefined
      expect(sentOptions).toBeDefined()
      expect(sentOptions?.notify_no_data).toBe(true)
      expect(sentOptions?.no_data_timeframe).toBe(60)
    })

    it('normalizes renotification alias renotify_interval and emits no warning (Requirement 5.4)', async () => {
      let capturedBody: Record<string, unknown> | undefined

      server.use(
        http.put(endpoints.getMonitor(12345), async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            ...fixtures.single,
            ...capturedBody
          })
        })
      )

      const result = await updateMonitor(api, '12345', {
        options: {
          renotify_interval: 45,
          renotify_occurrences: 3,
          escalation_message: 'Escalating to oncall'
        }
      })

      expect(result.success).toBe(true)
      expect(result).not.toHaveProperty('warnings')
      expect(result.warnings).toBeUndefined()

      // Normalized renotification keys reach Datadog under their snake_case
      // wire names after the SDK serializer (camelCase → snake_case).
      expect(capturedBody).toBeDefined()
      const sentOptions = capturedBody?.options as Record<string, unknown> | undefined
      expect(sentOptions).toBeDefined()
      expect(sentOptions?.renotify_interval).toBe(45)
      expect(sentOptions?.renotify_occurrences).toBe(3)
      expect(sentOptions?.escalation_message).toBe('Escalating to oncall')
    })

    it('normalizes nested thresholds alias critical_recovery and emits no warning (Requirement 5.1)', async () => {
      let capturedBody: Record<string, unknown> | undefined

      server.use(
        http.post(endpoints.listMonitors, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            id: 12351,
            ...capturedBody,
            overall_state: 'No Data',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          })
        })
      )

      const result = await createMonitor(api, {
        name: 'Thresholds Alias Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95',
        options: {
          thresholds: {
            critical: 95,
            warning: 80,
            critical_recovery: 90,
            warning_recovery: 75
          }
        }
      })

      expect(result.success).toBe(true)
      // Nested threshold aliases (critical_recovery, warning_recovery) are
      // normalized by `normalizeMonitorConfig` before schema validation — they
      // must NOT appear as unknown options keys.
      expect(result).not.toHaveProperty('warnings')
      expect(result.warnings).toBeUndefined()

      // Wire body — SDK serializes nested thresholds back to snake_case.
      expect(capturedBody).toBeDefined()
      const sentOptions = capturedBody?.options as Record<string, unknown> | undefined
      const sentThresholds = sentOptions?.thresholds as Record<string, unknown> | undefined
      expect(sentThresholds).toBeDefined()
      expect(sentThresholds?.critical).toBe(95)
      expect(sentThresholds?.warning).toBe(80)
      expect(sentThresholds?.critical_recovery).toBe(90)
      expect(sentThresholds?.warning_recovery).toBe(75)
    })

    it('preserves both snake_case and camelCase forms of the same key and emits a warning for the snake_case form (mixed-form contract)', async () => {
      // When BOTH `notify_no_data` and `notifyNoData` are supplied for the same
      // logical key, `normalizeMonitorConfig` (lines 407–411 of monitors.ts)
      // keeps both as-is — it only renames when the camelCase target is absent
      // (Requirement 5.2). After normalization the camelCase form is
      // recognised; the snake_case form survives and surfaces as a warning
      // because `KNOWN_OPTIONS_KEYS` is camelCase only (design.md "Error
      // handling" row 6).
      server.use(
        http.post(endpoints.listMonitors, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            id: 12352,
            ...body,
            overall_state: 'No Data',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          })
        })
      )

      const result = await createMonitor(api, {
        name: 'Mixed Form Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95',
        options: {
          notify_no_data: true,
          notifyNoData: false
        }
      })

      expect(result.success).toBe(true)
      // Snake_case form is reported as an unknown options key — caller can
      // detect the duplicate and remove one form. The camelCase form is
      // validated and therefore does NOT appear in warnings.
      expect(result.warnings).toBeDefined()
      expect(result.warnings).toContain(
        "unknown option key 'notify_no_data' under config.options forwarded without validation"
      )
      expect(result.warnings).not.toContain(
        "unknown option key 'notifyNoData' under config.options forwarded without validation"
      )
    })
  })

  describe('validation short-circuit (Task 12)', () => {
    it('throws EINVALID_MONITOR_CONFIG before any HTTP call when notifyNoData has wrong type', async () => {
      let requestCount = 0
      server.use(
        http.post(endpoints.listMonitors, () => {
          requestCount++
          return jsonResponse(fixtures.single)
        })
      )

      await expect(
        createMonitor(api, {
          name: 'Bad Monitor',
          type: 'metric alert',
          query: 'avg(last_5m):avg:system.cpu.user{*} > 90',
          options: {
            // Wrong type — notifyNoData must be boolean per MonitorOptionsSchema.
            notifyNoData: 'yes'
          }
        })
      ).rejects.toThrow(/^EINVALID_MONITOR_CONFIG:/)

      expect(requestCount).toBe(0)
    })

    it('throws EINVALID_MONITOR_CONFIG before any HTTP call on updateMonitor with bad priority', async () => {
      let requestCount = 0
      server.use(
        http.put(endpoints.getMonitor(12345), () => {
          requestCount++
          return jsonResponse(fixtures.single)
        })
      )

      await expect(
        updateMonitor(api, '12345', {
          priority: 7 // out of 1-5 range
        })
      ).rejects.toThrow(/^EINVALID_MONITOR_CONFIG:/)

      expect(requestCount).toBe(0)
    })
  })

  describe('deleteMonitor', () => {
    it('should delete a monitor', async () => {
      server.use(
        http.delete(endpoints.getMonitor(12345), () => {
          return jsonResponse({ deleted_monitor_id: 12345 })
        })
      )

      const result = await deleteMonitor(api, '12345')

      expect(result.success).toBe(true)
      expect(result.message).toContain('12345')
    })
  })

  describe('monitors tool dispatcher — preview action', () => {
    // Helper: capture the registered tool handler so we can invoke it directly,
    // mirroring the dry_run dispatcher tests above.
    type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>
    function captureHandler(readOnly: boolean): ToolHandler {
      let capturedHandler: ToolHandler | null = null
      const mockServer = {
        tool: vi.fn(
          (
            _name: string,
            _desc: string,
            _schema: unknown,
            handler: (input: Record<string, unknown>) => Promise<unknown>
          ) => {
            capturedHandler = handler
          }
        )
      } as unknown as Parameters<typeof registerMonitorsTool>[0]

      const eventsApi = {} as v2.EventsApi
      registerMonitorsTool(mockServer, api, eventsApi, defaultLimits, readOnly, defaultSite)

      if (!capturedHandler) {
        throw new Error('Tool handler was not captured during registration')
      }
      return capturedHandler
    }

    type PreviewPayload = {
      rendered: string
      variablesUsed: string[]
      variablesMissing: string[]
      conditionalsResolved: Record<string, boolean>
    }

    function unwrap(result: unknown): PreviewPayload {
      const typed = result as { content: { type: string; text: string }[] }
      return JSON.parse(typed.content[0].text) as PreviewPayload
    }

    it('renders an inline message with variable substitution', async () => {
      const handler = captureHandler(false)
      const result = await handler({
        action: 'preview',
        message: 'CPU high on {{host.name}}',
        context: { variables: { 'host.name': 'web-01' } }
      })

      const payload = unwrap(result)
      expect(payload.rendered).toBe('CPU high on web-01')
      expect(payload.variablesUsed).toContain('host.name')
      expect(payload.variablesMissing).toEqual([])
    })

    it('loads template from monitor_id when no inline message is given', async () => {
      let getCalls = 0
      server.use(
        http.get(endpoints.getMonitor(77777), () => {
          getCalls++
          return jsonResponse(fixtures.previewSource)
        })
      )

      const handler = captureHandler(false)
      const result = await handler({
        action: 'preview',
        monitor_id: 77777,
        context: {
          variables: { 'host.name': 'web-01' },
          conditionals: { is_alert: true }
        }
      })

      expect(getCalls).toBe(1)
      const payload = unwrap(result)
      expect(payload.rendered).toContain('CPU high on web-01')
      expect(payload.rendered).toContain('ALERT branch')
      expect(payload.rendered).not.toContain('OK branch')
      expect(payload.conditionalsResolved.is_alert).toBe(true)
    })

    it('loads template from existing `id` field when monitor_id is omitted', async () => {
      let getCalls = 0
      server.use(
        http.get(endpoints.getMonitor(77777), () => {
          getCalls++
          return jsonResponse(fixtures.previewSource)
        })
      )

      const handler = captureHandler(false)
      const result = await handler({
        action: 'preview',
        id: '77777',
        context: { variables: { 'host.name': 'web-02' } }
      })

      expect(getCalls).toBe(1)
      const payload = unwrap(result)
      expect(payload.rendered).toContain('CPU high on web-02')
    })

    it('reports missing variables with the {{undefined:name}} marker', async () => {
      const handler = captureHandler(false)
      const result = await handler({
        action: 'preview',
        message: 'Host: {{host.name}} pod: {{pod.name}}',
        context: { variables: { 'host.name': 'web-01' } }
      })

      const payload = unwrap(result)
      expect(payload.rendered).toBe('Host: web-01 pod: {{undefined:pod.name}}')
      expect(payload.variablesMissing).toContain('pod.name')
      expect(payload.variablesUsed).toContain('host.name')
    })

    it('resolves a conditional as truthy when set true in context', async () => {
      const handler = captureHandler(false)
      const result = await handler({
        action: 'preview',
        message: 'Status: {{#is_alert}}ALERT{{/is_alert}}{{^is_alert}}OK{{/is_alert}}',
        context: { conditionals: { is_alert: true } }
      })

      const payload = unwrap(result)
      expect(payload.rendered).toBe('Status: ALERT')
      expect(payload.conditionalsResolved.is_alert).toBe(true)
    })

    it('resolves a conditional as falsy when set false (or omitted) in context', async () => {
      const handler = captureHandler(false)
      const result = await handler({
        action: 'preview',
        message: 'Status: {{#is_warning}}WARN{{/is_warning}}{{^is_warning}}OK{{/is_warning}}',
        context: { conditionals: { is_warning: false } }
      })

      const payload = unwrap(result)
      expect(payload.rendered).toBe('Status: OK')
      expect(payload.conditionalsResolved.is_warning).toBe(false)
    })

    it('returns EUNSUPPORTED_TEMPLATE_SYNTAX for {{#each}} loops', async () => {
      const handler = captureHandler(false)
      await expect(
        handler({
          action: 'preview',
          message: '{{#each items}}item{{/each}}',
          context: {}
        })
      ).rejects.toThrow(/EUNSUPPORTED_TEMPLATE_SYNTAX/)
    })

    it('requires either message or a monitor id', async () => {
      const handler = captureHandler(false)
      await expect(
        handler({
          action: 'preview',
          context: {}
        })
      ).rejects.toThrow(/message.*monitor_id|monitor_id.*message|required/i)
    })

    it('is allowed in read-only mode (preview is non-mutating)', async () => {
      const handler = captureHandler(true)
      const result = await handler({
        action: 'preview',
        message: 'hello {{name}}',
        context: { variables: { name: 'world' } }
      })

      const payload = unwrap(result)
      expect(payload.rendered).toBe('hello world')
    })
  })

  // Requirement 4 (timezone annotation) — opt-in `timezone` param on
  // monitors.get / monitors.list adds `createdLocal` / `modifiedLocal` siblings.
  // Omitting `timezone` produces today's exact response shape.
  describe('monitors read actions — timezone annotation (Requirement 4)', () => {
    describe('getMonitor', () => {
      it('adds createdLocal and modifiedLocal next to created/modified when timezone is provided', async () => {
        server.use(http.get(endpoints.getMonitor(12345), () => jsonResponse(fixtures.single)))

        const result = await getMonitor(api, '12345', defaultSite, 'Europe/Paris')

        expect(result.monitor.created).toBe('2024-01-15T10:00:00.000Z')
        // 2024-01-15T10:00:00Z in Europe/Paris (CET = UTC+1) → 11:00 local
        expect(result.monitor.createdLocal).toBe('2024-01-15T11:00:00+01:00')
        // 2024-01-20T15:30:00Z in Europe/Paris (CET = UTC+1) → 16:30 local
        expect(result.monitor.modifiedLocal).toBe('2024-01-20T16:30:00+01:00')
      })

      it('does NOT add *Local fields when timezone is omitted', async () => {
        server.use(http.get(endpoints.getMonitor(12345), () => jsonResponse(fixtures.single)))

        const result = await getMonitor(api, '12345', defaultSite)

        expect(Object.prototype.hasOwnProperty.call(result.monitor, 'createdLocal')).toBe(false)
        expect(Object.prototype.hasOwnProperty.call(result.monitor, 'modifiedLocal')).toBe(false)
      })

      it('throws EINVALID_TIMEZONE without calling Datadog when timezone is invalid', async () => {
        let hit = false
        server.use(
          http.get(endpoints.getMonitor(12345), () => {
            hit = true
            return jsonResponse(fixtures.single)
          })
        )

        await expect(getMonitor(api, '12345', defaultSite, 'Not/AZone')).rejects.toThrow(
          /EINVALID_TIMEZONE/
        )
        expect(hit).toBe(false)
      })
    })

    describe('listMonitors', () => {
      it('adds createdLocal and modifiedLocal on every monitor when timezone is provided', async () => {
        server.use(http.get(endpoints.listMonitors, () => jsonResponse(fixtures.list)))

        const result = await listMonitors(api, {}, defaultLimits, defaultSite, 'Europe/Paris')

        expect(result.monitors.length).toBeGreaterThan(0)
        for (const monitor of result.monitors) {
          expect(typeof monitor.createdLocal).toBe('string')
          expect(typeof monitor.modifiedLocal).toBe('string')
          expect(monitor.createdLocal).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/
          )
        }
      })

      it('does NOT add *Local fields on monitors when timezone is omitted', async () => {
        server.use(http.get(endpoints.listMonitors, () => jsonResponse(fixtures.list)))

        const result = await listMonitors(api, {}, defaultLimits, defaultSite)

        for (const monitor of result.monitors) {
          expect(Object.prototype.hasOwnProperty.call(monitor, 'createdLocal')).toBe(false)
          expect(Object.prototype.hasOwnProperty.call(monitor, 'modifiedLocal')).toBe(false)
        }
      })

      it('throws EINVALID_TIMEZONE without calling Datadog when timezone is invalid', async () => {
        let hit = false
        server.use(
          http.get(endpoints.listMonitors, () => {
            hit = true
            return jsonResponse(fixtures.list)
          })
        )

        await expect(
          listMonitors(api, {}, defaultLimits, defaultSite, 'Not/AZone')
        ).rejects.toThrow(/EINVALID_TIMEZONE/)
        expect(hit).toBe(false)
      })
    })

    describe('dispatcher — timezone plumbing', () => {
      type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>

      function captureHandler(readOnly: boolean): ToolHandler {
        let capturedHandler: ToolHandler | null = null
        const mockServer = {
          tool: vi.fn(
            (
              _name: string,
              _desc: string,
              _schema: unknown,
              handler: (input: Record<string, unknown>) => Promise<unknown>
            ) => {
              capturedHandler = handler
            }
          )
        } as unknown as Parameters<typeof registerMonitorsTool>[0]

        const eventsApi = {} as v2.EventsApi
        registerMonitorsTool(mockServer, api, eventsApi, defaultLimits, readOnly, defaultSite)

        if (!capturedHandler) {
          throw new Error('Tool handler was not captured during registration')
        }
        return capturedHandler
      }

      function unwrapJson<T>(result: unknown): T {
        const typed = result as { content: { type: string; text: string }[] }
        return JSON.parse(typed.content[0].text) as T
      }

      it('threads `timezone` through monitors.get and emits *Local fields', async () => {
        server.use(http.get(endpoints.getMonitor(12345), () => jsonResponse(fixtures.single)))

        const handler = captureHandler(false)
        const result = await handler({
          action: 'get',
          id: '12345',
          timezone: 'Europe/Paris'
        })

        const payload = unwrapJson<{ monitor: { createdLocal?: string; modifiedLocal?: string } }>(
          result
        )
        expect(payload.monitor.createdLocal).toBe('2024-01-15T11:00:00+01:00')
        expect(payload.monitor.modifiedLocal).toBe('2024-01-20T16:30:00+01:00')
      })

      it('threads `timezone` through monitors.list and emits *Local fields', async () => {
        server.use(http.get(endpoints.listMonitors, () => jsonResponse(fixtures.list)))

        const handler = captureHandler(false)
        const result = await handler({
          action: 'list',
          timezone: 'Europe/Paris'
        })

        const payload = unwrapJson<{
          monitors: Array<{ createdLocal?: string; modifiedLocal?: string }>
        }>(result)
        for (const m of payload.monitors) {
          expect(typeof m.createdLocal).toBe('string')
          expect(typeof m.modifiedLocal).toBe('string')
        }
      })
    })
  })

  // Requirement 6 — `test_notification` action.
  // OQ-1 closed during Task 8 research: the Datadog public REST API exposes no
  // `POST /api/v1/monitor/{id}/notify` (or `/test`) endpoint at v1 or v2. The
  // full list of monitor paths in the official OpenAPI specs is documented in
  // the JSDoc on `testNotificationMonitor` in src/tools/monitors.ts. Per
  // design.md "Open questions OQ-1" and Requirement 6 AC2, the action surfaces
  // an explicit `ENOT_SUPPORTED` error and performs no Datadog HTTP call.
  describe('monitors tool dispatcher — test_notification action (Requirement 6)', () => {
    type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>

    function captureHandler(readOnly: boolean): ToolHandler {
      let capturedHandler: ToolHandler | null = null
      const mockServer = {
        tool: vi.fn(
          (
            _name: string,
            _desc: string,
            _schema: unknown,
            handler: (input: Record<string, unknown>) => Promise<unknown>
          ) => {
            capturedHandler = handler
          }
        )
      } as unknown as Parameters<typeof registerMonitorsTool>[0]

      const eventsApi = {} as v2.EventsApi
      registerMonitorsTool(mockServer, api, eventsApi, defaultLimits, readOnly, defaultSite)

      if (!capturedHandler) {
        throw new Error('Tool handler was not captured during registration')
      }
      return capturedHandler
    }

    it('returns ENOT_SUPPORTED with a documentation pointer and never calls Datadog', async () => {
      // Install handlers on every monitor path; any hit fails the assertion.
      let anyHit = 0
      server.use(
        http.post(`${endpoints.getMonitor(12345)}/notify`, () => {
          anyHit++
          return jsonResponse({})
        }),
        http.post(`${endpoints.getMonitor(12345)}/test`, () => {
          anyHit++
          return jsonResponse({})
        }),
        http.get(endpoints.getMonitor(12345), () => {
          anyHit++
          return jsonResponse(fixtures.single)
        })
      )

      const handler = captureHandler(false)
      await expect(
        handler({
          action: 'test_notification',
          monitor_id: 12345
        })
      ).rejects.toThrow(/ENOT_SUPPORTED/)
      expect(anyHit).toBe(0)
    })

    it('error message cites the Datadog API docs URL so callers can verify the limitation', async () => {
      const handler = captureHandler(false)
      await expect(
        handler({
          action: 'test_notification',
          monitor_id: 12345
        })
      ).rejects.toThrow(/docs\.datadoghq\.com\/api\/latest\/monitors/)
    })

    it('requires a monitor_id (or `id`) — missing identifier returns ENOT_SUPPORTED, not a vague error', async () => {
      // Even without an id we must return ENOT_SUPPORTED rather than silently
      // succeed or throw a generic "invalid params" error. The capability is
      // unsupported regardless of inputs.
      const handler = captureHandler(false)
      await expect(
        handler({
          action: 'test_notification'
        })
      ).rejects.toThrow(/ENOT_SUPPORTED/)
    })

    it('accepts the existing stringly-typed `id` field as monitor identifier', async () => {
      let anyHit = 0
      server.use(
        http.post(`${endpoints.getMonitor(12345)}/notify`, () => {
          anyHit++
          return jsonResponse({})
        })
      )

      const handler = captureHandler(false)
      await expect(
        handler({
          action: 'test_notification',
          id: '12345'
        })
      ).rejects.toThrow(/ENOT_SUPPORTED/)
      expect(anyHit).toBe(0)
    })

    it('is allowed in read-only mode (test_notification is not a write action)', async () => {
      // Per Requirement 6 AC4: read-only must allow the action. The reason it
      // ends in ENOT_SUPPORTED is the API limitation, NOT a readOnly block.
      const handler = captureHandler(true)
      await expect(
        handler({
          action: 'test_notification',
          monitor_id: 12345
        })
      ).rejects.toThrow(/ENOT_SUPPORTED/)
      // Critically, the rejection must NOT mention "read-only" — that would
      // mean the dispatcher blocked it before reaching the action handler.
      await expect(
        handler({
          action: 'test_notification',
          monitor_id: 12345
        })
      ).rejects.not.toThrow(/read-only/)
    })
  })
})
