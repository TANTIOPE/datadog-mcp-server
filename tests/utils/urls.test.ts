import { describe, it, expect } from 'vitest'
import {
  buildLogsUrl,
  buildMetricsUrl,
  buildTracesUrl,
  buildEventsUrl,
  buildMonitorUrl,
  buildMonitorsListUrl,
  buildRumUrl,
  buildRumSessionUrl,
  buildDashboardUrl,
  buildSloUrl,
  buildIncidentUrl,
  buildSyntheticUrl,
  buildNotebookUrl
} from '../../src/utils/urls.js'

describe('URL Builders', () => {
  const fromSec = 1705320000 // 2024-01-15T11:46:40Z
  const toSec = 1705323600 // 2024-01-15T12:46:40Z

  describe('buildLogsUrl', () => {
    it('should build logs URL with default site', () => {
      const url = buildLogsUrl('service:api status:error', fromSec, toSec)

      expect(url).toContain('https://app.datadoghq.com/logs?')
      expect(url).toContain('query=service%3Aapi+status%3Aerror')
      expect(url).toContain('from_ts=1705320000000')
      expect(url).toContain('to_ts=1705323600000')
    })

    it('should build logs URL with EU site', () => {
      const url = buildLogsUrl('error', fromSec, toSec, 'datadoghq.eu')

      expect(url).toContain('https://app.datadoghq.eu/logs?')
      expect(url).toContain('query=error')
    })

    it('should build logs URL with US3 site', () => {
      const url = buildLogsUrl('status:warn', fromSec, toSec, 'us3.datadoghq.com')

      expect(url).toContain('https://us3.datadoghq.com/logs?')
    })

    it('should encode special characters in query', () => {
      const url = buildLogsUrl('message:"hello world" @user:john@example.com', fromSec, toSec)

      expect(url).toContain('message%3A%22hello+world%22')
      expect(url).toContain('%40user%3Ajohn%40example.com')
    })

    it('should handle empty query', () => {
      const url = buildLogsUrl('', fromSec, toSec)

      expect(url).toContain('https://app.datadoghq.com/logs?')
      expect(url).toContain('query=')
    })
  })

  describe('buildMetricsUrl', () => {
    it('should build metrics URL with simple metric name', () => {
      const url = buildMetricsUrl('system.cpu.user', fromSec, toSec)

      expect(url).toContain('https://app.datadoghq.com/metric/explorer?')
      expect(url).toContain('exp_metric=system.cpu.user')
      expect(url).toContain('exp_query=system.cpu.user')
    })

    it('should extract metric name from aggregation query', () => {
      const url = buildMetricsUrl('avg:system.cpu.user{host:prod}', fromSec, toSec)

      expect(url).toContain('exp_metric=system.cpu.user')
      expect(url).toContain('exp_query=avg%3Asystem.cpu.user%7Bhost%3Aprod%7D')
    })

    it('should extract metric name with sum aggregation', () => {
      const url = buildMetricsUrl('sum:http.requests{env:production}', fromSec, toSec)

      expect(url).toContain('exp_metric=http.requests')
    })

    it('should handle metric with underscores and dots', () => {
      const url = buildMetricsUrl('my_custom.metric.rate', fromSec, toSec)

      expect(url).toContain('exp_metric=my_custom.metric.rate')
    })

    it('should use EU site', () => {
      const url = buildMetricsUrl('system.cpu.user', fromSec, toSec, 'datadoghq.eu')

      expect(url).toContain('https://app.datadoghq.eu/metric/explorer?')
    })
  })

  describe('buildTracesUrl', () => {
    it('should build traces URL with default site', () => {
      const url = buildTracesUrl('service:web-app status:error', fromSec, toSec)

      expect(url).toContain('https://app.datadoghq.com/apm/traces?')
      expect(url).toContain('query=service%3Aweb-app+status%3Aerror')
      expect(url).toContain('start=1705320000000')
      expect(url).toContain('end=1705323600000')
    })

    it('should use start/end instead of from_ts/to_ts', () => {
      const url = buildTracesUrl('env:prod', fromSec, toSec)

      expect(url).toContain('start=')
      expect(url).toContain('end=')
      expect(url).not.toContain('from_ts')
      expect(url).not.toContain('to_ts')
    })

    it('should build traces URL with US5 site', () => {
      const url = buildTracesUrl('error', fromSec, toSec, 'us5.datadoghq.com')

      expect(url).toContain('https://us5.datadoghq.com/apm/traces?')
    })
  })

  describe('buildEventsUrl', () => {
    it('should build events URL with default site', () => {
      const url = buildEventsUrl('tags:deployment priority:normal', fromSec, toSec)

      expect(url).toContain('https://app.datadoghq.com/event/explorer?')
      expect(url).toContain('query=tags%3Adeployment+priority%3Anormal')
      expect(url).toContain('from_ts=1705320000000')
      expect(url).toContain('to_ts=1705323600000')
    })

    it('should build events URL with AP1 site', () => {
      const url = buildEventsUrl('alert', fromSec, toSec, 'ap1.datadoghq.com')

      expect(url).toContain('https://ap1.datadoghq.com/event/explorer?')
    })
  })

  describe('buildMonitorUrl', () => {
    it('should build monitor URL with numeric ID', () => {
      const url = buildMonitorUrl(12345)

      expect(url).toBe('https://app.datadoghq.com/monitors/12345')
    })

    it('should build monitor URL with string ID', () => {
      const url = buildMonitorUrl('67890')

      expect(url).toBe('https://app.datadoghq.com/monitors/67890')
    })

    it('should build monitor URL with EU site', () => {
      const url = buildMonitorUrl(12345, 'datadoghq.eu')

      expect(url).toBe('https://app.datadoghq.eu/monitors/12345')
    })

    it('should build monitor URL with Gov site', () => {
      const url = buildMonitorUrl(12345, 'ddog-gov.com')

      expect(url).toBe('https://app.ddog-gov.com/monitors/12345')
    })
  })

  describe('buildMonitorsListUrl', () => {
    it('should build monitors list URL without query', () => {
      const url = buildMonitorsListUrl()

      expect(url).toBe('https://app.datadoghq.com/monitors/manage')
    })

    it('should build monitors list URL with query', () => {
      const url = buildMonitorsListUrl('status:alert')

      expect(url).toContain('https://app.datadoghq.com/monitors/manage?')
      expect(url).toContain('query=status%3Aalert')
    })

    it('should build monitors list URL with empty string query', () => {
      const url = buildMonitorsListUrl('')

      // Empty string is falsy, so should return URL without params
      expect(url).toBe('https://app.datadoghq.com/monitors/manage')
    })

    it('should build monitors list URL with EU site', () => {
      const url = buildMonitorsListUrl('tag:prod', 'datadoghq.eu')

      expect(url).toContain('https://app.datadoghq.eu/monitors/manage?')
    })
  })

  describe('buildRumUrl', () => {
    it('should build RUM URL with default site', () => {
      const url = buildRumUrl('@view.url_path:/checkout @session.type:user', fromSec, toSec)

      expect(url).toContain('https://app.datadoghq.com/rum/explorer?')
      expect(url).toContain('from_ts=1705320000000')
      expect(url).toContain('to_ts=1705323600000')
    })

    it('should encode RUM query parameters', () => {
      const url = buildRumUrl('@error.message:*timeout*', fromSec, toSec)

      expect(url).toContain('%40error.message')
      expect(url).toContain('timeout')
    })
  })

  describe('buildRumSessionUrl', () => {
    it('should build RUM session replay URL', () => {
      const url = buildRumSessionUrl('app-123', 'session-456')

      expect(url).toBe(
        'https://app.datadoghq.com/rum/replay/sessions/session-456?applicationId=app-123'
      )
    })

    it('should encode application ID with special characters', () => {
      const url = buildRumSessionUrl('app-test/123', 'session-456')

      expect(url).toContain('applicationId=app-test%2F123')
    })

    it('should build RUM session URL with EU site', () => {
      const url = buildRumSessionUrl('app-123', 'session-456', 'datadoghq.eu')

      expect(url).toContain('https://app.datadoghq.eu/rum/replay/sessions/session-456')
    })
  })

  describe('buildDashboardUrl', () => {
    it('should build dashboard URL', () => {
      const url = buildDashboardUrl('abc-123-def')

      expect(url).toBe('https://app.datadoghq.com/dashboard/abc-123-def')
    })

    it('should build dashboard URL with EU site', () => {
      const url = buildDashboardUrl('xyz-789', 'datadoghq.eu')

      expect(url).toBe('https://app.datadoghq.eu/dashboard/xyz-789')
    })
  })

  describe('buildSloUrl', () => {
    it('should build SLO URL', () => {
      const url = buildSloUrl('slo-123')

      expect(url).toBe('https://app.datadoghq.com/slo/slo-123')
    })

    it('should build SLO URL with US3 site', () => {
      const url = buildSloUrl('slo-456', 'us3.datadoghq.com')

      expect(url).toBe('https://us3.datadoghq.com/slo/slo-456')
    })
  })

  describe('buildIncidentUrl', () => {
    it('should build incident URL', () => {
      const url = buildIncidentUrl('incident-789')

      expect(url).toBe('https://app.datadoghq.com/incidents/incident-789')
    })

    it('should build incident URL with EU site', () => {
      const url = buildIncidentUrl('inc-123', 'datadoghq.eu')

      expect(url).toBe('https://app.datadoghq.eu/incidents/inc-123')
    })
  })

  describe('buildSyntheticUrl', () => {
    it('should build synthetic test URL', () => {
      const url = buildSyntheticUrl('abc-def-123')

      expect(url).toBe('https://app.datadoghq.com/synthetics/details/abc-def-123')
    })

    it('should build synthetic URL with US5 site', () => {
      const url = buildSyntheticUrl('test-456', 'us5.datadoghq.com')

      expect(url).toBe('https://us5.datadoghq.com/synthetics/details/test-456')
    })
  })

  describe('buildNotebookUrl', () => {
    it('should build notebook URL with numeric ID', () => {
      const url = buildNotebookUrl(12345)

      expect(url).toBe('https://app.datadoghq.com/notebook/12345')
    })

    it('should build notebook URL with EU site', () => {
      const url = buildNotebookUrl(67890, 'datadoghq.eu')

      expect(url).toBe('https://app.datadoghq.eu/notebook/67890')
    })
  })

  describe('site fallback behavior', () => {
    it('should fallback to default site for unknown site', () => {
      const url = buildLogsUrl('test', fromSec, toSec, 'unknown.site.com')

      // Should fallback to datadoghq.com
      expect(url).toContain('https://app.datadoghq.com/logs?')
    })

    it('should handle all supported sites', () => {
      const sites = [
        'datadoghq.com',
        'us3.datadoghq.com',
        'us5.datadoghq.com',
        'datadoghq.eu',
        'ap1.datadoghq.com',
        'ddog-gov.com'
      ]

      sites.forEach((site) => {
        const url = buildMonitorUrl(123, site)
        expect(url).toContain('monitors/123')
        expect(url).not.toContain('undefined')
      })
    })
  })

  describe('timestamp conversion', () => {
    it('should convert Unix seconds to milliseconds', () => {
      const url = buildLogsUrl('test', 1000, 2000)

      expect(url).toContain('from_ts=1000000')
      expect(url).toContain('to_ts=2000000')
    })

    it('should handle zero timestamps', () => {
      const url = buildEventsUrl('test', 0, 100)

      expect(url).toContain('from_ts=0')
      expect(url).toContain('to_ts=100000')
    })
  })
})
