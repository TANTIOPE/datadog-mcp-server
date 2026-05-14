/**
 * Unit tests for the monitors tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { monitors as fixtures } from '../helpers/fixtures.js'
import {
  listMonitors,
  getMonitor,
  searchMonitors,
  createMonitor,
  updateMonitor,
  deleteMonitor
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
        http.post(endpoints.createMonitor, () => {
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
})
