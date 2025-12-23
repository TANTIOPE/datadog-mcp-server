import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'create', 'update', 'delete'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.number().optional().describe('Notebook ID (required for get/update/delete actions)'),
  query: z.string().optional().describe('Search query for notebooks'),
  authorHandle: z.string().optional().describe('Filter by author handle (email)'),
  excludeAuthorHandle: z.string().optional().describe('Exclude notebooks by author handle'),
  includeCells: z
    .boolean()
    .optional()
    .describe('Include cell content in response (default: true for get)'),
  name: z.string().optional().describe('Notebook name (for create/update)'),
  cells: z
    .array(
      z.object({
        type: z.enum([
          'markdown',
          'timeseries',
          'toplist',
          'heatmap',
          'distribution',
          'log_stream'
        ]),
        content: z.unknown()
      })
    )
    .optional()
    .describe('Notebook cells (for create/update)'),
  time: z
    .object({
      liveSpan: z.string().optional(),
      start: z.number().optional(),
      end: z.number().optional()
    })
    .optional()
    .describe('Time configuration for notebook'),
  status: z.enum(['published']).optional().describe('Notebook status'),
  pageSize: z.number().min(1).optional().describe('Number of notebooks to return'),
  pageNumber: z.number().optional().describe('Page number for pagination')
}

interface NotebookSummary {
  id: number
  name: string
  author: {
    handle: string | null
    name: string | null
  }
  status: string
  cellCount: number
  created: string
  modified: string
  metadata: {
    isTemplate: boolean | null
    takeSnapshots: boolean | null
  }
}

interface NotebookDetail extends NotebookSummary {
  cells: Array<{
    id: string
    type: string
    attributes: unknown
  }>
  time: {
    liveSpan: string | null
  }
}

export function formatNotebookSummary(nb: v1.NotebooksResponseData): NotebookSummary {
  const attrs = nb.attributes ?? {}

  return {
    id: nb.id ?? 0,
    name: attrs.name ?? '',
    author: {
      handle: attrs.author?.handle ?? null,
      name: attrs.author?.name ?? null
    },
    status: String(attrs.status ?? ''),
    cellCount: attrs.cells?.length ?? 0,
    created: attrs.created?.toISOString() ?? '',
    modified: attrs.modified?.toISOString() ?? '',
    metadata: {
      isTemplate: attrs.metadata?.isTemplate ?? null,
      takeSnapshots: attrs.metadata?.takeSnapshots ?? null
    }
  }
}

export function formatNotebookDetail(nb: v1.NotebookResponseData): NotebookDetail {
  const attrs = nb.attributes ?? {}

  return {
    id: nb.id ?? 0,
    name: attrs.name ?? '',
    author: {
      handle: attrs.author?.handle ?? null,
      name: attrs.author?.name ?? null
    },
    status: String(attrs.status ?? ''),
    cellCount: attrs.cells?.length ?? 0,
    created: attrs.created?.toISOString() ?? '',
    modified: attrs.modified?.toISOString() ?? '',
    metadata: {
      isTemplate: attrs.metadata?.isTemplate ?? null,
      takeSnapshots: attrs.metadata?.takeSnapshots ?? null
    },
    cells: (attrs.cells ?? []).map((cell) => ({
      id: String(cell.id ?? ''),
      type: String(cell.type ?? ''),
      attributes: cell.attributes ?? {}
    })),
    time: {
      liveSpan: attrs.time
        ? String((attrs.time as unknown as Record<string, unknown>)['liveSpan'] ?? '')
        : null
    }
  }
}

export async function listNotebooks(
  api: v1.NotebooksApi,
  params: {
    query?: string
    authorHandle?: string
    excludeAuthorHandle?: string
    includeCells?: boolean
    pageSize?: number
    pageNumber?: number
  },
  limits: LimitsConfig
) {
  const response = await api.listNotebooks({
    query: params.query,
    authorHandle: params.authorHandle,
    excludeAuthorHandle: params.excludeAuthorHandle,
    includeCells: params.includeCells ?? false,
    count: params.pageSize ?? limits.defaultLimit,
    start: (params.pageNumber ?? 0) * (params.pageSize ?? limits.defaultLimit)
  })

  const notebooks = (response.data ?? []).map(formatNotebookSummary)

  return {
    notebooks,
    meta: {
      totalCount: response.meta?.page?.totalCount ?? notebooks.length,
      totalFilteredCount: response.meta?.page?.totalFilteredCount ?? notebooks.length
    }
  }
}

export async function getNotebook(api: v1.NotebooksApi, notebookId: number) {
  const response = await api.getNotebook({ notebookId })

  if (!response.data) {
    throw new Error(`Notebook ${notebookId} not found`)
  }

  return {
    notebook: formatNotebookDetail(response.data)
  }
}

