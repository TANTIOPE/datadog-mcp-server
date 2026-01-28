/**
 * Dashboard schema definitions
 * Source: https://github.com/DataDog/datadog-api-client-typescript
 * Last updated: 2026-01
 */

export const dashboards = {
  palettes: [
    'blue',
    'custom_bg',
    'custom_image',
    'custom_text',
    'gray_on_white',
    'grey',
    'green',
    'orange',
    'red',
    'red_on_white',
    'white_on_gray',
    'white_on_green',
    'green_on_white',
    'white_on_red',
    'white_on_yellow',
    'yellow_on_white',
    'black_on_light_yellow',
    'black_on_light_green',
    'black_on_light_red'
  ],

  widgetTypes: [
    'alert_graph',
    'alert_value',
    'bar_chart',
    'change',
    'check_status',
    'distribution',
    'event_stream',
    'event_timeline',
    'free_text',
    'funnel',
    'geomap',
    'group',
    'heatmap',
    'hostmap',
    'iframe',
    'image',
    'list_stream',
    'log_stream',
    'manage_status',
    'note',
    'powerpack',
    'query_table',
    'query_value',
    'run_workflow',
    'scatterplot',
    'servicemap',
    'slo',
    'slo_list',
    'split_group',
    'sunburst',
    'timeseries',
    'toplist',
    'topology_map',
    'trace_service',
    'treemap'
  ],

  displayTypes: ['area', 'bars', 'line', 'overlay'],

  lineTypes: ['dashed', 'dotted', 'solid'],

  lineWidths: ['normal', 'thick', 'thin'],

  comparators: ['=', '>', '>=', '<', '<='],

  aggregators: ['avg', 'last', 'max', 'min', 'sum', 'percentile'],

  layoutTypes: ['ordered', 'free'],

  responseFormats: ['timeseries', 'scalar', 'event_list'],

  sortOrders: ['asc', 'desc'],

  textAligns: ['center', 'left', 'right'],

  verticalAligns: ['center', 'top', 'bottom'],

  horizontalAligns: ['center', 'left', 'right'],

  imageSizings: ['fill', 'contain', 'cover', 'none', 'scale-down', 'zoom', 'fit', 'center'],

  eventSizes: ['s', 'l'],

  tickEdges: ['bottom', 'left', 'right', 'top'],

  sizeFormats: ['small', 'medium', 'large'],

  viewModes: ['overall', 'component', 'both'],

  groupings: ['check', 'cluster'],

  liveSpans: [
    '1m',
    '5m',
    '10m',
    '15m',
    '30m',
    '1h',
    '4h',
    '1d',
    '2d',
    '1w',
    '1mo',
    '3mo',
    '6mo',
    'week_to_date',
    'month_to_date',
    '1y',
    'alert'
  ],

  eventsDataSources: [
    'logs',
    'spans',
    'network',
    'rum',
    'security_signals',
    'profiles',
    'audit',
    'events',
    'ci_tests',
    'ci_pipelines',
    'incident_analytics',
    'product_analytics',
    'on_call_events'
  ],

  metricAggregations: ['avg', 'min', 'max', 'sum', 'last', 'area', 'l2norm', 'percentile'],

  eventAggregations: [
    'count',
    'cardinality',
    'median',
    'pc75',
    'pc90',
    'pc95',
    'pc98',
    'pc99',
    'sum',
    'min',
    'max',
    'avg'
  ],

  docsUrl: 'https://docs.datadoghq.com/api/latest/dashboards/'
} as const
