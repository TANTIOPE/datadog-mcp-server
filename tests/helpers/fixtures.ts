/**
 * Datadog API response fixtures for testing
 */

// Monitor fixtures
export const monitors = {
  list: [
    {
      id: 12345,
      name: 'High CPU Usage',
      type: 'metric alert',
      query: 'avg(last_5m):avg:system.cpu.user{*} > 90',
      message: 'CPU usage is high',
      tags: ['env:production', 'team:platform'],
      overall_state: 'Alert',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-20T15:30:00.000Z'
    },
    {
      id: 12346,
      name: 'Low Memory Warning',
      type: 'metric alert',
      query: 'avg(last_5m):avg:system.mem.free{*} < 1000000000',
      message: 'Memory is running low',
      tags: ['env:production'],
      overall_state: 'OK',
      created: '2024-01-10T08:00:00.000Z',
      modified: '2024-01-18T12:00:00.000Z'
    }
  ],
  single: {
    id: 12345,
    name: 'High CPU Usage',
    type: 'metric alert',
    query: 'avg(last_5m):avg:system.cpu.user{*} > 90',
    message: 'CPU usage is high',
    tags: ['env:production', 'team:platform'],
    overall_state: 'Alert',
    created: '2024-01-15T10:00:00.000Z',
    modified: '2024-01-20T15:30:00.000Z',
    options: {
      thresholds: { critical: 90, warning: 80 },
      notify_no_data: true
    }
  },
  searchResults: {
    monitors: [
      {
        id: 12345,
        name: 'High CPU Usage',
        status: 'Alert',
        type: 'metric alert',
        tags: ['env:production']
      }
    ],
    metadata: {
      totalCount: 1,
      pageCount: 1,
      page: 0
    }
  }
}

// Dashboard fixtures
export const dashboards = {
  list: {
    dashboards: [
      {
        id: 'abc-123',
        title: 'Production Overview',
        description: 'Main production dashboard',
        layout_type: 'ordered',
        url: '/dashboard/abc-123',
        created_at: '2024-01-01T00:00:00.000Z',
        modified_at: '2024-01-15T00:00:00.000Z',
        author_handle: 'user@example.com'
      },
      {
        id: 'def-456',
        title: 'API Performance',
        description: 'API latency and errors',
        layout_type: 'free',
        url: '/dashboard/def-456',
        created_at: '2024-01-05T00:00:00.000Z',
        modified_at: '2024-01-20T00:00:00.000Z',
        author_handle: 'admin@example.com'
      }
    ]
  },
  single: {
    id: 'abc-123',
    title: 'Production Overview',
    description: 'Main production dashboard',
    layout_type: 'ordered',
    url: '/dashboard/abc-123',
    created_at: '2024-01-01T00:00:00.000Z',
    modified_at: '2024-01-15T00:00:00.000Z',
    author_handle: 'user@example.com',
    widgets: [
      { id: 1, definition: { type: 'timeseries' } },
      { id: 2, definition: { type: 'query_value' } }
    ]
  }
}

// Log fixtures
export const logs = {
  search: {
    data: [
      {
        id: 'log-001',
        attributes: {
          timestamp: '2024-01-20T10:30:00.000Z',
          service: 'web-api',
          host: 'prod-server-1',
          status: 'error',
          message: 'Connection timeout to database',
          tags: ['env:production'],
          attributes: { request_id: 'req-123' }
        }
      },
      {
        id: 'log-002',
        attributes: {
          timestamp: '2024-01-20T10:29:00.000Z',
          service: 'web-api',
          host: 'prod-server-1',
          status: 'info',
          message: 'Request completed successfully',
          tags: ['env:production'],
          attributes: { request_id: 'req-122' }
        }
      }
    ]
  },
  aggregate: {
    data: {
      buckets: [
        { by: { service: 'web-api' }, computes: { c0: 150 } },
        { by: { service: 'auth' }, computes: { c0: 75 } }
      ]
    }
  }
}

// Metrics fixtures
export const metrics = {
  query: {
    series: [
      {
        metric: 'system.cpu.user',
        display_name: 'CPU User',
        pointlist: [
          [1705750800000, 45.5],
          [1705750860000, 48.2],
          [1705750920000, 52.1]
        ],
        scope: 'host:prod-server-1',
        unit: [{ name: 'percent' }]
      }
    ],
    from_date: 1705750800000,
    to_date: 1705751400000
  },
  list: {
    metrics: ['system.cpu.user', 'system.cpu.system', 'system.mem.free', 'system.disk.used']
  },
  search: {
    results: {
      metrics: ['system.cpu.user', 'system.cpu.system']
    }
  },
  metadata: {
    type: 'gauge',
    description: 'Percentage of CPU time spent in user space',
    short_name: 'CPU User',
    unit: 'percent',
    per_unit: null,
    statsd_interval: 10
  }
}

