# Datadog MCP Server

[![Quality gate](https://sonarcloud.io/api/project_badges/quality_gate?project=TANTIOPE_datadog-mcp-server)](https://sonarcloud.io/summary/new_code?id=TANTIOPE_datadog-mcp-server)
[![CI/Release](https://github.com/tantiope/datadog-mcp-server/actions/workflows/release.yml/badge.svg)](https://github.com/tantiope/datadog-mcp-server/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/datadog-mcp)](https://www.npmjs.com/package/datadog-mcp)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=TANTIOPE_datadog-mcp-server&metric=coverage)](https://sonarcloud.io/summary/new_code?id=TANTIOPE_datadog-mcp-server)

> **DISCLAIMER**: This is a community-maintained project and is not officially affiliated with, endorsed by, or supported by Datadog, Inc. This MCP server utilizes the Datadog API but is developed independently.

MCP server providing AI assistants with full Datadog observability access. Features grep-like log search, APM trace filtering with duration/status/error queries, smart sampling modes for token efficiency, and cross-correlation between logs, traces, and metrics.

## Configuration

### Required Environment Variables

```bash
DD_API_KEY=your-api-key
DD_APP_KEY=your-app-key
```

### Optional Environment Variables

```bash
DD_SITE=datadoghq.com  # Default. Use datadoghq.eu for EU, etc.

# Limit defaults (fallbacks when AI doesn't specify)
MCP_DEFAULT_LIMIT=50              # General tools default limit
MCP_DEFAULT_LOG_LINES=200         # Logs tool default limit
MCP_DEFAULT_METRIC_POINTS=1000    # Metrics timeseries data points
MCP_DEFAULT_TIME_RANGE=24         # Default time range in hours
```

### Optional Flags

```bash
--site=datadoghq.com     # Datadog site (overrides DD_SITE)
--transport=stdio|http   # Transport mode (default: stdio)
--port=3000              # HTTP port when using http transport
--host=0.0.0.0           # HTTP host when using http transport
--read-only              # Block all write operations
--disable-tools=synthetics,rum,security    # Comma-separated list of tools to disable
```

## Usage

### Claude Desktop / VS Code / Cursor

```json
{
  "mcpServers": {
    "datadog": {
      "command": "npx",
      "args": ["-y", "datadog-mcp"],
      "env": {
        "DD_API_KEY": "your-api-key",
        "DD_APP_KEY": "your-app-key",
        "DD_SITE": "datadoghq.com"
      }
    }
  }
}
```

### Docker

```json
{
  "mcpServers": {
    "datadog": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "DD_API_KEY",
        "-e", "DD_APP_KEY",
        "-e", "DD_SITE",
        "ghcr.io/tantiope/datadog-mcp"
      ],
      "env": {
        "DD_API_KEY": "your-api-key",
        "DD_APP_KEY": "your-app-key",
        "DD_SITE": "datadoghq.com"
      }
    }
  }
}
```

### Kubernetes

**Use environment variables instead of container args:**

```yaml
env:
  - name: DD_API_KEY
    value: "your-api-key"
  - name: DD_APP_KEY
    value: "your-app-key"
  - name: MCP_TRANSPORT
    value: "http"
  - name: MCP_PORT
    value: "3000"
  - name: MCP_HOST
    value: "0.0.0.0"
```

> **Note:** Kubernetes `args:` replaces the entire Dockerfile CMD, causing Node.js to receive the flags instead of your application. Environment variables avoid this issue.

### HTTP Transport

When running with `--transport=http`:

- `POST /mcp` — MCP protocol endpoint
- `GET /mcp` — SSE stream for responses
- `DELETE /mcp` — Close session
- `GET /health` — Health check

## Tools

| Tool | Action | Category | Description | Required Scopes |
|------|--------|----------|-------------|-----------------|
| `monitors` | list | Alerting | List monitors with optional filters | `monitors_read` |
| `monitors` | get | Alerting | Get monitor by ID | `monitors_read` |
| `monitors` | search | Alerting | Search monitors by query | `monitors_read` |
| `monitors` | create | Alerting | Create a new monitor; `config` is validated against a typed schema covering documented options (notifyNoData, renotifyInterval, thresholds, …) — unknown keys surface in `warnings`. Pass `dry_run: true` to validate without creating (uses `/api/v1/monitor/validate`, allowed in read-only mode). | `monitors_write` |
| `monitors` | update | Alerting | Update an existing monitor; same validated schema as `create`; partial configs accepted; validation errors short-circuit before any HTTP call as `EINVALID_MONITOR_CONFIG:` | `monitors_write` |
| `monitors` | preview | Alerting | Render a monitor template (inline `message` or by `monitor_id`/`id`) with optional `context` of variables and conditionals. Returns `{rendered, variablesUsed, variablesMissing, conditionalsResolved}`. Supports Datadog Mustache subset: variable substitution + six documented conditionals (`is_alert`, `is_warning`, `is_no_data`, `is_recovery`, `is_alert_to_warning`, `is_warning_to_alert`); `{{#each}}`/partials throw `EUNSUPPORTED_TEMPLATE_SYNTAX`. Read-only. | `monitors_read` |
| `monitors` | test_notification | Alerting | **Known limitation**: returns `ENOT_SUPPORTED` — Datadog has no public REST endpoint for triggering a test notification. Documentation pointer in response. | n/a |
| `monitors` | delete | Alerting | Delete a monitor | `monitors_write` |
| `monitors` | mute | Alerting | Mute a monitor | `monitors_write` |
| `monitors` | unmute | Alerting | Unmute a monitor | `monitors_write` |
| `monitors` | top | Alerting | Top N monitors by alert frequency with real monitor names and context breakdown. **WARNING:** `total_count` includes renotifies/re-evaluations (Datadog emits a renotify event every `renotify_interval` minutes while Alert). For real fires use `action=history`. | `monitors_read` |
| `monitors` | history | Alerting | Count and list real state transitions for one monitor over a time window. Filters by `transitionType` (default `["alert","alert recovery"]` — fires+recoveries, excludes renotifies) and optional `group`. Returns `{transitions: [...], count, meta}` where `count` is the number of real transitions (e.g. for one always-Alert burn-rate monitor over 7d: 98 raw events vs **38 real transitions**). | `monitors_read`, `events_read` |
| `dashboards` | list | Visualization | List all dashboards | `dashboards_read` |
| `dashboards` | get | Visualization | Get dashboard by ID | `dashboards_read` |
| `dashboards` | create | Visualization | Create a new dashboard | `dashboards_write` |
| `dashboards` | update | Visualization | Update a dashboard | `dashboards_write` |
| `dashboards` | delete | Visualization | Delete a dashboard | `dashboards_write` |
| `logs` | search | Logs | Search logs with query syntax and filters | `logs_read_data`, `logs_read_index_data` |
| `logs` | aggregate | Logs | Aggregate log data with groupBy | `logs_read_data` |
| `logs_pipelines` | list, get | Logs Config | Inspect log processing pipelines and their processors | `logs_read_config` |
| `logs_pipelines` | create, update, delete, reorder | Logs Config | Author pipelines and processor chains | `logs_write_config` |
| `logs_pipelines` | get_order | Logs Config | Read pipeline evaluation order | `logs_read_config` |
| `logs_indexes` | list, get | Logs Config | Inspect indexes (filter, retention, Flex tier, exclusion filters); `create`/`delete` are UI-only per Datadog and not exposed | `logs_read_config` |
| `logs_indexes` | update, reorder | Logs Config | Update index filter/retention/quota and reorder evaluation | `logs_write_config` |
| `logs_indexes` | get_order | Logs Config | Read index evaluation order | `logs_read_config` |
| `logs_archives` | list, get | Logs Config | Inspect log archives (S3 / GCS / Azure destinations); per-provider credential fields are forwarded unchanged | `logs_read_archives` |
| `logs_archives` | create, update, delete, reorder | Logs Config | Manage archive destinations; `destination.type` validated against `s3 | gcs | azure_storage` before SDK call | `logs_write_archives` |
| `logs_archives` | get_order | Logs Config | Read archive evaluation order | `logs_read_archives` |
| `metrics` | query | Metrics | Query timeseries data. Response `meta` now includes `rollupRequested` (parsed from `rollup(method, seconds)` in the query, with `methodInferred` flag), `rollupEffective` (interval derived from returned pointlist intervals + deduped `intervalsObserved` for multi-series), and `rollupOverridden: boolean` so callers can detect when Datadog silently downsampled. | `metrics_read`, `timeseries_query` |
| `metrics` | search | Metrics | Search for metrics by name | `metrics_read` |
| `metrics` | list | Metrics | List active metrics | `metrics_read` |
| `metrics` | metadata | Metrics | Get metric metadata | `metrics_read` |
| `traces` | search | APM | Search spans with filters | `apm_read` |
| `traces` | aggregate | APM | Aggregate trace data | `apm_read` |
| `traces` | services | APM | List APM services | `apm_service_catalog_read` |
| `events` | list | Events | List events | `events_read` |
| `events` | get | Events | Get event by ID | `events_read` |
| `events` | create | Events | Create an event | `events_read` |
| `events` | search | Events | Search events with v2 API and cursor pagination. Optional `transitionType` filter (e.g. `["alert","alert recovery"]`) restricts to monitor state-transition events — without it, `source:alert` includes renotifies. For monitor-specific fires use `monitors action=history`. Optional `timezone` adds `*Local` ISO 8601 siblings to every timestamp. Zero-result responses include a `diagnostics` array hinting at the cause (`UNINDEXED_TAG_PREFIX`, `NARROW_TIME_RANGE`, `RESTRICTIVE_SOURCE_FILTER`). | `events_read` |
| `events` | histogram | Events | Server-side bucketing of events by `hour_of_day`, `day_of_week`, or `day_of_month` in an IANA `timezone` (DST-safe via `Intl.DateTimeFormat`). Cursor-paginates the underlying search; cap at `limits.maxEventsForHistogram` (default 5000, `MCP_MAX_EVENTS_HISTOGRAM` env var). When the cap is hit, returns `bucketCountIncomplete: true` and `nextCursor` for continuation. | `events_read` |
| `events` | aggregate | Events | Client-side aggregation by monitor_name, source, etc. | `events_read` |
| `events` | top | Events | Top N event groups by count with generic groupBy support (deployments, configs, alerts, etc.). Groups without context tags are included as "no_context" | `events_read` |
| `events` | timeseries | Events | Time-bucketed alert trends (hourly/daily counts) | `events_read` |
| `events` | incidents | Events | Deduplicate alerts into incidents with Trigger/Recover pairing | `events_read` |
| `incidents` | list | Incidents | List incidents | `incident_read` |
| `incidents` | get | Incidents | Get incident by ID | `incident_read` |
| `incidents` | search | Incidents | Search incidents | `incident_read` |
| `incidents` | create | Incidents | Create an incident | `incident_write` |
| `incidents` | update | Incidents | Update an incident | `incident_write` |
| `incidents` | delete | Incidents | Delete an incident | `incident_write` |
| `slos` | list | SLOs | List SLOs | `slos_read` |
| `slos` | get | SLOs | Get SLO by ID | `slos_read` |
| `slos` | create | SLOs | Create an SLO | `slos_write` |
| `slos` | update | SLOs | Update an SLO | `slos_write` |
| `slos` | delete | SLOs | Delete an SLO | `slos_write` |
| `slos` | history | SLOs | Get SLO history | `slos_read` |
| `synthetics` | list | Synthetics | List synthetic tests | `synthetics_read` |
| `synthetics` | get | Synthetics | Get test by public ID | `synthetics_read` |
| `synthetics` | create | Synthetics | Create a test | `synthetics_write` |
| `synthetics` | update | Synthetics | Update a test | `synthetics_write` |
| `synthetics` | delete | Synthetics | Delete a test | `synthetics_write` |
| `synthetics` | trigger | Synthetics | Trigger a test run | `synthetics_write` |
| `synthetics` | results | Synthetics | Get test results | `synthetics_read` |
| `downtimes` | list | Downtimes | List downtimes | `monitors_downtime` |
| `downtimes` | get | Downtimes | Get downtime by ID | `monitors_downtime` |
| `downtimes` | create | Downtimes | Create a downtime | `monitors_downtime` |
| `downtimes` | update | Downtimes | Update a downtime | `monitors_downtime` |
| `downtimes` | cancel | Downtimes | Cancel a downtime | `monitors_downtime` |
| `downtimes` | listByMonitor | Downtimes | List downtimes for a monitor | `monitors_downtime` |
| `hosts` | list | Infrastructure | List hosts | `hosts_read` |
| `hosts` | totals | Infrastructure | Get host totals | `hosts_read` |
| `hosts` | mute | Infrastructure | Mute a host | `hosts_read` |
| `hosts` | unmute | Infrastructure | Unmute a host | `hosts_read` |
| `rum` | applications | RUM | List RUM applications | `rum_read` |
| `rum` | events | RUM | Search RUM events | `rum_read` |
| `rum` | aggregate | RUM | Aggregate RUM data | `rum_read` |
| `rum` | performance | RUM | Get Core Web Vitals (LCP, FCP, CLS, FID, INP) | `rum_read` |
| `rum` | waterfall | RUM | Get session timeline with resources/actions/errors | `rum_read` |
| `security` | rules | Security | List security rules | `security_monitoring_rules_read` |
| `security` | signals | Security | Search security signals | `security_monitoring_signals_read` |
| `security` | findings | Security | List security findings | `security_monitoring_findings_read` |
| `notebooks` | list | Notebooks | List notebooks | `notebooks_read` |
| `notebooks` | get | Notebooks | Get notebook by ID | `notebooks_read` |
| `notebooks` | create | Notebooks | Create a notebook | `notebooks_write` |
| `notebooks` | update | Notebooks | Update a notebook | `notebooks_write` |
| `notebooks` | delete | Notebooks | Delete a notebook | `notebooks_write` |
| `users` | list | Admin | List users | `user_access_read` |
| `users` | get | Admin | Get user by ID | `user_access_read` |
| `teams` | list | Admin | List teams | `teams_read` |
| `teams` | get | Admin | Get team by ID | `teams_read` |
| `teams` | members | Admin | List team members | `teams_read` |
| `tags` | list | Infrastructure | List all tags | `hosts_read` |
| `tags` | get | Infrastructure | Get tags for a host | `hosts_read` |
| `tags` | add | Infrastructure | Add tags to a host | `hosts_read` |
| `tags` | update | Infrastructure | Update host tags | `hosts_read` |
| `tags` | delete | Infrastructure | Delete host tags | `hosts_read` |
| `usage` | summary | Billing | Usage summary | `usage_read` |
| `usage` | hosts | Billing | Host usage | `usage_read` |
| `usage` | logs | Billing | Log usage | `usage_read` |
| `usage` | custom_metrics | Billing | Custom metrics usage | `usage_read` |
| `usage` | indexed_spans | Billing | Indexed spans usage | `usage_read` |
| `usage` | ingested_spans | Billing | Ingested spans usage | `usage_read` |
| `auth` | validate | Auth | Test API and App key validity | — |

## Token Efficiency

### Limit Control

AI assistants have full control over query limits. The environment variables set what value is used when the AI doesn't specify a limit. They do NOT cap what the AI can request.

| Tool | Default | Parameter | Description |
|------|---------|-----------|-------------|
| Logs | 200 | `limit` | Log lines to return |
| Metrics (timeseries) | 1000 | `pointLimit` | Data points per series (controls resolution) |
| General tools | 50 | `limit` | Results to return |

Defaults can be configured via `MCP_DEFAULT_*` environment variables:

```json
{
  "mcpServers": {
    "datadog": {
      "command": "npx",
      "args": ["-y", "datadog-mcp"],
      "env": {
        "DD_API_KEY": "your-api-key",
        "DD_APP_KEY": "your-app-key",
        "MCP_DEFAULT_LIMIT": "50",              // General fallback for most tools
        "MCP_DEFAULT_LOG_LINES": "200",         // Logs search only
        "MCP_DEFAULT_METRIC_POINTS": "1000",    // Metrics query timeseries only
        "MCP_DEFAULT_TIME_RANGE": "24"          // Default time range in hours
      }
    }
  }
}
```

### Compact Mode (Logs)

Use `compact: true` when searching logs to reduce token usage. Strips custom attributes and keeps only essential fields:

```
logs({ action: "search", status: "error", compact: true })
```

Returns: `id`, `timestamp`, `service`, `status`, `message` (truncated), `traceId`, `spanId`, `error`

### Sampling Modes (Logs)

Control how logs are sampled with the `sample` parameter:

| Mode | Description | Use Case |
|------|-------------|----------|
| `first` | Chronological order (default) | Timeline analysis, specific events |
| `spread` | Evenly distributed across time range | See patterns over time |
| `diverse` | Deduplicated by message pattern | Error investigation (distinct error types) |

Example - find distinct error patterns:
```
logs({ action: "search", status: "error", sample: "diverse", limit: 25 })
```

The `diverse` mode normalizes messages (strips UUIDs, timestamps, IPs, numbers) to identify unique error patterns instead of returning duplicates.

## Events Aggregation

### Top Monitors Report (Monitor-Specific)

**Use `monitors` tool for monitor alerts with real monitor names:**

```
monitors({ action: "top", from: "7d", limit: 10 })
```

Returns monitors with **real names** (including {{template.vars}}) from monitors API:
```json
{
  "top": [
    {
      "rank": 1,
      "monitor_id": 67860480,
      "name": "High number of ready messages on {{queue.name}}",
      "message": "Queue {{queue.name}} has {{value}} ready messages",
      "total_count": 50,
      "by_context": [
        {"context": "queue:email-notifications", "count": 30},
        {"context": "queue:payment-processing", "count": 20}
      ]
    },
    {
      "rank": 2,
      "monitor_id": 134611486,
      "name": "Nginx some requests on errors (HTTP 5XX) on {{ingress.name}}",
      "message": "Nginx request on ingress {{ingress.name}} contains some errors (HTTP 5XX)",
      "total_count": 42,
      "by_context": [
        {"context": "ingress:api-gateway", "count": 29},
        {"context": "ingress:admin-panel", "count": 13}
      ]
    }
  ]
}
```

### Top Events Report (Generic)

**Use `events` tool for any event type** (deployments, configs, custom events):

```
events({ action: "top", from: "7d", limit: 10, groupBy: ["service"] })
```

Returns event groups by custom fields:
```json
{
  "top": [
    {
      "rank": 1,
      "service": "api-server",
      "message": "Deployment completed",
      "total_count": 30,
      "by_context": [
        {"context": "env:prod", "count": 20},
        {"context": "env:staging", "count": 10}
      ]
    }
  ]
}
```

**Key Differences:**
- `monitors top`: Fetches real monitor names from monitors API (slower, monitor-specific)
- `events top`: Fast generic grouping, returns event message text (any event type)

Context tags are auto-extracted: `queue:`, `service:`, `ingress:`, `pod_name:`, `kube_namespace:`, `kube_container_name:`

### Tag Discovery

Discover available tag prefixes in your alert data:

```
events({ action: "discover", from: "7d", tags: ["source:alert"] })
```

Returns: `{tagPrefixes: ["queue", "service", "ingress", "pod_name", "monitor", "priority"], sampleSize: 150}`

### Custom Aggregation

For custom grouping patterns, use `aggregate`:

```
events({
  action: "aggregate",
  from: "7d",
  tags: ["source:alert"],
  groupBy: ["monitor_name", "priority"]
})
```

Supported groupBy fields: `monitor_name`, `priority`, `alert_type`, `source`, `status`, `host`, or any tag prefix

The aggregation uses v2 API with cursor pagination to stream through events efficiently (up to 10k events).

## Alert Trends (Timeseries)

Visualize alert patterns over time with time-bucketed aggregation:

```
events({ action: "timeseries", from: "7d", interval: "1d" })
```

Returns hourly/daily alert counts grouped by monitor:
```json
{
  "timeseries": [
    { "timestamp": "2024-01-15T00:00:00Z", "counts": { "High CPU": 5, "Low Disk": 2 }, "total": 7 },
    { "timestamp": "2024-01-16T00:00:00Z", "counts": { "High CPU": 3 }, "total": 3 }
  ]
}
```

| Interval | Use Case |
|----------|----------|
| `1h` | Recent incident analysis (default) |
| `4h` | Daily patterns |
| `1d` | Weekly trends |

Combine with `groupBy` to see trends per monitor, source, or priority.

## Incident Deduplication

Consolidate noisy alert floods into logical incidents:

```
events({ action: "incidents", from: "24h", dedupeWindow: "5m" })
```

Groups repeated triggers within the dedupe window and pairs with recovery events:
```json
{
  "incidents": [
    {
      "monitorName": "High CPU Usage",
      "firstTrigger": "2024-01-15T10:00:00Z",
      "lastTrigger": "2024-01-15T10:15:00Z",
      "triggerCount": 4,
      "recovered": true,
      "recoveredAt": "2024-01-15T10:30:00Z",
      "duration": "30m"
    }
  ],
  "meta": { "totalIncidents": 15, "recoveredCount": 12, "activeCount": 3 }
}
```

| Dedupe Window | Use Case |
|---------------|----------|
| `5m` | Flapping detection (default) |
| `15m` | Alert storm consolidation |
| `1h` | Incident grouping |

## Monitor Enrichment

Add monitor metadata to search results for deeper context:

```
events({ action: "search", tags: ["source:alert"], from: "1h", enrich: true })
```

Returns events with monitor details (type, thresholds, tags):
```json
{
  "events": [{
    "id": "...",
    "title": "[Triggered on {host:prod-1}] High CPU Usage",
    "monitorMetadata": {
      "id": 12345,
      "type": "metric alert",
      "message": "CPU is above threshold",
      "tags": ["team:platform", "env:prod"],
      "options": { "thresholds": { "critical": 90 } }
    }
  }]
}
```

Note: Enrichment adds latency (fetches monitor list). Use for detailed investigation, not bulk analysis.

## Cross-Correlation

### Logs → Traces → Metrics

1. **Find errors in logs**: `logs({ action: "search", status: "error", sample: "diverse" })`
2. **Extract trace_id** from log attributes (`dd.trace_id`)
3. **Get full trace**: `traces({ action: "search", query: "trace_id:<id>" })`
4. **Query APM metrics** (avg): `metrics({ action: "query", query: "avg:trace.express.request.duration{service:my-service}" })`
5. **Query APM latency percentiles** (p95): `metrics({ action: "query", query: "p95:trace.express.request{service:my-service}" })` — note: use root metric without `.duration` suffix for percentiles

## Deep Links

All query responses include a `datadog_url` field that links directly to the Datadog UI, allowing AI assistants to provide evidence links back to the source data.

### Example Response

```json
{
  "logs": [...],
  "meta": {
    "count": 25,
    "query": "service:api status:error",
    "from": "2024-01-15T10:00:00Z",
    "to": "2024-01-15T11:00:00Z",
    "datadog_url": "https://app.datadoghq.com/logs?query=service%3Aapi%20status%3Aerror&from_ts=1705312800000&to_ts=1705316400000"
  }
}
```

### Supported Tools

| Tool | URL Type |
|------|----------|
| `logs` | Logs Explorer with query and time range |
| `metrics` | Metrics Explorer with query and time range |
| `traces` | APM Traces with query and time range |
| `events` | Event Explorer with query and time range |
| `monitors` | Monitor detail page (get) or Manage Monitors (list/search) |
| `rum` | RUM Explorer or Session Replay |

### Multi-Region Support

URLs are automatically generated for your configured Datadog site:

| Site | App URL |
|------|---------|
| `datadoghq.com` (default) | `https://app.datadoghq.com` |
| `datadoghq.eu` | `https://app.datadoghq.eu` |
| `us3.datadoghq.com` | `https://us3.datadoghq.com` |
| `us5.datadoghq.com` | `https://us5.datadoghq.com` |
| `ap1.datadoghq.com` | `https://ap1.datadoghq.com` |
| `ddog-gov.com` | `https://app.ddog-gov.com` |

Configure your site via the `DD_SITE` environment variable or `--site` flag.

## Contributing

Contributions are welcome! Feel free to open an issue or a pull request if you have any suggestions, bug reports, or improvements to propose.

## License

This project is licensed under the [Apache License, Version 2.0](LICENSE).
