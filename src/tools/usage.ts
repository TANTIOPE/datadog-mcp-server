import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { parseTime } from '../utils/time.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['summary', 'hosts', 'logs', 'custom_metrics', 'indexed_spans', 'ingested_spans'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform: summary (overall usage), hosts, logs, custom_metrics, indexed_spans, ingested_spans'),
  from: z.string().optional().describe('Start time (ISO 8601 date like "2024-01-01", or relative like "30d")'),
  to: z.string().optional().describe('End time (ISO 8601 date like "2024-01-31", or relative like "now")'),
  includeOrgDetails: z.boolean().optional().describe('Include usage breakdown by organization (for multi-org accounts)')
}

interface UsageSummary {
  startDate: string
  endDate: string
  aggsTotal: Record<string, number | null>
  usage: Array<{
    date: string
    orgName: string | null
    apmHostTop99pSum: number | null
    infraHostTop99pSum: number | null
    logsIndexedLogsUsageSum: number | null
    ingestedEventsBytesSum: number | null
    customMetricsAvgPerHour: number | null
  }>
}

interface HostUsage {
  startDate: string
  endDate: string
  usage: Array<{
    date: string
    agentHostTop99p: number | null
    awsHostTop99p: number | null
    azureHostTop99p: number | null
    gcpHostTop99p: number | null
    infraHostTop99p: number | null
    containerTop99p: number | null
  }>
}

interface LogsUsage {
  startDate: string
  endDate: string
  usage: Array<{
    date: string
    logsIndexedLogsUsageSum: number | null
    logsLiveIndexedLogsUsageSum: number | null
    logsRehydratedIndexedLogsUsageSum: number | null
  }>
}

interface CustomMetricsUsage {
  startDate: string
  endDate: string
  usage: Array<{
    date: string
    avgMetricsCount: number | null
    maxMetricsCount: number | null
  }>
}

interface SpansUsage {
  startDate: string
  endDate: string
  usage: Array<{
    date: string
    indexedSpansCount: number | null
    ingestedSpansBytes: number | null
  }>
}

function parseDate(dateStr: string | undefined, defaultDate: Date): Date {
  if (!dateStr) return defaultDate

  // Check if it's a relative date
  if (dateStr.match(/^\d+[hdwmy]$/)) {
    const seconds = parseTime(dateStr, Math.floor(Date.now() / 1000))
    return new Date(seconds * 1000)
  }

  // Try ISO date parsing
  const parsed = new Date(dateStr)
  if (!isNaN(parsed.getTime())) {
    return parsed
  }

  return defaultDate
}

async function getUsageSummary(
  api: v1.UsageMeteringApi,
  params: {
    from?: string
    to?: string
    includeOrgDetails?: boolean
  }
): Promise<UsageSummary> {
  const endDate = parseDate(params.to, new Date())
  const startDate = parseDate(params.from, new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000))

  const response = await api.getUsageSummary({
    startMonth: startDate,
    endMonth: endDate,
    includeOrgDetails: params.includeOrgDetails
  })

  return {
    startDate: response.startDate?.toISOString() ?? startDate.toISOString(),
    endDate: response.endDate?.toISOString() ?? endDate.toISOString(),
    aggsTotal: {
      apmHostTop99p: response.apmHostTop99PSum ?? null,
      infraHostTop99p: response.infraHostTop99PSum ?? null
    },
    usage: (response.usage ?? []).map(u => ({
      date: u.date?.toISOString() ?? '',
      orgName: (u as Record<string, unknown>)['orgName'] as string ?? null,
      apmHostTop99pSum: u.apmHostTop99P ?? null,
      infraHostTop99pSum: u.infraHostTop99P ?? null,
      logsIndexedLogsUsageSum: u.indexedEventsCountSum ?? null,
      ingestedEventsBytesSum: u.ingestedEventsBytesSum ?? null,
      customMetricsAvgPerHour: null // Not in summary
    }))
  }
}