// Traces/Spans fixtures
export const traces = {
  search: {
    data: [
      {
        id: 'span-001',
        attributes: {
          timestamp: 1705750800000000000,
          service: 'web-api',
          resource_name: 'GET /api/users',
          duration: 125000000, // 125ms in ns
          status: 'ok',
          attributes: {
            'http.method': 'GET',
            'http.status_code': 200
          }
        }
      },
      {
        id: 'span-002',
        attributes: {
          timestamp: 1705750860000000000,
          service: 'web-api',
          resource_name: 'POST /api/orders',
          duration: 450000000, // 450ms in ns
          status: 'error',
          attributes: {
            'http.method': 'POST',
            'http.status_code': 500,
            'error.message': 'Database connection failed'
          }
        }
      }
    ]
  },
  aggregate: {
    data: {
      buckets: [
        { by: { service: 'web-api' }, compute: { c0: 100, c1: 150000000 } },
        { by: { service: 'auth' }, compute: { c0: 50, c1: 75000000 } }
      ]
    }
  },
  services: [
    { service_name: 'web-api', dependencies: ['database', 'cache'] },
    { service_name: 'auth', dependencies: ['database'] }
  ]
}

// Events fixtures
export const events = {
  list: {
    events: [
      {
        id: 1001,
        title: 'Deployment started',
        text: 'Deploying version 2.1.0 to production',
        date_happened: 1705750800,
        priority: 'normal',
        source_type_name: 'deployment',
        tags: ['env:production', 'version:2.1.0'],
        alert_type: 'info',
        host: 'deploy-server'
      },
      {
        id: 1002,
        title: 'High error rate detected',
        text: 'Error rate exceeded 5% threshold',
        date_happened: 1705751400,
        priority: 'normal',
        source_type_name: 'monitor',
        tags: ['env:production'],
        alert_type: 'error',
        host: 'prod-server-1'
      }
    ]
  },
  single: {
    event: {
      id: 1001,
      title: 'Deployment started',
      text: 'Deploying version 2.1.0 to production',
      date_happened: 1705750800,
      priority: 'normal',
      source_type_name: 'deployment',
      tags: ['env:production', 'version:2.1.0'],
      alert_type: 'info',
      host: 'deploy-server'
    }
  },
  created: {
    event: {
      id: 1003,
      title: 'Test Event'
    },
    status: 'ok'
  },
  // V2 API fixtures
  searchV2: {
    data: [
      {
        id: 'evt-001',
        attributes: {
          title: '[Triggered on {host:prod-server-1}] High CPU Usage',
          message: 'CPU usage exceeded threshold',
          timestamp: '2024-01-20T10:00:00.000Z',
          tags: ['source:alert', 'alert_type:error', 'host:prod-server-1', 'priority:normal']
        }
      },
      {
        id: 'evt-002',
        attributes: {
          title: '[Recovered on {host:prod-server-1}] High CPU Usage',
          message: 'CPU usage returned to normal',
          timestamp: '2024-01-20T10:15:00.000Z',
          tags: ['source:alert', 'alert_type:success', 'host:prod-server-1', 'priority:normal']
        }
      },
      {
        id: 'evt-003',
        attributes: {
          title: '[P1] [Triggered on {service:api}] High Error Rate',
          message: 'Error rate exceeded 5%',
          timestamp: '2024-01-20T11:00:00.000Z',
          tags: ['source:alert', 'alert_type:error', 'priority:normal']
        }
      },
      {
        id: 'evt-004',
        attributes: {
          title: '[Triggered on {host:prod-server-2}] High Memory Usage',
          message: 'Memory usage exceeded threshold',
          timestamp: '2024-01-20T12:00:00.000Z',
          tags: ['source:alert', 'alert_type:error', 'host:prod-server-2', 'priority:normal']
        }
      }
    ],
    meta: {
      page: {
        after: null
      }
    }
  },
  searchV2MultiPage: {
    page1: {
      data: [
        {
          id: 'evt-001',
          attributes: {
            title: '[Triggered on {host:prod-server-1}] High CPU Usage',
            message: 'CPU usage exceeded threshold',
            timestamp: '2024-01-20T10:00:00.000Z',
            tags: ['source:alert', 'alert_type:error', 'host:prod-server-1', 'priority:normal']
          }
        }
      ],
      meta: {
        page: {
          after: 'cursor_page2'
        }
      }
    },
    page2: {
      data: [
        {
          id: 'evt-002',
          attributes: {
            title: '[Triggered on {host:prod-server-2}] High Memory Usage',
            message: 'Memory exceeded threshold',
            timestamp: '2024-01-20T11:00:00.000Z',
            tags: ['source:alert', 'alert_type:error', 'host:prod-server-2', 'priority:normal']
          }
        }
      ],
      meta: {
        page: {
          after: null
        }
      }
    }
  },
  // Fixtures for aggregate/timeseries/incidents testing
  searchV2ForAggregation: {
    data: [
      {
        id: 'evt-agg-001',
        attributes: {
          title: '[Triggered on {host:prod-1}] High CPU Usage',
          message: 'CPU usage exceeded threshold',
          timestamp: '2024-01-20T10:00:00.000Z',
          tags: ['source:alert', 'alert_type:error', 'host:prod-1', 'priority:normal']
        }
      },
      {
        id: 'evt-agg-002',
        attributes: {
          title: '[Triggered on {host:prod-2}] High CPU Usage',
          message: 'CPU usage exceeded threshold',
          timestamp: '2024-01-20T10:05:00.000Z',
          tags: ['source:alert', 'alert_type:error', 'host:prod-2', 'priority:normal']
        }
      },
      {
        id: 'evt-agg-003',
        attributes: {
          title: '[Triggered on {host:prod-1}] Low Memory',
          message: 'Memory running low',
          timestamp: '2024-01-20T11:00:00.000Z',
          tags: ['source:alert', 'alert_type:warning', 'host:prod-1', 'priority:normal']
        }
      },
      {
        id: 'evt-agg-004',
        attributes: {
          title: '[Recovered on {host:prod-1}] High CPU Usage',
          message: 'CPU usage returned to normal',
          timestamp: '2024-01-20T10:30:00.000Z',
          tags: ['source:alert', 'alert_type:success', 'host:prod-1', 'priority:normal']
        }
      },
      {
        id: 'evt-agg-005',
        attributes: {
          title: '[Triggered on {host:prod-3}] High CPU Usage',
          message: 'CPU usage exceeded threshold',
          timestamp: '2024-01-20T12:00:00.000Z',
          tags: ['source:alert', 'alert_type:error', 'host:prod-3', 'priority:normal']
        }
      }
    ],
    meta: {
      page: {
        after: null
      }
    }
  }
}

