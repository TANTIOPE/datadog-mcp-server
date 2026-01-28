/**
 * SLO schema definitions
 * Source: https://github.com/DataDog/datadog-api-client-typescript
 * Last updated: 2026-01
 */

export const slos = {
  types: ['metric', 'monitor', 'time_slice'],

  timeframes: ['7d', '30d', '90d', 'custom'],

  correctionCategories: ['Scheduled Maintenance', 'Outside Business Hours', 'Deployment', 'Other'],

  measures: [
    'good_events',
    'bad_events',
    'good_minutes',
    'bad_minutes',
    'slo_status',
    'error_budget_remaining',
    'burn_rate',
    'error_budget_burndown'
  ],

  docsUrl: 'https://docs.datadoghq.com/api/latest/service-level-objectives/'
} as const
