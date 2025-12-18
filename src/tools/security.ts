import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v2 } from '@datadog/datadog-api-client'
import { handleDatadogError } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { parseTime } from '../utils/time.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['rules', 'signals', 'findings'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Rule or signal ID (for specific lookups)'),
  query: z.string().optional().describe('Search query for signals or findings'),
  from: z.string().optional().describe('Start time (ISO 8601, relative like "1h", "7d")'),
  to: z.string().optional().describe('End time (ISO 8601, relative like "now")'),
  severity: z
    .enum(['info', 'low', 'medium', 'high', 'critical'])
    .optional()
    .describe('Filter by severity'),
  status: z
    .enum(['open', 'under_review', 'archived'])
    .optional()
    .describe('Filter signals by status'),
  pageSize: z.number().optional().describe('Number of results to return'),
  pageCursor: z.string().optional().describe('Cursor for pagination')
}

interface SecurityRuleSummary {
  id: string
  name: string
  type: string
  isEnabled: boolean
  hasExtendedTitle: boolean
  message: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
  creationAuthorId: number | null
  isDefault: boolean
  isDeleted: boolean
  filters: Array<{
    action: string
    query: string
  }>
}

interface SecuritySignalSummary {
  id: string
  type: string
  timestamp: string
  attributes: {
    message: string | null
    status: string | null
    severity: string | null
    tags: string[]
    custom: Record<string, unknown>
  }
}

export function formatRule(rule: v2.SecurityMonitoringRuleResponse): SecurityRuleSummary {
  // Handle union type - SecurityMonitoringRuleResponse can be various rule types
  const ruleData = rule as Record<string, unknown>

  return {
    id: (ruleData['id'] as string) ?? '',
    name: (ruleData['name'] as string) ?? '',
    type: (ruleData['type'] as string) ?? '',
    isEnabled: (ruleData['isEnabled'] as boolean) ?? false,
    hasExtendedTitle: (ruleData['hasExtendedTitle'] as boolean) ?? false,
    message: (ruleData['message'] as string) ?? null,
    tags: (ruleData['tags'] as string[]) ?? [],
    createdAt: ruleData['createdAt'] ? new Date(ruleData['createdAt'] as number).toISOString() : '',
    updatedAt: ruleData['updatedAt'] ? new Date(ruleData['updatedAt'] as number).toISOString() : '',
    creationAuthorId: (ruleData['creationAuthorId'] as number) ?? null,
    isDefault: (ruleData['isDefault'] as boolean) ?? false,
    isDeleted: (ruleData['isDeleted'] as boolean) ?? false,
    filters: ((ruleData['filters'] as Array<{ action: string; query: string }>) ?? []).map((f) => ({
      action: f.action ?? '',
      query: f.query ?? ''
    }))
  }
}

export function formatSignal(signal: v2.SecurityMonitoringSignal): SecuritySignalSummary {
  const attrs = signal.attributes ?? {}
  // Custom attributes are in the additionalProperties
  const customAttrs = attrs as Record<string, unknown>

  return {
    id: signal.id ?? '',
    type: String(signal.type ?? ''),
    timestamp: attrs.timestamp?.toISOString() ?? '',
    attributes: {
      message: attrs.message ?? null,
      status: (customAttrs['status'] as string) ?? null,
      severity: (customAttrs['severity'] as string) ?? null,
      tags: attrs.tags ?? [],
      custom: attrs.custom ?? {}
    }
  }
}

export async function listRules(
  api: v2.SecurityMonitoringApi,
  params: {
    pageSize?: number
    pageCursor?: string
  },
  limits: LimitsConfig
) {
  const response = await api.listSecurityMonitoringRules({
    pageSize: Math.min(params.pageSize ?? limits.maxResults, limits.maxResults),
    pageNumber: 0
  })

  const rules = (response.data ?? []).map(formatRule)

  return {
    rules,
    meta: {
      totalCount: rules.length
    }
  }
}

export async function getRule(api: v2.SecurityMonitoringApi, ruleId: string) {
  const response = await api.getSecurityMonitoringRule({ ruleId })

  return {
    rule: formatRule(response)
  }
}

export async function searchSignals(
  api: v2.SecurityMonitoringApi,
  params: {
    query?: string
    from?: string
    to?: string
    severity?: string
    status?: string
    pageSize?: number
    pageCursor?: string
  },
  limits: LimitsConfig
) {
  // Parse time range
  const nowMs = Date.now()
  const defaultFromMs = nowMs - 24 * 60 * 60 * 1000 // Default 24 hours
  const fromTime = parseTime(params.from, Math.floor(defaultFromMs / 1000))
  const toTime = parseTime(params.to, Math.floor(nowMs / 1000))

  // Build query with filters
  let queryString = params.query ?? '*'
  if (params.severity) {
    queryString = `severity:${params.severity} ${queryString}`.trim()
  }
  if (params.status) {
    queryString = `status:${params.status} ${queryString}`.trim()
  }

  const response = await api.searchSecurityMonitoringSignals({
    body: {
      filter: {
        query: queryString,
        from: new Date(fromTime * 1000),
        to: new Date(toTime * 1000)
      },
      page: {
        limit: Math.min(params.pageSize ?? limits.maxResults, limits.maxResults),
        cursor: params.pageCursor
      },
      sort: 'timestamp' as v2.SecurityMonitoringSignalsSort
    }
  })

  const signals = (response.data ?? []).map(formatSignal)

  return {
    signals,
    meta: {
      nextCursor: response.meta?.page?.after ?? null,
      totalCount: signals.length,
      timeRange: {
        from: new Date(fromTime * 1000).toISOString(),
        to: new Date(toTime * 1000).toISOString()
      }
    }
  }
}

export async function listFindings(
  api: v2.SecurityMonitoringApi,
  params: {
    query?: string
    pageSize?: number
    pageCursor?: string
  },
  limits: LimitsConfig
) {
  // Note: Findings API may require specific permissions
  // Using the signals search as a fallback for security findings
  const response = await api.searchSecurityMonitoringSignals({
    body: {
      filter: {
        query:
          params.query ??
          '@workflow.rule.type:workload_security OR @workflow.rule.type:cloud_configuration',
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        to: new Date()
      },
      page: {
        limit: Math.min(params.pageSize ?? limits.maxResults, limits.maxResults),
        cursor: params.pageCursor
      }
    }
  })

  const findings = (response.data ?? []).map(formatSignal)

  return {
    findings,
    meta: {
      nextCursor: response.meta?.page?.after ?? null,
      totalCount: findings.length
    }
  }
}

export function registerSecurityTool(
  server: McpServer,
  api: v2.SecurityMonitoringApi,
  limits: LimitsConfig
): void {
  server.tool(
    'security',
    'Query Datadog Security Monitoring. Actions: rules (list detection rules), signals (search security signals), findings (list security findings). Use for: threat detection, compliance, security posture, incident investigation.',
    InputSchema,
    async ({ action, id, query, from, to, severity, status, pageSize, pageCursor }) => {
      try {
        switch (action) {
          case 'rules':
            if (id) {
              return toolResult(await getRule(api, id))
            }
            return toolResult(await listRules(api, { pageSize, pageCursor }, limits))

          case 'signals':
            return toolResult(
              await searchSignals(
                api,
                { query, from, to, severity, status, pageSize, pageCursor },
                limits
              )
            )

          case 'findings':
            return toolResult(await listFindings(api, { query, pageSize, pageCursor }, limits))

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