async function getHostsUsage(
  api: v1.UsageMeteringApi,
  params: {
    from?: string
    to?: string
  }
): Promise<HostUsage> {
  const endDate = parseDate(params.to, new Date())
  const startDate = parseDate(params.from, new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000))

  const response = await api.getUsageHosts({
    startHr: startDate,
    endHr: endDate
  })

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    usage: (response.usage ?? []).map(u => ({
      date: u.hour?.toISOString() ?? '',
      agentHostTop99p: u.agentHostCount ?? null,
      awsHostTop99p: u.awsHostCount ?? null,
      azureHostTop99p: u.azureHostCount ?? null,
      gcpHostTop99p: u.gcpHostCount ?? null,
      infraHostTop99p: u.hostCount ?? null,
      containerTop99p: u.containerCount ?? null
    }))
  }
}

async function getLogsUsage(
  api: v1.UsageMeteringApi,
  params: {
    from?: string
    to?: string
  }
): Promise<LogsUsage> {
  const endDate = parseDate(params.to, new Date())
  const startDate = parseDate(params.from, new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000))

  const response = await api.getUsageLogs({
    startHr: startDate,
    endHr: endDate
  })

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    usage: (response.usage ?? []).map(u => ({
      date: u.hour?.toISOString() ?? '',
      logsIndexedLogsUsageSum: u.indexedEventsCount ?? null,
      logsLiveIndexedLogsUsageSum: u.indexedEventsCount ?? null,
      logsRehydratedIndexedLogsUsageSum: (u as Record<string, unknown>)['logsRehydratedIndexedCount'] as number ?? null
    }))
  }
}

async function getCustomMetricsUsage(
  api: v1.UsageMeteringApi,
  params: {
    from?: string
    to?: string
  }
): Promise<CustomMetricsUsage> {
  const endDate = parseDate(params.to, new Date())
  const startDate = parseDate(params.from, new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000))

  const response = await api.getUsageTimeseries({
    startHr: startDate,
    endHr: endDate
  })

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    usage: (response.usage ?? []).map(u => ({
      date: u.hour?.toISOString() ?? '',
      avgMetricsCount: u.numCustomTimeseries ?? null,
      maxMetricsCount: null // Not directly available
    }))
  }
}

async function getIndexedSpansUsage(
  api: v1.UsageMeteringApi,
  params: {
    from?: string
    to?: string
  }
): Promise<SpansUsage> {
  const endDate = parseDate(params.to, new Date())
  const startDate = parseDate(params.from, new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000))

  const response = await api.getUsageIndexedSpans({
    startHr: startDate,
    endHr: endDate
  })

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    usage: (response.usage ?? []).map(u => ({
      date: u.hour?.toISOString() ?? '',
      indexedSpansCount: u.indexedEventsCount ?? null,
      ingestedSpansBytes: null
    }))
  }
}

async function getIngestedSpansUsage(
  api: v1.UsageMeteringApi,
  params: {
    from?: string
    to?: string
  }
): Promise<SpansUsage> {
  const endDate = parseDate(params.to, new Date())
  const startDate = parseDate(params.from, new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000))

  const response = await api.getIngestedSpans({
    startHr: startDate,
    endHr: endDate
  })

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    usage: (response.usage ?? []).map(u => ({
      date: u.hour?.toISOString() ?? '',
      indexedSpansCount: null,
      ingestedSpansBytes: (u as Record<string, unknown>)['ingestedTracesBytes'] as number ?? null
    }))
  }
}

export function registerUsageTool(
  server: McpServer,
  api: v1.UsageMeteringApi,
  _limits: LimitsConfig
): void {
  server.tool(
    'usage',
    'Query Datadog usage metering data. Actions: summary (overall usage), hosts (infrastructure), logs, custom_metrics, indexed_spans, ingested_spans. Use for: cost management, capacity planning, usage tracking, billing analysis.',
    InputSchema,
    async ({ action, from, to, includeOrgDetails }) => {
      try {
        switch (action) {
          case 'summary':
            return toolResult(await getUsageSummary(api, { from, to, includeOrgDetails }))

          case 'hosts':
            return toolResult(await getHostsUsage(api, { from, to }))

          case 'logs':
            return toolResult(await getLogsUsage(api, { from, to }))

          case 'custom_metrics':
            return toolResult(await getCustomMetricsUsage(api, { from, to }))

          case 'indexed_spans':
            return toolResult(await getIndexedSpansUsage(api, { from, to }))

          case 'ingested_spans':
            return toolResult(await getIngestedSpansUsage(api, { from, to }))

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