// P2 Tools Fixtures

// Hosts fixtures
export const hosts = {
  list: {
    host_list: [
      {
        name: 'prod-server-1',
        id: 123456,
        aliases: ['i-abc123', 'prod-server-1.ec2.internal'],
        apps: ['nginx', 'node'],
        aws_name: 'prod-server-1',
        host_name: 'prod-server-1',
        is_muted: false,
        meta: {
          platform: 'linux',
          processor: 'x86_64',
          agent_version: '7.45.0'
        },
        mute_timeout: null,
        sources: ['aws', 'agent'],
        tags_by_source: {
          Datadog: ['env:production', 'role:web'],
          AWS: ['instance-type:t3.large']
        },
        up: true,
        last_reported_time: 1705751400
      },
      {
        name: 'prod-server-2',
        id: 123457,
        aliases: ['i-def456'],
        apps: ['nginx'],
        host_name: 'prod-server-2',
        is_muted: true,
        mute_timeout: 1705837800,
        sources: ['aws', 'agent'],
        up: true,
        last_reported_time: 1705751380
      }
    ],
    total_matching: 2,
    total_returned: 2
  },
  totals: {
    total_active: 50,
    total_up: 48
  },
  mute: {
    hostname: 'prod-server-1',
    action: 'Muted',
    message: 'Maintenance window',
    end: 1705837800
  }
}

// Downtimes fixtures
export const downtimes = {
  list: {
    data: [
      {
        id: 'dt-001',
        type: 'downtime',
        attributes: {
          display_timezone: 'UTC',
          message: 'Scheduled maintenance window',
          monitor_identifier: {
            monitor_id: 12345,
            monitor_tags: ['env:production']
          },
          scope: 'env:production',
          status: 'active',
          schedule: {
            start: '2024-01-20T10:00:00Z',
            end: '2024-01-20T12:00:00Z'
          },
          created_at: '2024-01-15T10:00:00Z',
          modified_at: '2024-01-15T10:00:00Z'
        }
      },
      {
        id: 'dt-002',
        type: 'downtime',
        attributes: {
          display_timezone: 'America/New_York',
          message: 'Database migration',
          monitor_identifier: {
            monitor_tags: ['service:database']
          },
          scope: 'service:database',
          status: 'scheduled',
          schedule: {
            start: '2024-01-25T02:00:00Z',
            end: '2024-01-25T04:00:00Z'
          },
          created_at: '2024-01-18T15:00:00Z',
          modified_at: '2024-01-18T15:00:00Z'
        }
      }
    ]
  },
  single: {
    data: {
      id: 'dt-001',
      type: 'downtime',
      attributes: {
        display_timezone: 'UTC',
        message: 'Scheduled maintenance window',
        monitor_identifier: {
          monitor_id: 12345,
          monitor_tags: ['env:production']
        },
        scope: 'env:production',
        status: 'active',
        schedule: {
          start: '2024-01-20T10:00:00Z',
          end: '2024-01-20T12:00:00Z'
        },
        created_at: '2024-01-15T10:00:00Z',
        modified_at: '2024-01-15T10:00:00Z'
      }
    }
  },
  created: {
    data: {
      id: 'dt-003',
      type: 'downtime',
      attributes: {
        scope: 'env:staging',
        status: 'scheduled'
      }
    }
  }
}

