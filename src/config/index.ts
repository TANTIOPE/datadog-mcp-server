import { configSchema, ALL_TOOLS, type Config } from './schema.js'

interface ParsedArgs {
  strings: Record<string, string>
  booleans: Set<string>
}

/**
 * Parse CLI arguments
 * Supports: --transport, --port, --host, --site, --read-only, --disable-tools
 * Format: --key=value or --key value or --flag (boolean)
 */
function parseArgs(): ParsedArgs {
  const strings: Record<string, string> = {}
  const booleans = new Set<string>()
  const argv = process.argv.slice(2)

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue

    if (arg.startsWith('--')) {
      // Handle --key=value format
      if (arg.includes('=')) {
        const parts = arg.slice(2).split('=')
        const key = parts[0]
        const value = parts.slice(1).join('=') // Handle values with = in them
        if (key && value !== undefined) {
          strings[key] = value
        }
      }
      // Handle --key value format or --flag (boolean)
      else {
        const argName = arg.slice(2)
        const nextArg = argv[i + 1]
        if (nextArg && !nextArg.startsWith('--')) {
          strings[argName] = nextArg
          i++
        } else {
          // Boolean flag (no value)
          booleans.add(argName)
        }
      }
    }
  }

  return { strings, booleans }
}

/**
 * Parse disabled tools from comma-separated string
 * Example: "incidents,notebooks" -> those tools disabled
 */
function parseDisabledTools(value: string | undefined): string[] {
  if (!value) return []

  const requested = value.split(',').map((s) => s.trim().toLowerCase())
  return requested.filter((t) => (ALL_TOOLS as readonly string[]).includes(t))
}

export function loadConfig(): Config {
  const args = parseArgs()

  const raw = {
    datadog: {
      apiKey: process.env.DD_API_KEY ?? '',
      appKey: process.env.DD_APP_KEY ?? '',
      site: args.strings.site ?? process.env.DD_SITE ?? 'datadoghq.com'
    },
    server: {
      name: 'datadog-mcp',
      version: '1.0.0',
      transport: args.strings.transport ?? process.env.MCP_TRANSPORT ?? 'stdio',
      port: parseInt(args.strings.port ?? process.env.MCP_PORT ?? '3000', 10),
      host: args.strings.host ?? process.env.MCP_HOST ?? 'localhost'
    },
    limits: {
      maxResults: parseInt(process.env.MCP_MAX_RESULTS ?? '100', 10),
      maxLogLines: parseInt(process.env.MCP_MAX_LOG_LINES ?? '500', 10),
      maxMetricDataPoints: parseInt(process.env.MCP_MAX_METRIC_POINTS ?? '1000', 10),
      defaultTimeRangeHours: parseInt(process.env.MCP_DEFAULT_TIME_RANGE ?? '24', 10)
    },
    features: {
      readOnly: args.booleans.has('read-only') || process.env.MCP_READ_ONLY === 'true',
      disabledTools: parseDisabledTools(
        args.strings['disable-tools'] ?? process.env.MCP_DISABLE_TOOLS
      )
    }
  }

  return configSchema.parse(raw)
}

export {
  type Config,
  type DatadogConfig,
  type ServerConfig,
  type LimitsConfig,
  type FeaturesConfig,
  type ToolName,
  ALL_TOOLS
} from './schema.js'
