import { describe, it, expect } from 'vitest'
import { renderMonitorTemplate } from '../../src/utils/templatePreview.js'

describe('renderMonitorTemplate', () => {
  describe('variable substitution', () => {
    it('substitutes a simple top-level variable', () => {
      const result = renderMonitorTemplate('Hello {{name}}', { variables: { name: 'world' } })

      expect(result.rendered).toBe('Hello world')
      expect(result.variablesUsed).toEqual(['name'])
      expect(result.variablesMissing).toEqual([])
    })

    it('substitutes nested variables via dot-notation', () => {
      const result = renderMonitorTemplate('Service: {{service.name}}', {
        variables: { 'service.name': 'api-gateway' }
      })

      expect(result.rendered).toBe('Service: api-gateway')
      expect(result.variablesUsed).toEqual(['service.name'])
    })

    it('substitutes deep nested variables when context is a nested object', () => {
      const result = renderMonitorTemplate('Host: {{host.tags.region}}', {
        variables: { host: { tags: { region: 'eu-west-1' } } } as unknown as Record<string, string>
      })

      expect(result.rendered).toBe('Host: eu-west-1')
      expect(result.variablesUsed).toEqual(['host.tags.region'])
    })

    it('substitutes multiple variables in one template', () => {
      const result = renderMonitorTemplate('{{a}} and {{b}}', {
        variables: { a: 'foo', b: 'bar' }
      })

      expect(result.rendered).toBe('foo and bar')
      expect(result.variablesUsed.sort()).toEqual(['a', 'b'])
    })

    it('marks a missing variable as {{undefined:name}} and reports it', () => {
      const result = renderMonitorTemplate('Hello {{missing}}', { variables: {} })

      expect(result.rendered).toBe('Hello {{undefined:missing}}')
      expect(result.variablesMissing).toEqual(['missing'])
      expect(result.variablesUsed).toEqual([])
    })

    it('marks a variable not present in context.variables (no variables key) as undefined', () => {
      const result = renderMonitorTemplate('Value: {{x}}', {})

      expect(result.rendered).toBe('Value: {{undefined:x}}')
      expect(result.variablesMissing).toEqual(['x'])
    })

    it('handles a variable that appears multiple times only once in variablesUsed', () => {
      const result = renderMonitorTemplate('{{x}} {{x}} {{x}}', {
        variables: { x: 'a' }
      })

      expect(result.rendered).toBe('a a a')
      expect(result.variablesUsed).toEqual(['x'])
    })

    it('handles whitespace inside the mustache braces', () => {
      const result = renderMonitorTemplate('{{ name }}', { variables: { name: 'ok' } })

      expect(result.rendered).toBe('ok')
      expect(result.variablesUsed).toEqual(['name'])
    })
  })

  describe('conditional blocks — positive', () => {
    it('renders {{#is_alert}} block when is_alert is true', () => {
      const result = renderMonitorTemplate('{{#is_alert}}ALERT{{/is_alert}}', {
        conditionals: { is_alert: true }
      })

      expect(result.rendered).toBe('ALERT')
      expect(result.conditionalsResolved).toEqual({ is_alert: true })
    })

    it('drops {{#is_alert}} block when is_alert is false', () => {
      const result = renderMonitorTemplate('before {{#is_alert}}ALERT{{/is_alert}} after', {
        conditionals: { is_alert: false }
      })

      expect(result.rendered).toBe('before  after')
      expect(result.conditionalsResolved).toEqual({ is_alert: false })
    })

    it('drops {{#is_alert}} block when is_alert is missing (default false)', () => {
      const result = renderMonitorTemplate('before {{#is_alert}}ALERT{{/is_alert}} after', {})

      expect(result.rendered).toBe('before  after')
      expect(result.conditionalsResolved).toEqual({ is_alert: false })
    })

    it('supports is_warning', () => {
      const result = renderMonitorTemplate('{{#is_warning}}W{{/is_warning}}', {
        conditionals: { is_warning: true }
      })

      expect(result.rendered).toBe('W')
      expect(result.conditionalsResolved).toEqual({ is_warning: true })
    })

    it('supports is_no_data', () => {
      const result = renderMonitorTemplate('{{#is_no_data}}NODATA{{/is_no_data}}', {
        conditionals: { is_no_data: true }
      })

      expect(result.rendered).toBe('NODATA')
      expect(result.conditionalsResolved).toEqual({ is_no_data: true })
    })

    it('supports is_recovery', () => {
      const result = renderMonitorTemplate('{{#is_recovery}}REC{{/is_recovery}}', {
        conditionals: { is_recovery: true }
      })

      expect(result.rendered).toBe('REC')
      expect(result.conditionalsResolved).toEqual({ is_recovery: true })
    })

    it('supports is_alert_to_warning', () => {
      const result = renderMonitorTemplate('{{#is_alert_to_warning}}A2W{{/is_alert_to_warning}}', {
        conditionals: { is_alert_to_warning: true }
      })

      expect(result.rendered).toBe('A2W')
      expect(result.conditionalsResolved).toEqual({ is_alert_to_warning: true })
    })

    it('supports is_warning_to_alert', () => {
      const result = renderMonitorTemplate('{{#is_warning_to_alert}}W2A{{/is_warning_to_alert}}', {
        conditionals: { is_warning_to_alert: true }
      })

      expect(result.rendered).toBe('W2A')
      expect(result.conditionalsResolved).toEqual({ is_warning_to_alert: true })
    })
  })

  describe('conditional blocks — negation', () => {
    it('renders {{^is_warning}} block when is_warning is false', () => {
      const result = renderMonitorTemplate('{{^is_warning}}NOTW{{/is_warning}}', {
        conditionals: { is_warning: false }
      })

      expect(result.rendered).toBe('NOTW')
      expect(result.conditionalsResolved).toEqual({ is_warning: false })
    })

    it('renders {{^is_warning}} block when is_warning is missing (default false)', () => {
      const result = renderMonitorTemplate('{{^is_warning}}NOTW{{/is_warning}}', {})

      expect(result.rendered).toBe('NOTW')
      expect(result.conditionalsResolved).toEqual({ is_warning: false })
    })

    it('drops {{^is_warning}} block when is_warning is true', () => {
      const result = renderMonitorTemplate('before {{^is_warning}}NOTW{{/is_warning}} after', {
        conditionals: { is_warning: true }
      })

      expect(result.rendered).toBe('before  after')
      expect(result.conditionalsResolved).toEqual({ is_warning: true })
    })

    it('supports negation for all 6 conditionals', () => {
      const conditionals: Array<
        | 'is_alert'
        | 'is_warning'
        | 'is_no_data'
        | 'is_recovery'
        | 'is_alert_to_warning'
        | 'is_warning_to_alert'
      > = [
        'is_alert',
        'is_warning',
        'is_no_data',
        'is_recovery',
        'is_alert_to_warning',
        'is_warning_to_alert'
      ]

      for (const cond of conditionals) {
        const result = renderMonitorTemplate(`{{^${cond}}}X{{/${cond}}}`, {})
        expect(result.rendered).toBe('X')
        expect(result.conditionalsResolved[cond]).toBe(false)
      }
    })
  })

  describe('nested and mixed', () => {
    it('handles a variable inside a conditional block', () => {
      const result = renderMonitorTemplate('{{#is_alert}}Alert on {{service}}{{/is_alert}}', {
        variables: { service: 'api' },
        conditionals: { is_alert: true }
      })

      expect(result.rendered).toBe('Alert on api')
      expect(result.variablesUsed).toEqual(['service'])
      expect(result.conditionalsResolved).toEqual({ is_alert: true })
    })

    it('does not collect variables from a dropped conditional block', () => {
      const result = renderMonitorTemplate('static {{#is_alert}}{{service}}{{/is_alert}}', {
        variables: { service: 'api' },
        conditionals: { is_alert: false }
      })

      expect(result.rendered).toBe('static ')
      expect(result.variablesUsed).toEqual([])
      expect(result.variablesMissing).toEqual([])
    })

    it('handles nested conditional inside another conditional', () => {
      const tpl = '{{#is_alert}}A{{#is_warning}}W{{/is_warning}}E{{/is_alert}}'
      const result = renderMonitorTemplate(tpl, {
        conditionals: { is_alert: true, is_warning: true }
      })

      expect(result.rendered).toBe('AWE')
      expect(result.conditionalsResolved).toEqual({ is_alert: true, is_warning: true })
    })

    it('drops nested conditional when inner is false', () => {
      const tpl = '{{#is_alert}}A{{#is_warning}}W{{/is_warning}}E{{/is_alert}}'
      const result = renderMonitorTemplate(tpl, {
        conditionals: { is_alert: true, is_warning: false }
      })

      expect(result.rendered).toBe('AE')
      expect(result.conditionalsResolved).toEqual({ is_alert: true, is_warning: false })
    })

    it('drops outer conditional regardless of inner conditional', () => {
      const tpl = '{{#is_alert}}A{{#is_warning}}W{{/is_warning}}E{{/is_alert}}tail'
      const result = renderMonitorTemplate(tpl, {
        conditionals: { is_alert: false, is_warning: true }
      })

      expect(result.rendered).toBe('tail')
      expect(result.conditionalsResolved.is_alert).toBe(false)
    })

    it('renders nested conditional inside a variable substitution context', () => {
      // Variable rendered alongside nested conditionals
      const tpl =
        'svc={{service}} {{#is_alert}}alert {{#is_no_data}}+nodata{{/is_no_data}}{{/is_alert}}'
      const result = renderMonitorTemplate(tpl, {
        variables: { service: 'web' },
        conditionals: { is_alert: true, is_no_data: true }
      })

      expect(result.rendered).toBe('svc=web alert +nodata')
      expect(result.variablesUsed).toEqual(['service'])
      expect(result.conditionalsResolved).toEqual({ is_alert: true, is_no_data: true })
    })
  })

  describe('unsupported syntax', () => {
    it('throws EUNSUPPORTED_TEMPLATE_SYNTAX for {{#each items}}', () => {
      expect(() => renderMonitorTemplate('{{#each items}}item{{/each}}', {})).toThrow(
        /EUNSUPPORTED_TEMPLATE_SYNTAX/
      )
    })

    it('throws EUNSUPPORTED_TEMPLATE_SYNTAX listing supported subset for each', () => {
      try {
        renderMonitorTemplate('{{#each rows}}x{{/each}}', {})
        throw new Error('expected to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        const msg = (err as Error).message
        expect(msg).toContain('EUNSUPPORTED_TEMPLATE_SYNTAX')
        expect(msg).toContain('is_alert')
        expect(msg).toContain('is_warning')
      }
    })

    it('throws EUNSUPPORTED_TEMPLATE_SYNTAX for {{> partial}}', () => {
      expect(() => renderMonitorTemplate('hello {{> header}} world', {})).toThrow(
        /EUNSUPPORTED_TEMPLATE_SYNTAX/
      )
    })

    it('throws EUNSUPPORTED_TEMPLATE_SYNTAX for an unknown conditional block', () => {
      // is_unknown is not part of the supported conditional set
      expect(() => renderMonitorTemplate('{{#is_unknown}}x{{/is_unknown}}', {})).toThrow(
        /EUNSUPPORTED_TEMPLATE_SYNTAX/
      )
    })
  })

  describe('return shape', () => {
    it('returns all four fields even on a plain string template', () => {
      const result = renderMonitorTemplate('plain text', {})

      expect(result).toEqual({
        rendered: 'plain text',
        variablesUsed: [],
        variablesMissing: [],
        conditionalsResolved: {},
        tagConditionalsResolved: []
      })
    })

    it('returns conditionalsResolved with every encountered conditional', () => {
      const tpl =
        '{{#is_alert}}A{{/is_alert}}{{^is_warning}}NW{{/is_warning}}{{#is_no_data}}N{{/is_no_data}}'
      const result = renderMonitorTemplate(tpl, {
        conditionals: { is_alert: true, is_warning: false, is_no_data: false }
      })

      expect(result.conditionalsResolved).toEqual({
        is_alert: true,
        is_warning: false,
        is_no_data: false
      })
    })
  })

  describe('tag conditionals — is_match / is_exact_match', () => {
    it('renders {{#is_match}} when the tag value contains the substring', () => {
      const result = renderMonitorTemplate(
        '{{#is_match "host.role.name" "db"}}@db-team{{/is_match}}',
        { variables: { 'host.role.name': 'primary-db-01' } }
      )

      expect(result.rendered).toBe('@db-team')
      expect(result.tagConditionalsResolved).toEqual([
        {
          name: 'is_match',
          negated: false,
          variable: 'host.role.name',
          comparisons: ['db'],
          matched: true
        }
      ])
    })

    it('drops {{#is_match}} when the tag value does not contain the substring', () => {
      const result = renderMonitorTemplate('a{{#is_match "service" "api"}}X{{/is_match}}b', {
        variables: { service: 'worker' }
      })

      expect(result.rendered).toBe('ab')
      expect(result.tagConditionalsResolved[0]?.matched).toBe(false)
    })

    it('renders {{#is_exact_match}} only on an exact value match', () => {
      const hit = renderMonitorTemplate(
        '{{#is_exact_match "host.name" "production"}}P{{/is_exact_match}}',
        { variables: { 'host.name': 'production' } }
      )
      expect(hit.rendered).toBe('P')

      const miss = renderMonitorTemplate(
        '{{#is_exact_match "host.name" "production"}}P{{/is_exact_match}}',
        { variables: { 'host.name': 'production-eu' } }
      )
      expect(miss.rendered).toBe('')
      expect(miss.tagConditionalsResolved[0]?.matched).toBe(false)
    })

    it('matches when any of multiple comparison values matches (OR semantics)', () => {
      const result = renderMonitorTemplate(
        '{{#is_match "host.role.name" "db" "database"}}DB{{/is_match}}',
        { variables: { 'host.role.name': 'database-cluster' } }
      )

      expect(result.rendered).toBe('DB')
      expect(result.tagConditionalsResolved[0]?.comparisons).toEqual(['db', 'database'])
    })

    it('inverts {{^is_match}} (renders when the substring is absent)', () => {
      const result = renderMonitorTemplate(
        '{{^is_match "host.role.name" "db"}}@slack{{/is_match}}',
        { variables: { 'host.role.name': 'web-frontend' } }
      )

      expect(result.rendered).toBe('@slack')
      expect(result.tagConditionalsResolved[0]).toMatchObject({
        name: 'is_match',
        negated: true,
        matched: false
      })
    })

    it('inverts {{^is_exact_match}} (renders when the value differs)', () => {
      const result = renderMonitorTemplate(
        '{{^is_exact_match "env" "prod"}}non-prod{{/is_exact_match}}',
        { variables: { env: 'staging' } }
      )

      expect(result.rendered).toBe('non-prod')
    })

    it('treats an empty-string exact match as matching a missing tag', () => {
      const result = renderMonitorTemplate(
        '{{#is_exact_match "host.datacenter" ""}}no-dc{{/is_exact_match}}',
        { variables: {} }
      )

      expect(result.rendered).toBe('no-dc')
      expect(result.tagConditionalsResolved[0]?.matched).toBe(true)
    })

    it('resolves the issue repro — tag conditional nested in {{#is_alert}}', () => {
      const tpl =
        '@slack-alerts\n{{#is_alert}}{{#is_exact_match "kube_deployment.name" "my-service"}}@slack-team-a{{/is_exact_match}}{{#is_match "kube_deployment.name" "batch-"}}@slack-team-b{{/is_match}}{{/is_alert}}'
      const result = renderMonitorTemplate(tpl, {
        variables: { 'kube_deployment.name': 'my-service' },
        conditionals: { is_alert: true }
      })

      expect(result.rendered).toBe('@slack-alerts\n@slack-team-a')
      expect(result.conditionalsResolved).toEqual({ is_alert: true })
      expect(result.tagConditionalsResolved).toHaveLength(2)
    })

    it('records tag conditionals evaluated inside a dropped boolean branch', () => {
      const result = renderMonitorTemplate(
        '{{#is_alert}}{{#is_match "svc" "api"}}X{{/is_match}}{{/is_alert}}',
        { variables: { svc: 'api-gateway' }, conditionals: { is_alert: false } }
      )

      expect(result.rendered).toBe('')
      // The outer block is dropped, but the nested tag conditional is still recorded.
      expect(result.tagConditionalsResolved).toHaveLength(1)
      expect(result.tagConditionalsResolved[0]?.matched).toBe(true)
    })

    it('throws EUNSUPPORTED_TEMPLATE_SYNTAX for a tag conditional with no comparison value', () => {
      expect(() => renderMonitorTemplate('{{#is_match "host.name"}}x{{/is_match}}', {})).toThrow(
        /EUNSUPPORTED_TEMPLATE_SYNTAX/
      )
    })
  })
})
