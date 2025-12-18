import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('User ID (required for get action)'),
  filter: z.string().optional().describe('Filter users by name or email'),
  status: z.enum(['Active', 'Pending', 'Disabled']).optional().describe('Filter by user status'),
  pageSize: z.number().optional().describe('Number of users to return per page'),
  pageNumber: z.number().optional().describe('Page number for pagination')
}

interface UserSummary {
  id: string
  email: string
  name: string
  status: string
  title: string | null
  verified: boolean
  disabled: boolean
  createdAt: string
  modifiedAt: string
  relationships: {
    roles: string[]
    org: string | null
  }
}

function formatUser(user: v2.User): UserSummary {
  const attrs = user.attributes ?? {}
  const relationships = user.relationships ?? {}

  // Extract role names from relationships
  const roles = (relationships.roles?.data ?? []).map((r) => r.id ?? '')
  const orgId = relationships.org?.data?.id ?? null

  return {
    id: user.id ?? '',
    email: attrs.email ?? '',
    name: attrs.name ?? '',
    status: attrs.status ?? '',
    title: attrs.title ?? null,
    verified: attrs.verified ?? false,
    disabled: attrs.disabled ?? false,
    createdAt: attrs.createdAt?.toISOString() ?? '',
    modifiedAt: attrs.modifiedAt?.toISOString() ?? '',
    relationships: {
      roles,
      org: orgId
    }
  }
}

async function listUsers(
  api: v2.UsersApi,
  params: {
    filter?: string
    status?: string
    pageSize?: number
    pageNumber?: number
  },
  limits: LimitsConfig
) {
  const response = await api.listUsers({
    filter: params.filter,
    filterStatus: params.status,
    pageSize: Math.min(params.pageSize ?? limits.maxResults, limits.maxResults),
    pageNumber: params.pageNumber ?? 0
  })

  const users = (response.data ?? []).map(formatUser)

  return {
    users,
    meta: {
      page: response.meta?.page ?? {},
      totalCount: users.length
    }
  }
}

async function getUser(api: v2.UsersApi, userId: string) {
  const response = await api.getUser({ userId })

  if (!response.data) {
    throw new Error(`User ${userId} not found`)
  }

  return {
    user: formatUser(response.data)
  }
}

export function registerUsersTool(server: McpServer, api: v2.UsersApi, limits: LimitsConfig): void {
  server.tool(
    'users',
    'Manage Datadog users. Actions: list (with filters), get (by ID). Use for: access management, user auditing, team organization.',
    InputSchema,
    async ({ action, id, filter, status, pageSize, pageNumber }) => {
      try {
        switch (action) {
          case 'list':
            return toolResult(
              await listUsers(api, { filter, status, pageSize, pageNumber }, limits)
            )

          case 'get': {
            const userId = requireParam(id, 'id', 'get')
            return toolResult(await getUser(api, userId))
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
