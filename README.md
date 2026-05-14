# Datadog MCP Server

[![Quality gate](https://sonarcloud.io/api/project_badges/quality_gate?project=TANTIOPE_datadog-mcp-server)](https://sonarcloud.io/summary/new_code?id=TANTIOPE_datadog-mcp-server)
[![CI/Release](https://github.com/tantiope/datadog-mcp-server/actions/workflows/release.yml/badge.svg)](https://github.com/tantiope/datadog-mcp-server/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/datadog-mcp)](https://www.npmjs.com/package/datadog-mcp)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=TANTIOPE_datadog-mcp-server&metric=coverage)](https://sonarcloud.io/summary/new_code?id=TANTIOPE_datadog-mcp-server)

> **DISCLAIMER**: This is a community-maintained project and is not officially affiliated with, endorsed by, or supported by Datadog, Inc. This MCP server utilizes the Datadog API but is developed independently.

MCP server providing AI assistants with full Datadog observability access. Features grep-like log search, APM trace filtering with duration/status/error queries, smart sampling modes for token efficiency, and cross-correlation between logs, traces, and metrics. Supports both `stdio` (local) and `http` (remote/Kubernetes) transports.

## Quick Start

Minimal Claude Desktop / VS Code / Cursor config — just the two required keys:

```json
{
  "mcpServers": {
    "datadog": {
      "command": "npx",
      "args": ["-y", "datadog-mcp"],
      "env": {
        "DD_API_KEY": "your-api-key",
        "DD_APP_KEY": "your-app-key"
      }
    }
  }
}
```

With optional tuning (EU site, custom default limits, longer log windows):

```json
{
  "mcpServers": {
    "datadog": {
      "command": "npx",
      "args": ["-y", "datadog-mcp"],
      "env": {
        "DD_API_KEY": "your-api-key",
        "DD_APP_KEY": "your-app-key",
        "DD_SITE": "datadoghq.eu",
        "MCP_DEFAULT_LIMIT": "50",
        "MCP_DEFAULT_LOG_LINES": "200",
        "MCP_DEFAULT_METRIC_POINTS": "1000",
        "MCP_DEFAULT_TIME_RANGE": "24"
      }
    }
  }
}
```

To run as an HTTP server (e.g. inside a container or Kubernetes pod), add transport variables to the same `env` block:

```json
"env": {
  "DD_API_KEY": "your-api-key",
  "DD_APP_KEY": "your-app-key",
  "MCP_TRANSPORT": "http",
  "MCP_PORT": "3000",
  "MCP_HOST": "0.0.0.0"
}
```

## Configuration

### Required environment variables

```bash
DD_API_KEY=your-api-key
DD_APP_KEY=your-app-key
```

### Optional environment variables

```bash
DD_SITE=datadoghq.com  # Default. Use datadoghq.eu for EU, etc.

# Limit defaults (fallbacks when the AI doesn't specify)
MCP_DEFAULT_LIMIT=50              # General tools default limit
MCP_DEFAULT_LOG_LINES=200         # Logs tool default limit
MCP_DEFAULT_METRIC_POINTS=1000    # Metrics timeseries data points
MCP_DEFAULT_TIME_RANGE=24         # Default time range in hours

# Transport (alternative to CLI flags — useful in Kubernetes)
MCP_TRANSPORT=stdio               # stdio | http
MCP_PORT=3000                     # HTTP port
MCP_HOST=0.0.0.0                  # HTTP host
```

### Optional flags

```bash
--site=datadoghq.com     # Datadog site (overrides DD_SITE)
--transport=stdio|http   # Transport mode (default: stdio)
--port=3000              # HTTP port when using http transport
--host=0.0.0.0           # HTTP host when using http transport
--read-only              # Block all write operations
--disable-tools=synthetics,rum,security    # Comma-separated list of tools to disable
```

## Transports

| Transport | When to use | Endpoints |
|-----------|-------------|-----------|
| `stdio` (default) | Local MCP clients — Claude Desktop, Cursor, VS Code | n/a (process stdin/stdout) |
| `http` | Remote / container / Kubernetes | `POST /mcp` · `GET /mcp` (SSE) · `DELETE /mcp` · `GET /health` |

Select with `--transport=http` or `MCP_TRANSPORT=http`.

## Deployment

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

Use environment variables — not container args — for transport configuration:

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
| `metrics` | query | Metrics | Query timeseries data. Response `meta` includes `rollupRequested` (parsed from `rollup(method, seconds)`, with `methodInferred` flag), `rollupEffective` (interval derived from returned pointlist intervals + deduped `intervalsObserved` for multi-series), and `rollupOverridden: boolean` so callers can detect when Datadog silently downsampled. | `metrics_read`, `timeseries_query` |
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
| `events` | histogram | Events | Server-side bucketing of events by `hour_of_day`, `day_of_week`, or `day_of_month` in an IANA `timezone` (DST-safe via `Intl.DateTimeFormat`). Accepts the same `transitionType` filter as `search` so monitor histograms can exclude renotifies. Cursor-paginates the underlying search; cap at `limits.maxEventsForHistogram` (default 5000, `MCP_MAX_EVENTS_HISTOGRAM` env var). When the cap is hit, returns `bucketCountIncomplete: true` and `nextCursor` for continuation. | `events_read` |
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
| `slos` | list | SLOs | List SLOs. Each item exposes `query`, `monitorIds`, `monitorTags`, `groups`, and a UI `url` so round-trips (get → edit → update) preserve definition fields. | `slos_read` |
| `slos` | get | SLOs | Get SLO by ID (same projection as `list`). | `slos_read` |
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

## Limit Control

AI assistants have full control over query limits. The `MCP_DEFAULT_*` environment variables only set the fallback used when the AI doesn't specify a limit — they do NOT cap what the AI can request.

| Tool | Default | Parameter | Description |
|------|---------|-----------|-------------|
| Logs | 200 | `limit` | Log lines to return |
| Metrics (timeseries) | 1000 | `pointLimit` | Data points per series (controls resolution) |
| General tools | 50 | `limit` | Results to return |

Tool-level token reduction features (`compact: true` on logs, `sample: "diverse" | "spread" | "first"`, field projections, diagnostics) are surfaced in each tool's MCP description and chosen by the AI at call time.

## Notable behaviors

A handful of patterns worth knowing about — the AI can discover the rest from tool descriptions.

- **Renotifies vs real fires.** `monitors top` and `events search` with `source:alert` count every renotify Datadog emits (one every `renotify_interval` while a monitor is Alert). To get actual state transitions, use `monitors history` (defaults to `transitionType: ["alert","alert recovery"]`) or pass `transitionType` to `events search`.
- **DST-safe time buckets.** `events histogram` buckets by `hour_of_day` / `day_of_week` / `day_of_month` in any IANA `timezone` via `Intl.DateTimeFormat`. Cursor-paginates the underlying search; cap controlled by `MCP_MAX_EVENTS_HISTOGRAM` (default 5000) with `bucketCountIncomplete` + `nextCursor` on overflow.
- **Validate before create.** `monitors create` with `dry_run: true` calls `/api/v1/monitor/validate` instead of persisting. Allowed in `--read-only` mode.
- **Monitor template preview.** `monitors preview` renders a notification against a `context` payload — variable substitution + Datadog's six documented conditionals (`is_alert`, `is_warning`, `is_no_data`, `is_recovery`, `is_alert_to_warning`, `is_warning_to_alert`). `{{#each}}` and partials throw `EUNSUPPORTED_TEMPLATE_SYNTAX`.
- **SLO round-trip.** `slos get` projects `query`, `monitorIds`, `monitorTags`, `groups`, and a UI `url` so you can edit and feed back into `slos update` without dropping definition fields.
- **Cross-correlation.** `logs(sample:"diverse")` → pull `dd.trace_id` → `traces(query:"trace_id:<id>")` → `metrics(query:"p95:trace.express.request{service:...}")` (root metric without `.duration` for percentiles).

## Deep links

Every query response includes a `datadog_url` field built for your configured `DD_SITE` — `datadoghq.com` (default), `.eu`, `us3` / `us5` / `ap1.datadoghq.com`, or `ddog-gov.com`. Supported on `logs`, `metrics`, `traces`, `events`, `monitors`, `rum`, `slos`.

## Contributing

Contributions are welcome! Feel free to open an issue or a pull request if you have any suggestions, bug reports, or improvements to propose.

## License

This project is licensed under the [Apache License, Version 2.0](LICENSE).
