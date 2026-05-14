/**
 * Events schema definitions
 *
 * Enumerates the diagnostic codes that `events.search` can attach to a
 * zero-result response. Agents can introspect this list via the `schema` tool
 * so they know which diagnostics to expect and how to remediate them.
 *
 * Docs: https://docs.datadoghq.com/service_management/events/
 */

export const events = {
  /**
   * Diagnostic codes emitted on zero-result `events.search` responses.
   * Each code is also documented inline in `src/tools/events.ts` next to the
   * heuristic that produces it.
   */
  diagnosticCodes: ['UNINDEXED_TAG_PREFIX', 'NARROW_TIME_RANGE', 'RESTRICTIVE_SOURCE_FILTER'],

  docsUrl: 'https://docs.datadoghq.com/api/latest/events/'
} as const