// SLOs fixtures
export const slos = {
  list: {
    data: [
      {
        id: 'slo-001',
        name: 'API Availability',
        description: '99.9% availability for production API',
        type: 'metric',
        thresholds: [{ target: 99.9, warning: 99.95, timeframe: '30d' }],
        tags: ['service:api', 'env:production'],
        overall_status: [{ sli_value: 99.95, error_budget_remaining: 75.5, state: 'OK' }],
        created_at: 1704067200,
        modified_at: 1705276800
      },
      {
        id: 'slo-002',
        name: 'Payment Processing Latency',
        description: 'P99 latency under 500ms',
        type: 'monitor',
        thresholds: [{ target: 99.5, timeframe: '7d' }],
        tags: ['service:payments', 'env:production'],
        overall_status: [{ sli_value: 98.2, error_budget_remaining: -26.0, state: 'breached' }],
        created_at: 1704153600,
        modified_at: 1705363200
      }
    ]
  },
  single: {
    data: {
      id: 'slo-001',
      name: 'API Availability',
      description: '99.9% availability for production API',
      type: 'metric',
      thresholds: [{ target: 99.9, warning: 99.95, timeframe: '30d' }],
      tags: ['service:api', 'env:production'],
      overall_status: [{ sli_value: 99.95, error_budget_remaining: 75.5, state: 'OK' }],
      created_at: 1704067200,
      modified_at: 1705276800
    }
  },
  history: {
    data: {
      from_ts: 1705622400,
      to_ts: 1705881600,
      type: 'metric',
      type_id: 1,
      overall: {
        sli_value: 99.95,
        span_precision: 2,
        uptime: 99.95
      },
      series: {
        res_type: 'time_series',
        resp_version: 2,
        interval: 86400,
        query: 'sum:requests.success{*}.as_count(),sum:requests.total{*}.as_count()',
        numerator: { sum: 3997, count: 4, values: [1000, 999, 1000, 998] },
        denominator: { sum: 4000, count: 4, values: [1000, 1000, 1000, 1000] },
        times: [1705622400, 1705708800, 1705795200, 1705881600]
      },
      thresholds: { '30d': { target: 99.9, timeframe: '30d' } }
    }
  },
  created: {
    data: [
      {
        id: 'slo-003',
        name: 'New SLO',
        type: 'metric',
        thresholds: [{ target: 99.9, timeframe: '30d' }]
      }
    ]
  },
  deleted: {
    data: [{ id: 'slo-001' }]
  }
}

// Incidents fixtures
export const incidents = {
  list: {
    data: [
      {
        id: 'inc-001',
        type: 'incidents',
        attributes: {
          title: 'Database connection failures',
          state: 'active',
          severity: 'SEV-2',
          customer_impact_scope: 'Partial service degradation',
          customer_impacted: true,
          created: '2024-01-20T10:00:00Z',
          modified: '2024-01-20T10:30:00Z',
          resolved: null,
          time_to_detect: 300,
          time_to_repair: null
        },
        relationships: {
          commander_user: { data: { id: 'user-123', type: 'users' } }
        }
      },
      {
        id: 'inc-002',
        type: 'incidents',
        attributes: {
          title: 'API latency spike',
          state: 'resolved',
          severity: 'SEV-3',
          customer_impact_scope: null,
          customer_impacted: false,
          created: '2024-01-19T14:00:00Z',
          modified: '2024-01-19T16:00:00Z',
          resolved: '2024-01-19T15:30:00Z',
          time_to_detect: 180,
          time_to_repair: 5400
        }
      }
    ]
  },
  single: {
    data: {
      id: 'inc-001',
      type: 'incidents',
      attributes: {
        title: 'Database connection failures',
        state: 'active',
        severity: 'SEV-2',
        customer_impact_scope: 'Partial service degradation',
        customer_impacted: true,
        created: '2024-01-20T10:00:00Z',
        modified: '2024-01-20T10:30:00Z'
      }
    }
  },
  search: {
    data: {
      attributes: {
        facets: {
          fields: [],
          state: []
        },
        incidents: [
          {
            data: {
              id: 'inc-001',
              type: 'incidents',
              attributes: {
                title: 'Database connection failures',
                state: 'active',
                customer_impacted: true,
                created: '2024-01-20T10:00:00Z',
                modified: '2024-01-20T10:30:00Z'
              }
            }
          },
          {
            data: {
              id: 'inc-002',
              type: 'incidents',
              attributes: {
                title: 'API latency spike',
                state: 'resolved',
                customer_impacted: false,
                created: '2024-01-19T14:00:00Z',
                modified: '2024-01-19T16:00:00Z'
              }
            }
          }
        ],
        total: 2
      },
      type: 'incidents_search'
    },
    meta: {
      pagination: { size: 2 }
    }
  },
  created: {
    data: {
      id: 'inc-003',
      type: 'incidents',
      attributes: {
        title: 'New Incident',
        state: 'active',
        customer_impacted: false,
        created: '2024-01-20T12:00:00Z',
        modified: '2024-01-20T12:00:00Z'
      }
    }
  }
}

