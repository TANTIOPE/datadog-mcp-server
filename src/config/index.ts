import { configSchema, ALL_TOOLS, type Config } from './schema.js'

interface ParsedArgs {
  strings: Record<string, string>
  booleans: Set<string>
}

/**
 * Parse --key=value format argument
 * Returns [key, value] or null if invalid
 */
function parseEqualsFormat(arg: string): [string, string] | null {
  if (!arg.includes('=')) return null
  const parts = arg.slice(2).split('=')
  const key = parts[0]
  const value = parts.slice(1).join('=') // Handle values with = in them
  return key && value !== undefined ? [key, value] : null
}

/**
 * Parse --key value format argument
 * Returns [key, value] or null if next arg is missing/invalid
 */
function parseSpacedFormat(arg: string, nextArg?: string): [string, string] | null {
  if (nextArg && !nextArg.startsWith('--')) {
    return [arg.slice(2), nextArg]
  }
  return null
}

/**
 * Parse boolean flag argument (--flag with no value)
 * Returns the flag name
 */
function parseBooleanFlag(arg: string): string {
  return arg.slice(2)
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
      // Try --key=value format
      const equalsResult = parseEqualsFormat(arg)
      if (equalsResult) {
        const [key, value] = equalsResult
        strings[key] = value
        continue
      }

      // Try --key value format
      const spacedResult = parseSpacedFormat(arg, argv[i + 1])
      if (spacedResult) {
        const [key, value] = spacedResult
        strings[key] = value
        i += 1 // Skip next arg since we consumed it
        continue
      }

      // Must be boolean flag
      booleans.add(parseBooleanFlag(arg))
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
      port: Number.parseInt(args.strings.port ?? process.env.MCP_PORT ?? '3000', 10),
      host: args.strings.host ?? process.env.MCP_HOST ?? 'localhost'
    },
    limits: {
      defaultLimit: Number.parseInt(process.env.MCP_DEFAULT_LIMIT ?? '50', 10),
      defaultLogLines: Number.parseInt(process.env.MCP_DEFAULT_LOG_LINES ?? '200', 10),
      defaultMetricDataPoints: Number.parseInt(process.env.MCP_DEFAULT_METRIC_POINTS ?? '1000', 10),
      defaultTimeRangeHours: Number.parseInt(process.env.MCP_DEFAULT_TIME_RANGE ?? '24', 10)
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
