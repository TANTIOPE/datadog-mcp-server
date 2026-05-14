/**
 * Shared key-normalization utilities.
 *
 * MCP callers often submit configuration payloads in snake_case (the convention
 * exposed in tool descriptions and Datadog's REST documentation), while the
 * `@datadog/datadog-api-client` SDK expects camelCase keys at the model layer.
 * These helpers bridge that gap without touching the values themselves.
 */

/**
 * Convert a single snake_case identifier to camelCase.
 *
 * Already-camelCase identifiers and single-word identifiers pass through
 * unchanged because only `_<lowercase>` sequences are rewritten.
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Recursively convert snake_case object keys to camelCase.
 *
 * - Primitives, `null`, and `undefined` are returned unchanged.
 * - Arrays are mapped element-wise (preserving order).
 * - Objects produce a new object with rewritten keys; values are normalized recursively.
 *
 * The input is not mutated.
 */
export function normalizeConfigKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(normalizeConfigKeys)
  if (typeof obj !== 'object') return obj

  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const camelKey = snakeToCamel(key)
    normalized[camelKey] = normalizeConfigKeys(value)
  }
  return normalized
}