// Synthetics fixtures
export const synthetics = {
  list: {
    tests: [
      {
        public_id: 'abc-123-xyz',
        name: 'API Health Check',
        type: 'api',
        subtype: 'http',
        status: 'live',
        message: 'API endpoint availability check',
        tags: ['env:production', 'team:platform'],
        locations: ['aws:us-east-1', 'aws:eu-west-1'],
        monitor_id: 12345,
        created_at: '2024-01-10T10:00:00Z',
        modified_at: '2024-01-15T12:00:00Z'
      },
      {
        public_id: 'def-456-uvw',
        name: 'Login Flow Test',
        type: 'browser',
        subtype: null,
        status: 'live',
        message: 'User login flow validation',
        tags: ['env:production', 'team:frontend'],
        locations: ['aws:us-east-1'],
        monitor_id: 12346,
        created_at: '2024-01-12T08:00:00Z',
        modified_at: '2024-01-18T14:00:00Z'
      }
    ]
  },
  apiTest: {
    public_id: 'abc-123-xyz',
    name: 'API Health Check',
    type: 'api',
    subtype: 'http',
    status: 'live',
    message: 'API endpoint availability check',
    tags: ['env:production', 'team:platform'],
    locations: ['aws:us-east-1', 'aws:eu-west-1'],
    monitor_id: 12345,
    config: {
      request: {
        method: 'GET',
        url: 'https://api.example.com/health'
      },
      assertions: [{ type: 'statusCode', operator: 'is', target: 200 }]
    },
    options: {
      tick_every: 300
    },
    created_at: '2024-01-10T10:00:00Z',
    modified_at: '2024-01-15T12:00:00Z'
  },
  browserTest: {
    public_id: 'def-456-uvw',
    name: 'Login Flow Test',
    type: 'browser',
    status: 'live',
    message: 'User login flow validation',
    tags: ['env:production', 'team:frontend'],
    locations: ['aws:us-east-1'],
    monitor_id: 12346,
    config: {
      request: {
        method: 'GET',
        url: 'https://example.com/login'
      },
      assertions: []
    },
    options: {
      tick_every: 900
    },
    created_at: '2024-01-12T08:00:00Z',
    modified_at: '2024-01-18T14:00:00Z'
  },
  triggerResults: {
    results: [
      { public_id: 'abc-123-xyz', result_id: 'result-001' },
      { public_id: 'def-456-uvw', result_id: 'result-002' }
    ]
  },
  apiResults: {
    results: [
      {
        result_id: 'result-001',
        result: { passed: true, timings: { total: 125.5 } },
        check_time: 1705751400
      },
      {
        result_id: 'result-002',
        result: { passed: false, timings: { total: 5000.0 } },
        check_time: 1705751340
      }
    ]
  },
  browserResults: {
    results: [
      {
        result_id: 'result-003',
        result: { passed: true, duration: 8500 },
        check_time: 1705751400
      }
    ]
  },
  created: {
    public_id: 'new-test-123',
    name: 'New Test',
    type: 'api',
    status: 'paused',
    message: '',
    config: {
      request: {
        method: 'GET',
        url: 'https://api.example.com/test'
      },
      assertions: []
    },
    options: {
      tick_every: 300
    },
    locations: ['aws:us-east-1']
  }
}

// P3 Tools Fixtures

// Users fixtures
export const users = {
  list: {
    data: [
      {
        id: 'user-001',
        type: 'users',
        attributes: {
          name: 'John Doe',
          handle: 'john.doe@example.com',
          email: 'john.doe@example.com',
          title: 'Senior Engineer',
          status: 'Active',
          verified: true,
          disabled: false,
          created_at: '2024-01-01T00:00:00Z',
          modified_at: '2024-01-15T00:00:00Z'
        }
      },
      {
        id: 'user-002',
        type: 'users',
        attributes: {
          name: 'Jane Smith',
          handle: 'jane.smith@example.com',
          email: 'jane.smith@example.com',
          title: 'DevOps Lead',
          status: 'Active',
          verified: true,
          disabled: false,
          created_at: '2024-01-05T00:00:00Z',
          modified_at: '2024-01-18T00:00:00Z'
        }
      }
    ]
  },
  single: {
    data: {
      id: 'user-001',
      type: 'users',
      attributes: {
        name: 'John Doe',
        handle: 'john.doe@example.com',
        email: 'john.doe@example.com',
        title: 'Senior Engineer',
        status: 'Active',
        verified: true,
        disabled: false,
        created_at: '2024-01-01T00:00:00Z',
        modified_at: '2024-01-15T00:00:00Z'
      }
    }
  }
}

