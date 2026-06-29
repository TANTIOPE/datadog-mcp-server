/**
 * Monitor message template preview — Datadog's documented Mustache subset.
 *
 * Supported syntax:
 *   - {{variable.name}}                         — variable substitution (dot-path lookup)
 *   - {{#is_alert}}...{{/is_alert}}            — positive boolean conditional
 *   - {{^is_warning}}...{{/is_warning}}        — negated boolean conditional
 *   - {{#is_match "tag" "a" "b"}}...{{/is_match}}             — tag substring conditional
 *   - {{#is_exact_match "tag" "v"}}...{{/is_exact_match}}     — tag exact-match conditional
 *   - {{^is_match ...}} / {{^is_exact_match ...}}            — negated tag conditionals
 *
 * Supported boolean conditionals (fixed set, see design.md §Data model — MonitorConditional):
 *   is_alert, is_warning, is_no_data, is_recovery,
 *   is_alert_to_warning, is_warning_to_alert
 *
 * Tag conditionals (https://docs.datadoghq.com/monitors/notify/variables/):
 *   - is_match: body renders when the value of `tag` CONTAINS any provided substring.
 *   - is_exact_match: body renders when the value of `tag` EQUALS any provided string.
 *     An empty comparison string ("") matches a missing/empty tag (Datadog's
 *     "missing attribute" behavior).
 *   - Both accept one or more comparison strings (OR semantics) and resolve their
 *     `tag` against `context.variables` via the same dot-path lookup as variables.
 *   - Comparison is CASE-SENSITIVE. Datadog does not document case behavior for these
 *     conditionals, so the preview picks the predictable case-sensitive interpretation;
 *     this is a known edge-case divergence from Datadog's server-side renderer.
 *
 * Unsupported (throws EUNSUPPORTED_TEMPLATE_SYNTAX):
 *   - {{#each ...}}     loops
 *   - {{> name}}        partials
 *   - any conditional name outside the supported set
 *   - a tag conditional with no comparison value ({{#is_match "tag"}})
 *
 * Processing order:
 *   1. Resolve conditional blocks (depth-first; nested blocks fully resolved before parent).
 *      Boolean conditionals use `context.conditionals`; tag conditionals are evaluated
 *      against `context.variables`.
 *   2. Substitute remaining variables in the resulting literal text.
 *
 * Variables that are not present in `context.variables` render as
 * `{{undefined:name}}` and are reported in `variablesMissing`.
 * Missing boolean conditionals default to `false`.
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

/** Datadog tag-variable conditional keywords (two-argument conditionals). */
export type TagConditionalName = 'is_match' | 'is_exact_match'

/** One evaluated tag conditional, reported back so callers see the routing decision. */
export interface TagConditionalResolution {
  name: TagConditionalName
  negated: boolean
  variable: string
  comparisons: readonly string[]
  matched: boolean
}