export async function createNotebook(
  api: v1.NotebooksApi,
  params: {
    name: string
    cells?: Array<{ type: string; content: unknown }>
    time?: { liveSpan?: string; start?: number; end?: number }
    status?: string
  }
) {
  // Build cells for the notebook
  const cells: v1.NotebookCellCreateRequest[] = (params.cells ?? []).map((cell) => {
    // Default to markdown cell if no specific type handling
    if (cell.type === 'markdown') {
      return {
        type: 'notebook_cells' as const,
        attributes: {
          definition: {
            type: 'markdown' as const,
            text: String(cell.content ?? '')
          }
        } as v1.NotebookCellCreateRequestAttributes
      }
    }
    // For other cell types, pass through the content as definition
    return {
      type: 'notebook_cells' as const,
      attributes: {
        definition: cell.content
      } as v1.NotebookCellCreateRequestAttributes
    }
  })

  // If no cells provided, create a default markdown cell
  if (cells.length === 0) {
    cells.push({
      type: 'notebook_cells' as const,
      attributes: {
        definition: {
          type: 'markdown' as const,
          text: '# New Notebook\n\nStart adding content here.'
        }
      } as v1.NotebookCellCreateRequestAttributes
    })
  }

  // Build time configuration - use type assertion for union type
  const timeConfig = (
    params.time?.liveSpan
      ? { liveSpan: params.time.liveSpan as v1.NotebookRelativeTime['liveSpan'] }
      : { liveSpan: '1h' as v1.NotebookRelativeTime['liveSpan'] }
  ) as v1.NotebookGlobalTime

  const response = await api.createNotebook({
    body: {
      data: {
        type: 'notebooks',
        attributes: {
          name: params.name,
          cells,
          time: timeConfig,
          status: (params.status as v1.NotebookStatus) ?? 'published'
        }
      }
    }
  })

  if (!response.data) {
    throw new Error('Failed to create notebook')
  }

  return {
    success: true,
    notebook: formatNotebookDetail(response.data),
    message: `Notebook "${params.name}" created successfully`
  }
}

export async function updateNotebook(
  api: v1.NotebooksApi,
  notebookId: number,
  params: {
    name?: string
    cells?: Array<{ type: string; content: unknown }>
    time?: { liveSpan?: string; start?: number; end?: number }
    status?: string
  }
) {
  // First get the existing notebook to preserve fields
  const existing = await api.getNotebook({ notebookId })
  if (!existing.data) {
    throw new Error(`Notebook ${notebookId} not found`)
  }

  const existingAttrs = existing.data.attributes ?? {}

  // Build cells if provided
  let cells: v1.NotebookUpdateCell[] | undefined
  if (params.cells) {
    cells = params.cells.map((cell) => {
      if (cell.type === 'markdown') {
        return {
          type: 'notebook_cells' as const,
          attributes: {
            definition: {
              type: 'markdown' as const,
              text: String(cell.content ?? '')
            }
          } as v1.NotebookCellUpdateRequestAttributes
        }
      }
      return {
        type: 'notebook_cells' as const,
        attributes: {
          definition: cell.content
        } as v1.NotebookCellUpdateRequestAttributes
      }
    })
  }

  // Build time configuration - use type assertion for union type
  const timeConfig: v1.NotebookGlobalTime | undefined = params.time?.liveSpan
    ? ({
        liveSpan: params.time.liveSpan as v1.NotebookRelativeTime['liveSpan']
      } as v1.NotebookGlobalTime)
    : undefined

  const response = await api.updateNotebook({
    notebookId,
    body: {
      data: {
        type: 'notebooks',
        attributes: {
          name: params.name ?? existingAttrs.name ?? '',
          cells:
            cells ??
            existingAttrs.cells?.map((c) => ({
              id: c.id,
              type: 'notebook_cells' as const,
              attributes: c.attributes as v1.NotebookCellUpdateRequestAttributes
            })) ??
            [],
          time: timeConfig ?? existingAttrs.time ?? { liveSpan: '1h' as const },
          status: (params.status ?? existingAttrs.status) as v1.NotebookStatus
        }
      }
    }
  })

  if (!response.data) {
    throw new Error('Failed to update notebook')
  }

  return {
    success: true,
    notebook: formatNotebookDetail(response.data),
    message: `Notebook ${notebookId} updated successfully`
  }
}

export async function deleteNotebook(api: v1.NotebooksApi, notebookId: number) {
  await api.deleteNotebook({ notebookId })

  return {
    success: true,
    message: `Notebook ${notebookId} deleted successfully`
  }
}

export function registerNotebooksTool(
  server: McpServer,
  api: v1.NotebooksApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  _site: string = 'datadoghq.com'
): void {
  server.tool(
    'notebooks',
    'Manage Datadog Notebooks. Actions: list (search notebooks), get (by ID with cells), create (new notebook), update (modify notebook), delete (remove notebook). Use for: runbooks, incident documentation, investigation notes, dashboards as code.',
    InputSchema,
    async ({
      action,
      id,
      query,
      authorHandle,
      excludeAuthorHandle,
      includeCells,
      name,
      cells,
      time,
      status,
      pageSize,
      pageNumber
    }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(
              await listNotebooks(
                api,
                { query, authorHandle, excludeAuthorHandle, includeCells, pageSize, pageNumber },
                limits
              )
            )

          case 'get': {
            const notebookId = requireParam(id, 'id', 'get')
            return toolResult(await getNotebook(api, notebookId))
          }

          case 'create': {
            const notebookName = requireParam(name, 'name', 'create')
            return toolResult(
              await createNotebook(api, {
                name: notebookName,
                cells: cells as Array<{ type: string; content: unknown }>,
                time,
                status
              })
            )
          }

          case 'update': {
            const notebookId = requireParam(id, 'id', 'update')
            return toolResult(
              await updateNotebook(api, notebookId, {
                name,
                cells: cells as Array<{ type: string; content: unknown }>,
                time,
                status
              })
            )
          }

          case 'delete': {
            const notebookId = requireParam(id, 'id', 'delete')
            return toolResult(await deleteNotebook(api, notebookId))
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
