import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'totals', 'mute', 'unmute'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  filter: z.string().optional().describe('Filter hosts by name, alias, or tag (e.g., "env:prod")'),
  from: z.number().optional().describe('Starting offset for pagination'),
  count: z.number().optional().describe('Number of hosts to return'),
  sortField: z.string().optional().describe('Field to sort by (e.g., "apps", "cpu", "name")'),
  sortDir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
  hostName: z.string().optional().describe('Host name (required for mute/unmute)'),
  message: z.string().optional().describe('Mute reason message'),
  end: z.number().optional().describe('Mute end timestamp (POSIX). Omit for indefinite mute'),
  override: z.boolean().optional().describe('If true, replaces existing mute instead of failing')
}

interface HostSummary {
  hostName: string
  aliases: string[]
  apps: string[]
  sources: string[]
  up: boolean
  isMuted: boolean
  muteTimeout: number | null
  lastReportedTime: string
  meta: {
    cpuCores: number | null
    platform: string | null
    gohai: string | null
  }
}

function formatHost(h: v1.Host): HostSummary {
  return {
    hostName: h.hostName ?? '',
    aliases: h.aliases ?? [],
    apps: h.apps ?? [],
    sources: h.sources ?? [],
    up: h.up ?? false,
    isMuted: h.isMuted ?? false,
    muteTimeout: h.muteTimeout ?? null,
    lastReportedTime: h.lastReportedTime ? new Date(h.lastReportedTime * 1000).toISOString() : '',
    meta: {
      cpuCores: h.meta?.cpuCores ?? null,
      platform: h.meta?.platform ?? null,
      gohai: h.meta?.gohai ?? null
    }
  }
}

async function listHosts(
  api: v1.HostsApi,
  params: {
    filter?: string
    from?: number
    count?: number
    sortField?: string
    sortDir?: 'asc' | 'desc'
  },
  limits: LimitsConfig
) {
  const response = await api.listHosts({
    filter: params.filter,
    from: params.from,
    count: Math.min(params.count ?? limits.maxResults, limits.maxResults),
    sortField: params.sortField,
    sortDir: params.sortDir
  })

  const hosts = (response.hostList ?? []).map(formatHost)

  return {
    hosts,
    totalReturned: response.totalReturned ?? hosts.length,
    totalMatching: response.totalMatching ?? hosts.length
  }
}

async function getHostTotals(api: v1.HostsApi) {
  const response = await api.getHostTotals({})
  return {
    totals: {
      totalUp: response.totalUp ?? 0,
      totalActive: response.totalActive ?? 0
    }
  }
}

async function muteHost(
  api: v1.HostsApi,
  hostName: string,
  params: { message?: string; end?: number; override?: boolean }
) {
  await api.muteHost({
    hostName,
    body: {
      message: params.message,
      end: params.end,
      override: params.override
    }
  })
  const muteEndMessage = params.end
    ? ` until ${new Date(params.end * 1000).toISOString()}`
    : ' indefinitely'
  return {
    success: true,
    message: `Host ${hostName} muted${muteEndMessage}`
  }
}

async function unmuteHost(api: v1.HostsApi, hostName: string) {
  await api.unmuteHost({ hostName })
  return {
    success: true,
    message: `Host ${hostName} unmuted`
  }
}

export function registerHostsTool(
  server: McpServer,
  api: v1.HostsApi,
  limits: LimitsConfig,
  readOnly: boolean = false
): void {
  server.tool(
    'hosts',
    'Manage Datadog infrastructure hosts. Actions: list (with filters), totals (counts), mute (silence alerts), unmute. Use for: infrastructure inventory, host health, silencing noisy hosts during maintenance.',
    InputSchema,
    async ({
      action,
      filter,
      from,
      count,
      sortField,
      sortDir,
      hostName,
      message,
      end,
      override
    }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(
              await listHosts(api, { filter, from, count, sortField, sortDir }, limits)
            )

          case 'totals':
            return toolResult(await getHostTotals(api))

          case 'mute': {
            const host = requireParam(hostName, 'hostName', 'mute')
            return toolResult(await muteHost(api, host, { message, end, override }))
          }

          case 'unmute': {
            const host = requireParam(hostName, 'hostName', 'unmute')
            return toolResult(await unmuteHost(api, host))
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
