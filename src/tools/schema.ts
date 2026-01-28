import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { toolResult } from '../utils/format.js'
import { schemas, schemaResources, type SchemaResource } from '../schema/index.js'

const ResourceSchema = z.enum(schemaResources as [SchemaResource, ...SchemaResource[]])

const InputSchema = {
  resource: ResourceSchema.describe(
    'Datadog resource type to get schema for: dashboards, metrics, monitors, slos'
  )
}

/**
 * Returns valid enum values for Datadog API fields.
 * Helps LLMs discover valid values for widget types, palettes, aggregators, etc.
 */
export function getSchema(resource: SchemaResource) {
  const schema = schemas[resource]
  return { resource, schema }
}

export function registerSchemaTool(server: McpServer): void {
  server.tool(
    'schema',
    'Get valid enum values for Datadog API fields. Returns palettes, widget types, aggregators, comparators, time spans, and other valid values for constructing dashboards, monitors, metrics queries, and SLOs. Use this to discover valid options before creating or updating Datadog resources.',
    InputSchema,
    async ({ resource }) => {
      const result = getSchema(resource)
      return toolResult(result)
    }
  )
}
