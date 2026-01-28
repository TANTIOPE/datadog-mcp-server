/**
 * Metrics schema definitions
 * Source: https://github.com/DataDog/datadog-api-client-typescript
 * Last updated: 2026-01
 */

export const metrics = {
  aggregators: ['avg', 'max', 'min', 'sum', 'count'],

  rollupMethods: ['avg', 'max', 'min', 'sum', 'count'],

  metricTypes: ['gauge', 'rate', 'count', 'distribution'],

  dataSources: ['metrics', 'logs', 'spans', 'rum', 'events', 'profiles', 'cloud_cost'],

  docsUrl: 'https://docs.datadoghq.com/api/latest/metrics/'
} as const

export type MetricsSchema = typeof metrics