// Teams fixtures
export const teams = {
  list: {
    data: [
      {
        id: 'team-001',
        type: 'team',
        attributes: {
          name: 'Platform Team',
          handle: 'platform-team',
          description: 'Core platform engineering team',
          summary: 'Responsible for infrastructure',
          link_count: 5,
          user_count: 8,
          created_at: '2024-01-01T00:00:00Z',
          modified_at: '2024-01-15T00:00:00Z'
        }
      },
      {
        id: 'team-002',
        type: 'team',
        attributes: {
          name: 'Frontend Team',
          handle: 'frontend-team',
          description: 'Web application development',
          summary: 'UI/UX development',
          link_count: 3,
          user_count: 5,
          created_at: '2024-01-05T00:00:00Z',
          modified_at: '2024-01-18T00:00:00Z'
        }
      }
    ]
  },
  single: {
    data: {
      id: 'team-001',
      type: 'team',
      attributes: {
        name: 'Platform Team',
        handle: 'platform-team',
        description: 'Core platform engineering team',
        summary: 'Responsible for infrastructure',
        link_count: 5,
        user_count: 8,
        created_at: '2024-01-01T00:00:00Z',
        modified_at: '2024-01-15T00:00:00Z'
      }
    }
  },
  members: {
    data: [
      {
        id: 'member-001',
        type: 'team_memberships',
        attributes: {
          role: 'admin'
        },
        relationships: {
          user: { data: { id: 'user-001', type: 'users' } }
        }
      },
      {
        id: 'member-002',
        type: 'team_memberships',
        attributes: {
          role: 'member'
        },
        relationships: {
          user: { data: { id: 'user-002', type: 'users' } }
        }
      }
    ]
  }
}

// RUM fixtures
export const rum = {
  applications: {
    data: [
      {
        id: 'app-001',
        type: 'rum_application',
        attributes: {
          application_id: 'app-001',
          client_token: 'pub1234567890abcdef',
          name: 'Production Web App',
          type: 'browser',
          org_id: 123456,
          hash: 'abc123',
          created_at: 1704067200000,
          created_by_handle: 'user@example.com',
          updated_at: 1705276800000,
          updated_by_handle: 'user@example.com'
        }
      },
      {
        id: 'app-002',
        type: 'rum_application',
        attributes: {
          application_id: 'app-002',
          client_token: 'pub0987654321fedcba',
          name: 'Mobile App iOS',
          type: 'ios',
          org_id: 123456,
          hash: 'def456',
          created_at: 1704412800000,
          created_by_handle: 'admin@example.com',
          updated_at: 1705536000000,
          updated_by_handle: 'admin@example.com'
        }
      }
    ]
  },
  events: {
    data: [
      {
        id: 'event-001',
        type: 'rum_event',
        attributes: {
          timestamp: '2024-01-20T10:00:00Z',
          attributes: {
            application: { id: 'app-001', name: 'Production Web App' },
            session: { id: 'session-001', type: 'user' },
            view: {
              id: 'view-001',
              url: 'https://example.com/dashboard',
              url_path: '/dashboard',
              name: 'Dashboard'
            },
            usr: { id: 'user-123', email: 'user@example.com', name: 'Test User' }
          }
        }
      }
    ]
  },
  aggregate: {
    data: {
      buckets: [
        { by: { '@view.url_path': '/dashboard' }, computes: { c0: 500 } },
        { by: { '@view.url_path': '/profile' }, computes: { c0: 250 } }
      ]
    },
    meta: { elapsed: 150 }
  },
  performance: {
    data: {
      buckets: [
        {
          by: {},
          computes: {
            c0: { value: 2500000000 }, // LCP avg in nanoseconds
            c1: { value: 3000000000 }, // LCP p75
            c2: { value: 4000000000 }, // LCP p90
            c3: { value: 1500000000 }, // FCP avg
            c4: { value: 2000000000 }, // FCP p75
            c5: { value: 2500000000 }, // FCP p90
            c6: { value: 0.05 }, // CLS avg
            c7: { value: 0.1 }, // CLS p75
            c8: { value: 50000000 }, // FID avg
            c9: { value: 100000000 }, // FID p75
            c10: { value: 150000000 }, // FID p90
            c11: { value: 3000000000 }, // loading_time avg
            c12: { value: 4000000000 }, // loading_time p75
            c13: { value: 5000000000 } // loading_time p90
          }
        }
      ]
    },
    meta: { elapsed: 200 }
  },
  waterfall: {
    data: [
      {
        id: 'event-view-001',
        type: 'rum_event',
        attributes: {
          timestamp: '2024-01-20T10:00:00Z',
          attributes: {
            type: 'view',
            application: { id: 'app-001', name: 'Production Web App' },
            session: { id: 'session-001', type: 'user' },
            view: {
              id: 'view-001',
              url: 'https://example.com/dashboard',
              name: 'Dashboard',
              loading_time: 2500000000
            }
          }
        }
      },
      {
        id: 'event-resource-001',
        type: 'rum_event',
        attributes: {
          timestamp: '2024-01-20T10:00:01Z',
          attributes: {
            type: 'resource',
            application: { id: 'app-001', name: 'Production Web App' },
            session: { id: 'session-001', type: 'user' },
            view: { id: 'view-001', url: 'https://example.com/dashboard', name: 'Dashboard' },
            resource: {
              url: 'https://cdn.example.com/app.js',
              type: 'js',
              duration: 150000000,
              size: 256000,
              status_code: 200
            }
          }
        }
      },
      {
        id: 'event-resource-002',
        type: 'rum_event',
        attributes: {
          timestamp: '2024-01-20T10:00:02Z',
          attributes: {
            type: 'resource',
            application: { id: 'app-001', name: 'Production Web App' },
            session: { id: 'session-001', type: 'user' },
            view: { id: 'view-001', url: 'https://example.com/dashboard', name: 'Dashboard' },
            resource: {
              url: 'https://cdn.example.com/styles.css',
              type: 'css',
              duration: 80000000,
              size: 45000,
              status_code: 200
            }
          }
        }
      },
      {
        id: 'event-action-001',
        type: 'rum_event',
        attributes: {
          timestamp: '2024-01-20T10:00:05Z',
          attributes: {
            type: 'action',
            application: { id: 'app-001', name: 'Production Web App' },
            session: { id: 'session-001', type: 'user' },
            view: { id: 'view-001', url: 'https://example.com/dashboard', name: 'Dashboard' },
            action: { id: 'action-001', type: 'click', name: 'Login Button', target: '#login-btn' }
          }
        }
      }
    ]
  }
}

