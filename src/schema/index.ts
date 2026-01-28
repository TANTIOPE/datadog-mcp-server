/**
 * Schema exports for Datadog API resources
 * These provide valid enum values for constructing API requests
 *
 * Values extracted from @datadog/datadog-api-client-typescript
 * Re-validate periodically against upstream when updating the client package
 */

import { dashboards } from './dashboards.js'
import { metrics } from './metrics.js'
import { monitors } from './monitors.js'
import { slos } from './slos.js'

export const schemas = { dashboards, metrics, monitors, slos } as const

export type SchemaResource = keyof typeof schemas
export const schemaResources = Object.keys(schemas) as SchemaResource[]
