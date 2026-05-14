/**
 * Monitor message template preview — Datadog's documented Mustache subset.
 *
 * Supported syntax:
 *   - {{variable.name}}                         — variable substitution (dot-path lookup)
 *   - {{#is_alert}}...{{/is_alert}}            — positive conditional
 *   - {{^is_warning}}...{{/is_warning}}        — negated conditional
 *
 * Supported conditionals (fixed set, see design.md §Data model — MonitorConditional):
 *   is_alert, is_warning, is_no_data, is_recovery,
 *   is_alert_to_warning, is_warning_to_alert
 *
 * Unsupported (throws EUNSUPPORTED_TEMPLATE_SYNTAX):
 *   - {{#each ...}}     loops
 *   - {{> name}}        partials
 *   - any conditional name outside the supported set
 *
 * Processing order:
 *   1. Resolve conditional blocks (depth-first; nested blocks fully resolved before parent).
 *   2. Substitute remaining variables in the resulting literal text.
 *
 * Variables that are not present in `context.variables` render as
 * `{{undefined:name}}` and are reported in `variablesMissing`.
 * Missing conditionals default to `false`.
 */

/** Fixed set of conditionals supported by Datadog monitor messages. */
export const SUPPORTED_CONDITIONALS = [
  'is_alert',
  'is_warning',
  'is_no_data',
  'is_recovery',
  'is_alert_to_warning',
  'is_warning_to_alert'
] as const

export type MonitorConditional = (typeof SUPPORTED_CONDITIONALS)[number]

export interface TemplateContext {
  variables?: Record<string, unknown>
  conditionals?: Partial<Record<MonitorConditional, boolean>>
}

export interface PreviewResult {
  rendered: string
  variablesUsed: string[]
  variablesMissing: string[]
  conditionalsResolved: Record<string, boolean>
}

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_CONDITIONALS)

/**
 * Build the standard EUNSUPPORTED_TEMPLATE_SYNTAX error message.
 * The message enumerates the supported subset so the caller can self-correct.
 */
function unsupportedSyntaxError(detail: string): Error {
  const supportedList = SUPPORTED_CONDITIONALS.join(', ')
  return new Error(
    `EUNSUPPORTED_TEMPLATE_SYNTAX: ${detail}. ` +
      `Supported syntax is {{variable.name}} and conditionals ` +
      `{{#name}}...{{/name}} / {{^name}}...{{/name}} where name is one of: ${supportedList}. ` +
      `Loops ({{#each ...}}) and partials ({{> ...}}) are not supported.`
  )
}

/**
 * Look up a dot-notation path against the variables map.
 *
 * Lookup strategy:
 *   1. Direct match — if `variables[fullPath]` exists, use it.
 *   2. Deep walk — split on `.` and walk a nested object literal.
 *
 * Returns `undefined` when the path is not resolvable, so the caller can
 * emit a `{{undefined:name}}` marker.
 */
function lookupVariable(path: string, variables: Record<string, unknown>): string | undefined {
  // Strategy 1: flat key with dots
  if (Object.prototype.hasOwnProperty.call(variables, path)) {
    const value = variables[path]
    return value === undefined || value === null ? undefined : String(value)
  }

  // Strategy 2: deep walk
  const segments = path.split('.')
  let cursor: unknown = variables
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) {
      return undefined
    }
    if (typeof cursor !== 'object') {
      return undefined
    }
    const record = cursor as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, segment)) {
      return undefined
    }
    cursor = record[segment]
  }

  if (cursor === undefined || cursor === null) {
    return undefined
  }
  if (typeof cursor === 'object') {
    // Refuse to stringify a non-leaf — treat as missing.
    return undefined
  }
  return String(cursor)
}

/** Token types produced by the conditional-block parser. */
type Token =
  | { kind: 'literal'; text: string }
  | { kind: 'block'; conditional: MonitorConditional; negated: boolean; children: Token[] }