// Security fixtures
export const security = {
  rules: {
    data: [
      {
        id: 'rule-001',
        name: 'Brute Force Detection',
        type: 'log_detection',
        isEnabled: true,
        hasExtendedTitle: false,
        message: 'Multiple failed login attempts detected',
        tags: ['security', 'auth'],
        createdAt: 1704067200000,
        updatedAt: 1705276800000,
        creationAuthorId: 12345,
        isDefault: false,
        isDeleted: false,
        filters: [{ action: 'require', query: 'status:error' }]
      },
      {
        id: 'rule-002',
        name: 'Suspicious API Access',
        type: 'workload_security',
        isEnabled: true,
        hasExtendedTitle: true,
        message: 'Unusual API access pattern detected',
        tags: ['security', 'api'],
        createdAt: 1704153600000,
        updatedAt: 1705363200000,
        creationAuthorId: 12346,
        isDefault: true,
        isDeleted: false,
        filters: []
      }
    ]
  },
  singleRule: {
    id: 'rule-001',
    name: 'Brute Force Detection',
    type: 'log_detection',
    isEnabled: true,
    hasExtendedTitle: false,
    message: 'Multiple failed login attempts detected',
    tags: ['security', 'auth'],
    createdAt: 1704067200000,
    updatedAt: 1705276800000
  },
  signals: {
    data: [
      {
        id: 'signal-001',
        type: 'security_signal',
        attributes: {
          timestamp: '2024-01-20T10:00:00Z',
          message: 'Brute force attack detected',
          tags: ['severity:high', 'source:auth'],
          custom: { ip: '192.168.1.100' }
        }
      },
      {
        id: 'signal-002',
        type: 'security_signal',
        attributes: {
          timestamp: '2024-01-20T09:30:00Z',
          message: 'Suspicious API access',
          tags: ['severity:medium', 'source:api'],
          custom: { endpoint: '/api/admin' }
        }
      }
    ],
    meta: { page: { after: null } }
  }
}

