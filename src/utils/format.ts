/**
 * Format tool response as MCP content
 */
export function formatResponse(data: unknown): { type: 'text'; text: string }[] {
  return [
    {
      type: 'text' as const,
      text: JSON.stringify(data, null, 2) ?? 'null'
    }
  ]
}

/**
 * Create a structured tool result
 */
export function toolResult<T>(data: T): { content: { type: 'text'; text: string }[] } {
  return {
    content: formatResponse(data)
  }
}
