import { describe, it, expect } from 'vitest'
import { getSchema } from '../../src/tools/schema.js'

describe('schema tool', () => {
  describe('getSchema', () => {
    it('should return dashboard schema with all expected fields', async () => {
      const result = await getSchema('dashboards')

      expect(result.resource).toBe('dashboards')
      expect(result.schema).toHaveProperty('palettes')
      expect(result.schema).toHaveProperty('widgetTypes')
      expect(result.schema).toHaveProperty('displayTypes')
      expect(result.schema).toHaveProperty('lineTypes')
      expect(result.schema).toHaveProperty('lineWidths')
      expect(result.schema).toHaveProperty('comparators')
      expect(result.schema).toHaveProperty('aggregators')
      expect(result.schema).toHaveProperty('layoutTypes')
      expect(result.schema).toHaveProperty('responseFormats')
      expect(result.schema).toHaveProperty('sortOrders')
      expect(result.schema).toHaveProperty('textAligns')
      expect(result.schema).toHaveProperty('verticalAligns')
      expect(result.schema).toHaveProperty('horizontalAligns')
      expect(result.schema).toHaveProperty('imageSizings')
      expect(result.schema).toHaveProperty('liveSpans')
      expect(result.schema).toHaveProperty('eventsDataSources')
      expect(result.schema).toHaveProperty('metricAggregations')
      expect(result.schema).toHaveProperty('eventAggregations')
      expect(result.schema).toHaveProperty('docsUrl')
    })

    it('should return valid widget types for dashboards', async () => {
      const result = await getSchema('dashboards')

      expect(result.schema.widgetTypes).toContain('timeseries')
      expect(result.schema.widgetTypes).toContain('query_value')
      expect(result.schema.widgetTypes).toContain('toplist')
      expect(result.schema.widgetTypes).toContain('heatmap')
      expect(result.schema.widgetTypes).toContain('note')
    })

    it('should return valid palettes for dashboards', async () => {
      const result = await getSchema('dashboards')

      expect(result.schema.palettes).toContain('blue')
      expect(result.schema.palettes).toContain('green')
      expect(result.schema.palettes).toContain('red')
      expect(result.schema.palettes).toContain('grey')
    })

    it('should return valid liveSpans for dashboards', async () => {
      const result = await getSchema('dashboards')

      expect(result.schema.liveSpans).toContain('1h')
      expect(result.schema.liveSpans).toContain('1d')
      expect(result.schema.liveSpans).toContain('1w')
      expect(result.schema.liveSpans).toContain('1mo')
    })

    it('should return metrics schema with all expected fields', async () => {
      const result = await getSchema('metrics')

      expect(result.resource).toBe('metrics')
      expect(result.schema).toHaveProperty('aggregators')
      expect(result.schema).toHaveProperty('rollupMethods')
      expect(result.schema).toHaveProperty('metricTypes')
      expect(result.schema).toHaveProperty('dataSources')
      expect(result.schema).toHaveProperty('docsUrl')
    })

    it('should return monitors schema with all expected fields', async () => {
      const result = await getSchema('monitors')

      expect(result.resource).toBe('monitors')
      expect(result.schema).toHaveProperty('types')
      expect(result.schema).toHaveProperty('aggregators')
      expect(result.schema).toHaveProperty('comparators')
      expect(result.schema).toHaveProperty('priorities')
      expect(result.schema).toHaveProperty('notifyStates')
      expect(result.schema).toHaveProperty('docsUrl')
    })

    it('should return valid monitor types', async () => {
      const result = await getSchema('monitors')

      expect(result.schema.types).toContain('metric alert')
      expect(result.schema.types).toContain('log alert')
      expect(result.schema.types).toContain('query alert')
      expect(result.schema.types).toContain('composite')
      expect(result.schema.types).toContain('slo alert')
    })

    it('should return slos schema with all expected fields', async () => {
      const result = await getSchema('slos')

      expect(result.resource).toBe('slos')
      expect(result.schema).toHaveProperty('types')
      expect(result.schema).toHaveProperty('timeframes')
      expect(result.schema).toHaveProperty('correctionCategories')
      expect(result.schema).toHaveProperty('measures')
      expect(result.schema).toHaveProperty('docsUrl')
    })

    it('should return valid SLO types', async () => {
      const result = await getSchema('slos')

      expect(result.schema.types).toContain('metric')
      expect(result.schema.types).toContain('monitor')
      expect(result.schema.types).toContain('time_slice')
    })

    it('should return valid SLO timeframes', async () => {
      const result = await getSchema('slos')

      expect(result.schema.timeframes).toContain('7d')
      expect(result.schema.timeframes).toContain('30d')
      expect(result.schema.timeframes).toContain('90d')
    })
  })
})
