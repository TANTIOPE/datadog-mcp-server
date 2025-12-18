import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'add', 'update', 'delete'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  hostName: z
    .string()
    .optional()
    .describe('Host name (required for get/add/update/delete actions)'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Tags to add or set (for add/update actions). Format: "key:value"'),
  source: z
    .string()
    .optional()
    .describe('Source of the tags (e.g., "users", "datadog"). Defaults to "users"')
}

interface HostTagsSummary {
  hostName: string
  tags: string[]
  source: string | null
}

interface AllTagsSummary {
  hosts: { [key: string]: string[] }
  totalHosts: number
}

export async function listAllTags(api: v1.TagsApi, source?: string): Promise<AllTagsSummary> {
  const response = await api.listHostTags({
    source
  })

  const tags = response.tags ?? {}

  return {
    hosts: tags,
    totalHosts: Object.keys(tags).length
  }
}

export async function getHostTags(
  api: v1.TagsApi,
  hostName: string,
  source?: string
): Promise<HostTagsSummary> {
  const response = await api.getHostTags({
    hostName,
    source
  })

  return {
    hostName,
    tags: response.tags ?? [],
    source: source ?? null
  }
}

export async function addHostTags(api: v1.TagsApi, hostName: string, tags: string[], source?: string) {
  const response = await api.createHostTags({
    hostName,
    body: {
      host: hostName,
      tags
    },
    source
  })

  return {
    success: true,
    hostName,
    tags: response.tags ?? tags,
    message: `Tags added to host ${hostName}`
  }
}

export async function updateHostTags(api: v1.TagsApi, hostName: string, tags: string[], source?: string) {
  const response = await api.updateHostTags({
    hostName,
    body: {
      host: hostName,
      tags
    },
    source
  })

  return {
    success: true,
    hostName,
    tags: response.tags ?? tags,
    message: `Tags updated for host ${hostName}`
  }
}

export async function deleteHostTags(api: v1.TagsApi, hostName: string, source?: string) {
  await api.deleteHostTags({
    hostName,
    source
  })

  return {
    success: true,
    hostName,
    message: `Tags deleted from host ${hostName}`
  }
}

export function registerTagsTool(
  server: McpServer,
  api: v1.TagsApi,
  _limits: LimitsConfig,
  readOnly: boolean = false
): void {
  server.tool(
    'tags',
    'Manage Datadog host tags. Actions: list (all host tags), get (tags for specific host), add (create tags), update (replace tags), delete (remove all tags). Use for: infrastructure organization, filtering, grouping.',
    InputSchema,
    async ({ action, hostName, tags, source }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(await listAllTags(api, source))

          case 'get': {
            const host = requireParam(hostName, 'hostName', 'get')
            return toolResult(await getHostTags(api, host, source))
          }

          case 'add': {
            const host = requireParam(hostName, 'hostName', 'add')
            const tagList = requireParam(tags, 'tags', 'add')
            return toolResult(await addHostTags(api, host, tagList, source))
          }

          case 'update': {
            const host = requireParam(hostName, 'hostName', 'update')
            const tagList = requireParam(tags, 'tags', 'update')
            return toolResult(await updateHostTags(api, host, tagList, source))
          }

          case 'delete': {
            const host = requireParam(hostName, 'hostName', 'delete')
            return toolResult(await deleteHostTags(api, host, source))
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
