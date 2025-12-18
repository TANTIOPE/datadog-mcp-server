import { z } from 'zod'

// All available tool names
export const ALL_TOOLS = [
  'monitors',
  'dashboards',
  'logs',
  'metrics',
  'traces',
  'events',
  'incidents',
  'slos',
  'synthetics',
  'hosts',
  'downtimes',
  'rum',
  'security',
  'notebooks',
  'users',
  'teams',
  'tags',
  'usage',
  'auth'
] as const

export type ToolName = (typeof ALL_TOOLS)[number]

export const configSchema = z.object({
  datadog: z.object({
    apiKey: z.string().min(1, 'DD_API_KEY is required'),
    appKey: z.string().min(1, 'DD_APP_KEY is required'),
    site: z.string().default('datadoghq.com')
  }),
  server: z
    .object({
      name: z.string().default('datadog-mcp'),
      version: z.string().default('1.0.0'),
      transport: z.enum(['stdio', 'http']).default('stdio'),
      port: z.number().default(3000),
      host: z.string().default('localhost')
    })
    .default({}),
  limits: z
    .object({
      maxResults: z.number().default(100),
      maxLogLines: z.number().default(100), // Reduced from 500 for token efficiency
      defaultLimit: z.number().default(25), // Default limit for initial queries
      maxMetricDataPoints: z.number().default(1000),
      defaultTimeRangeHours: z.number().default(24)
    })
    .default({}),
  features: z
    .object({
      readOnly: z.boolean().default(false),
      disabledTools: z.array(z.string()).default([])
    })
    .default({})
})

export type Config = z.infer<typeof configSchema>
export type DatadogConfig = Config['datadog']
export type ServerConfig = Config['server']
export type LimitsConfig = Config['limits']
export type FeaturesConfig = Config['features']
