/**
 * Monitors schema definitions
 * Source: https://github.com/DataDog/datadog-api-client-typescript
 * Last updated: 2026-01
 */

export const monitors = {
  types: [
    'composite',
    'event alert',
    'log alert',
    'metric alert',
    'process alert',
    'query alert',
    'rum alert',
    'service check',
    'synthetics alert',
    'trace-analytics alert',
    'slo alert',
    'event-v2 alert',
    'audit alert',
    'ci-pipelines alert',
    'ci-tests alert',
    'error-tracking alert',
    'database-monitoring alert',
    'network-performance alert',
    'cost alert',
    'data-quality alert',
    'network-path alert'
  ],

  aggregators: ['avg', 'last', 'max', 'min', 'sum', 'count', 'percentile'],

  comparators: ['>', '<', '>=', '<=', '='],

  priorities: ['1', '2', '3', '4', '5'],

  notifyStates: ['Alert', 'No Data', 'Warn', 'OK'],

  docsUrl: 'https://docs.datadoghq.com/api/latest/monitors/'
} as const