// NOSONAR S5852: input is monitor message templates (bounded, trusted); adjacent \s*/[^}]*?/\s* yields polynomial not exponential backtracking, bounded by template length
const TAG_REGEX = /\{\{\s*([#^/>])?\s*([^}]*?)\s*\}\}/g

/**
 * Parse the raw template into a tree of literal text and conditional blocks.
 * Detects unsupported constructs (loops, partials, unknown conditionals) and
 * throws EUNSUPPORTED_TEMPLATE_SYNTAX immediately — never silently degrades.
 *
 * Variables are NOT consumed here; they remain inside the `literal` text and
 * are substituted in a later pass.
 */
function parseBlocks(template: string): Token[] {
  type Frame = {
    children: Token[]
    closer?: { conditional: MonitorConditional; negated: boolean }
  }

  const stack: Frame[] = [{ children: [] }]
  let cursor = 0
  TAG_REGEX.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = TAG_REGEX.exec(template)) !== null) {
    const [fullTag, prefix, rawName] = match
    const tagStart = match.index
    const name = rawName?.trim() ?? ''

    // Capture any literal text between the previous cursor and this tag.
    if (tagStart > cursor) {
      const top = stack[stack.length - 1]
      if (top) {
        top.children.push({ kind: 'literal', text: template.slice(cursor, tagStart) })
      }
    }

    if (prefix === '>') {
      throw unsupportedSyntaxError(`partials are not supported (found {{> ${name}}})`)
    }

    if (prefix === '#' || prefix === '^') {
      // Reject loops outright.
      if (name.startsWith('each') || /\s/.test(name)) {
        throw unsupportedSyntaxError(`loops are not supported (found {{${prefix}${name}}})`)
      }
      if (!SUPPORTED_SET.has(name)) {
        throw unsupportedSyntaxError(`unknown conditional '${name}' in {{${prefix}${name}}}`)
      }
      stack.push({
        children: [],
        closer: { conditional: name as MonitorConditional, negated: prefix === '^' }
      })
    } else if (prefix === '/') {
      const frame = stack.pop()
      if (!frame || !frame.closer) {
        throw unsupportedSyntaxError(`unmatched closing tag {{/${name}}}`)
      }
      if (frame.closer.conditional !== name) {
        throw unsupportedSyntaxError(
          `mismatched closing tag {{/${name}}} (expected {{/${frame.closer.conditional}}})`
        )
      }
      const parent = stack[stack.length - 1]
      if (!parent) {
        throw unsupportedSyntaxError('block stack underflow while closing tag')
      }
      parent.children.push({
        kind: 'block',
        conditional: frame.closer.conditional,
        negated: frame.closer.negated,
        children: frame.children
      })
    } else {
      // Plain variable tag — preserve verbatim for the variable-substitution pass.
      const top = stack[stack.length - 1]
      if (top) {
        top.children.push({ kind: 'literal', text: fullTag })
      }
    }

    cursor = tagStart + fullTag.length
  }

  // Trailing literal after the last tag.
  if (cursor < template.length) {
    const top = stack[stack.length - 1]
    if (top) {
      top.children.push({ kind: 'literal', text: template.slice(cursor) })
    }
  }

  if (stack.length !== 1) {
    const open = stack[stack.length - 1]?.closer?.conditional
    throw unsupportedSyntaxError(`unclosed conditional block ${open ? `{{#${open}}}` : ''}`)
  }

  const root = stack[0]
  if (!root) {
    throw unsupportedSyntaxError('parser produced no root frame')
  }
  return root.children
}

/**
 * Walk the parsed token tree, evaluate conditionals, and emit the literal
 * (still containing variable tags) text for the variable-substitution pass.
 *
 * Records every conditional we encounter — even ones in dropped branches —
 * so callers see the full resolution map.
 */
function renderBlocks(
  tokens: readonly Token[],
  conditionals: Partial<Record<MonitorConditional, boolean>>,
  resolved: Record<string, boolean>
): string {
  let out = ''
  for (const token of tokens) {
    if (token.kind === 'literal') {
      out += token.text
      continue
    }
    const flag = conditionals[token.conditional] ?? false
    resolved[token.conditional] = flag
    const include = token.negated ? !flag : flag
    if (include) {
      out += renderBlocks(token.children, conditionals, resolved)
    } else {
      // Even in a dropped branch, descend so nested conditionals are recorded
      // in `conditionalsResolved`. Discard the rendered output.
      renderBlocks(token.children, conditionals, resolved)
    }
  }
  return out
}

// NOSONAR S5852: input is monitor message templates (bounded, trusted); adjacent \s*/[^}]*?/\s* yields polynomial not exponential backtracking, bounded by template length
const VARIABLE_TAG_REGEX = /\{\{\s*([^#^/>\s][^}]*?)\s*\}\}/g

/**
 * Substitute `{{variable.name}}` tags in the already conditional-resolved text.
 * Missing variables produce `{{undefined:name}}` markers and are reported.
 */
function substituteVariables(
  text: string,
  variables: Record<string, unknown>
): { rendered: string; used: string[]; missing: string[] } {
  const usedSet = new Set<string>()
  const missingSet = new Set<string>()

  const rendered = text.replace(VARIABLE_TAG_REGEX, (_match, captured: string) => {
    const name = captured.trim()
    const value = lookupVariable(name, variables)
    if (value === undefined) {
      missingSet.add(name)
      return `{{undefined:${name}}}`
    }
    usedSet.add(name)
    return value
  })

  return {
    rendered,
    used: [...usedSet],
    missing: [...missingSet]
  }
}

/**
 * Render a Datadog monitor message template against the provided context.
 *
 * See module-level JSDoc for the supported subset and processing order.
 */
export function renderMonitorTemplate(template: string, context: TemplateContext): PreviewResult {
  const variables = context.variables ?? {}
  const conditionals = context.conditionals ?? {}

  const tree = parseBlocks(template)
  const conditionalsResolved: Record<string, boolean> = {}
  const afterConditionals = renderBlocks(tree, conditionals, conditionalsResolved)
  const { rendered, used, missing } = substituteVariables(afterConditionals, variables)

  return {
    rendered,
    variablesUsed: used,
    variablesMissing: missing,
    conditionalsResolved
  }
}