export interface PreviewResult {
  rendered: string
  variablesUsed: string[]
  variablesMissing: string[]
  conditionalsResolved: Record<string, boolean>
  tagConditionalsResolved: TagConditionalResolution[]
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
  | {
      kind: 'tagBlock'
      conditional: TagConditionalName
      negated: boolean
      variable: string
      comparisons: string[]
      children: Token[]
    }

const TAG_REGEX = /\{\{\s*([#^/>])?\s*([^}]*?)\s*\}\}/g // NOSONAR S5852: bounded template input, polynomial backtracking

/** Recognizes the head of a tag conditional, e.g. `is_match "a" "b"`. */
const TAG_CONDITIONAL_HEAD = /^(is_match|is_exact_match)\b/

/** Extracts each double-quoted argument from a tag-conditional body. */
const QUOTED_ARG_REGEX = /"([^"]*)"/g // NOSONAR S5852: bounded template input, no nested quantifier

/**
 * Parse a tag-conditional opener body (e.g. `is_match "tag.name" "db" "database"`)
 * into its keyword, variable, and comparison strings.
 *
 * Returns `null` when the body is not a tag conditional at all (so the caller can
 * fall through to the existing loop/unknown-conditional handling). Throws
 * EUNSUPPORTED_TEMPLATE_SYNTAX when it looks like a tag conditional but is malformed
 * (missing variable or no comparison value).
 */
function parseTagConditionalHead(
  body: string,
  prefix: string
): { conditional: TagConditionalName; variable: string; comparisons: string[] } | null {
  const headMatch = TAG_CONDITIONAL_HEAD.exec(body)
  if (!headMatch?.[1]) {
    return null
  }
  const conditional = headMatch[1] as TagConditionalName

  const args: string[] = []
  QUOTED_ARG_REGEX.lastIndex = 0
  let arg: RegExpExecArray | null
  while ((arg = QUOTED_ARG_REGEX.exec(body)) !== null) {
    args.push(arg[1] ?? '')
  }

  const [variable, ...comparisons] = args
  if (variable === undefined || variable === '' || comparisons.length === 0) {
    throw unsupportedSyntaxError(
      `${conditional} requires a quoted tag and at least one quoted comparison value ` +
        `(found {{${prefix}${body}}})`
    )
  }

  return { conditional, variable, comparisons }
}

/**
 * Parse the raw template into a tree of literal text and conditional blocks.
 * Detects unsupported constructs (loops, partials, unknown conditionals) and
 * throws EUNSUPPORTED_TEMPLATE_SYNTAX immediately — never silently degrades.
 *
 * Variables are NOT consumed here; they remain inside the `literal` text and
 * are substituted in a later pass.
 */
function parseBlocks(template: string): Token[] {
  type Closer =
    | { kind: 'boolean'; conditional: MonitorConditional; negated: boolean }
    | {
        kind: 'tag'
        conditional: TagConditionalName
        negated: boolean
        variable: string
        comparisons: string[]
      }
  type Frame = {
    children: Token[]
    closer?: Closer
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
      // Two-argument tag conditionals (is_match / is_exact_match) carry internal
      // whitespace; detect and parse them BEFORE the loop/whitespace rejection so
      // they are no longer misclassified as Handlebars loops.
      const tagHead = parseTagConditionalHead(name, prefix)
      if (tagHead) {
        stack.push({
          children: [],
          closer: {
            kind: 'tag',
            conditional: tagHead.conditional,
            negated: prefix === '^',
            variable: tagHead.variable,
            comparisons: tagHead.comparisons
          }
        })
      } else if (name.startsWith('each') || /\s/.test(name)) {
        // Reject loops outright.
        throw unsupportedSyntaxError(`loops are not supported (found {{${prefix}${name}}})`)
      } else if (!SUPPORTED_SET.has(name)) {
        throw unsupportedSyntaxError(`unknown conditional '${name}' in {{${prefix}${name}}}`)
      } else {
        stack.push({
          children: [],
          closer: {
            kind: 'boolean',
            conditional: name as MonitorConditional,
            negated: prefix === '^'
          }
        })
      }
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
      if (frame.closer.kind === 'tag') {
        parent.children.push({
          kind: 'tagBlock',
          conditional: frame.closer.conditional,
          negated: frame.closer.negated,
          variable: frame.closer.variable,
          comparisons: frame.closer.comparisons,
          children: frame.children
        })
      } else {
        parent.children.push({
          kind: 'block',
          conditional: frame.closer.conditional,
          negated: frame.closer.negated,
          children: frame.children
        })
      }
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
 * Evaluate a tag conditional against the resolved value of its tag variable.
 *
 *   - is_match:       the value CONTAINS any provided comparison substring.
 *   - is_exact_match: the value EQUALS any provided comparison string. An empty
 *                     comparison ("") matches a missing/empty tag.
 *
 * Comparison is case-sensitive (see module JSDoc). A missing tag resolves to the
 * empty string for comparison purposes.
 */
function evaluateTagConditional(
  name: TagConditionalName,
  variable: string,
  comparisons: readonly string[],
  variables: Record<string, unknown>
): boolean {
  const resolvedValue = lookupVariable(variable, variables)
  const value = resolvedValue ?? ''
  if (name === 'is_exact_match') {
    return comparisons.some((comparison) => value === comparison)
  }
  // is_match — substring containment.
  return comparisons.some((comparison) => value.includes(comparison))
}

/** Mutable accumulators threaded through the render walk. */
interface RenderSink {
  conditionals: Partial<Record<MonitorConditional, boolean>>
  variables: Record<string, unknown>
  resolved: Record<string, boolean>
  tagResolved: TagConditionalResolution[]
}

/**
 * Walk the parsed token tree, evaluate conditionals, and emit the literal
 * (still containing variable tags) text for the variable-substitution pass.
 *
 * Records every conditional we encounter — even ones in dropped branches —
 * so callers see the full resolution map (boolean conditionals) and the list of
 * evaluated tag conditionals.
 */
function renderBlocks(tokens: readonly Token[], sink: RenderSink): string {
  let out = ''
  for (const token of tokens) {
    if (token.kind === 'literal') {
      out += token.text
      continue
    }

    let include: boolean
    if (token.kind === 'tagBlock') {
      const matched = evaluateTagConditional(
        token.conditional,
        token.variable,
        token.comparisons,
        sink.variables
      )
      sink.tagResolved.push({
        name: token.conditional,
        negated: token.negated,
        variable: token.variable,
        comparisons: token.comparisons,
        matched
      })
      include = token.negated ? !matched : matched
    } else {
      const flag = sink.conditionals[token.conditional] ?? false
      sink.resolved[token.conditional] = flag
      include = token.negated ? !flag : flag
    }

    if (include) {
      out += renderBlocks(token.children, sink)
    } else {
      // Even in a dropped branch, descend so nested conditionals are recorded
      // in `conditionalsResolved` / `tagConditionalsResolved`. Discard the output.
      renderBlocks(token.children, sink)
    }
  }
  return out
}

const VARIABLE_TAG_REGEX = /\{\{\s*([^#^/>\s][^}]*?)\s*\}\}/g // NOSONAR S5852: bounded template input, polynomial backtracking

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
  const tagConditionalsResolved: TagConditionalResolution[] = []
  const afterConditionals = renderBlocks(tree, {
    conditionals,
    variables,
    resolved: conditionalsResolved,
    tagResolved: tagConditionalsResolved
  })
  const { rendered, used, missing } = substituteVariables(afterConditionals, variables)

  return {
    rendered,
    variablesUsed: used,
    variablesMissing: missing,
    conditionalsResolved,
    tagConditionalsResolved
  }
}