// Notebooks fixtures
export const notebooks = {
  list: {
    data: [
      {
        id: 1001,
        type: 'notebooks',
        attributes: {
          name: 'Incident Runbook',
          author: { handle: 'admin@example.com', name: 'Admin User' },
          status: 'published',
          cells: [
            {
              id: 'cell-001',
              type: 'notebook_cells',
              attributes: { definition: { type: 'markdown', text: '# Runbook' } }
            }
          ],
          time: { live_span: '1h' },
          created: '2024-01-10T00:00:00Z',
          modified: '2024-01-15T00:00:00Z',
          metadata: { is_template: false, take_snapshots: true, type: 'investigation' }
        }
      },
      {
        id: 1002,
        type: 'notebooks',
        attributes: {
          name: 'Performance Analysis',
          author: { handle: 'engineer@example.com', name: 'Engineer' },
          status: 'published',
          cells: [
            {
              id: 'cell-002',
              type: 'notebook_cells',
              attributes: { definition: { type: 'markdown', text: '# Analysis' } }
            }
          ],
          time: { live_span: '4h' },
          created: '2024-01-12T00:00:00Z',
          modified: '2024-01-18T00:00:00Z',
          metadata: { is_template: true, take_snapshots: false, type: 'investigation' }
        }
      }
    ],
    meta: { page: { total_count: 2, total_filtered_count: 2 } }
  },
  single: {
    data: {
      id: 1001,
      type: 'notebooks',
      attributes: {
        name: 'Incident Runbook',
        author: { handle: 'admin@example.com', name: 'Admin User' },
        status: 'published',
        cells: [
          {
            id: 'cell-001',
            type: 'notebook_cells',
            attributes: { definition: { type: 'markdown', text: '# Runbook' } }
          },
          {
            id: 'cell-002',
            type: 'notebook_cells',
            attributes: { definition: { type: 'timeseries' } }
          }
        ],
        time: { live_span: '1h' },
        created: '2024-01-10T00:00:00Z',
        modified: '2024-01-15T00:00:00Z',
        metadata: { is_template: false, take_snapshots: true, type: 'investigation' }
      }
    }
  },
  created: {
    data: {
      id: 1003,
      type: 'notebooks',
      attributes: {
        name: 'New Notebook',
        author: { handle: 'admin@example.com', name: 'Admin User' },
        status: 'published',
        cells: [
          {
            id: 'cell-001',
            type: 'notebook_cells',
            attributes: { definition: { type: 'markdown', text: '# New' } }
          }
        ],
        time: { live_span: '1h' },
        created: '2024-01-20T00:00:00Z',
        modified: '2024-01-20T00:00:00Z',
        metadata: { is_template: false, take_snapshots: true, type: 'investigation' }
      }
    }
  },
  updated: {
    data: {
      id: 1001,
      type: 'notebooks',
      attributes: {
        name: 'Updated Notebook',
        author: { handle: 'admin@example.com', name: 'Admin User' },
        status: 'published',
        cells: [
          {
            id: 'cell-001',
            type: 'notebook_cells',
            attributes: { definition: { type: 'markdown', text: '# Updated' } }
          }
        ],
        time: { live_span: '1h' },
        created: '2024-01-10T00:00:00Z',
        modified: '2024-01-20T00:00:00Z',
        metadata: { is_template: false, take_snapshots: true, type: 'investigation' }
      }
    }
  }
}

// P4 Tools Fixtures

// Tags fixtures
export const tags = {
  list: {
    tags: {
      'host-001': ['env:production', 'role:web', 'team:platform'],
      'host-002': ['env:staging', 'role:api', 'team:backend'],
      'host-003': ['env:production', 'role:database']
    }
  },
  hostTags: {
    tags: ['env:production', 'role:web', 'team:platform'],
    host: 'host-001'
  },
  created: {
    tags: ['env:production', 'role:web', 'team:platform'],
    host: 'host-001'
  }
}

// Auth fixtures
export const auth = {
  valid: {
    valid: true
  },
  invalid: {
    valid: false
  }
}

// Usage fixtures
export const usage = {
  summary: {
    start_date: '2024-01-01T00:00:00Z',
    end_date: '2024-01-31T00:00:00Z',
    apm_host_top99p_sum: 50,
    infra_host_top99p_sum: 100,
    usage: [
      {
        date: '2024-01-15T00:00:00Z',
        apm_host_top99p: 48,
        infra_host_top99p: 95,
        indexed_events_count_sum: 1000000,
        ingested_events_bytes_sum: 5000000000
      }
    ]
  },
  hosts: {
    usage: [
      {
        hour: '2024-01-20T10:00:00Z',
        agent_host_count: 45,
        aws_host_count: 30,
        azure_host_count: 10,
        gcp_host_count: 5,
        host_count: 90,
        container_count: 200
      }
    ]
  },
  logs: {
    usage: [
      {
        hour: '2024-01-20T10:00:00Z',
        indexed_events_count: 500000,
        logs_rehydrated_indexed_count: 10000
      }
    ]
  },
  timeseries: {
    usage: [
      {
        hour: '2024-01-20T10:00:00Z',
        num_custom_timeseries: 15000
      }
    ]
  },
  indexedSpans: {
    usage: [
      {
        hour: '2024-01-20T10:00:00Z',
        indexed_events_count: 100000
      }
    ]
  },
  ingestedSpans: {
    usage: [
      {
        hour: '2024-01-20T10:00:00Z',
        ingested_traces_bytes: 2000000000
      }
    ]
  }
}
