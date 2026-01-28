/**
 * Schema exports for Datadog API resources
 * These provide valid enum values for constructing API requests
 */

export { dashboards, type DashboardsSchema } from './dashboards.js'
export { metrics, type MetricsSchema } from './metrics.js'
export { monitors, type MonitorsSchema } from './monitors.js'
export { slos, type SLOsSchema } from './slos.js'

// Combined schema for the schema tool
export const schemas = {
  dashboards: () => import('./dashboards.js').then((m) => m.dashboards),
  metrics: () => import('./metrics.js').then((m) => m.metrics),
  monitors: () => import('./monitors.js').then((m) => m.monitors),
  slos: () => import('./slos.js').then((m) => m.slos)
} as const

export type SchemaResource = keyof typeof schemas
export const schemaResources = Object.keys(schemas) as SchemaResource[]
