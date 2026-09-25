/** FinOps usage/cost resource (`/v1/finops/*`). All reads. */

import type { RouteplaneCoreClient } from '../client.js';
import type {
  CacheSavings,
  DailyUsage,
  DailyUsageReport,
  SaverMetrics,
  TimeseriesData,
  UsageData,
} from '../models.js';

export interface DateRangeOptions {
  /** @deprecated Absolute ranges are rejected; use usageDailyReport(). */
  from?: string;
  /** @deprecated Absolute ranges are rejected; use usageDailyReport(). */
  to?: string;
}

export interface TimeseriesOptions {
  /** Recent window in minutes. The gateway clamps this to 1..1440. */
  windowMins?: number;
  /** Number of fixed-width buckets. The gateway clamps this to 1..200. */
  buckets?: number;
}

function dateParams(opts?: DateRangeOptions): Record<string, string> | undefined {
  if (!opts) return undefined;
  const params: Record<string, string> = {};
  if (opts.from !== undefined) params.from = opts.from;
  if (opts.to !== undefined) params.to = opts.to;
  return Object.keys(params).length > 0 ? params : undefined;
}

function timeseriesParams(
  opts?: TimeseriesOptions | DateRangeOptions,
): Record<string, string> | undefined {
  if (!opts) return undefined;
  if ('from' in opts || 'to' in opts) {
    throw new TypeError(
      'absolute timeseries date ranges are unsupported; use usageDailyReport({ from, to })',
    );
  }
  const native = opts as TimeseriesOptions;
  const params: Record<string, string> = {};
  if (native.windowMins !== undefined) params.window_mins = String(native.windowMins);
  if (native.buckets !== undefined) params.buckets = String(native.buckets);
  return Object.keys(params).length > 0 ? params : undefined;
}

export class FinOpsResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Aggregate spend and token counts. */
  usage(): Promise<UsageData> {
    return this.client.get<UsageData>('/v1/finops/usage');
  }

  /** Durable daily usage report, including totals and the server's provenance note. */
  usageDailyReport(opts?: DateRangeOptions): Promise<DailyUsageReport> {
    return this.client.get<DailyUsageReport>(
      '/v1/finops/usage/daily',
      dateParams(opts),
    );
  }

  /**
   * Durable daily rows only.
   *
   * @deprecated Use {@link usageDailyReport} so totals, scope, and provenance
   * are not discarded. This compatibility helper will be removed in a major release.
   */
  async usageDaily(opts?: DateRangeOptions): Promise<DailyUsage[]> {
    return (await this.usageDailyReport(opts)).days;
  }

  /**
   * Recent, process-local usage time series suitable for charting.
   *
   * Legacy `{from,to}` options remain in the type for source compatibility but
   * are rejected because this endpoint cannot select an absolute period. Use
   * {@link usageDailyReport} for durable date ranges.
   */
  timeseries(opts?: TimeseriesOptions | DateRangeOptions): Promise<TimeseriesData> {
    return this.client.get<TimeseriesData>('/v1/finops/timeseries', timeseriesParams(opts));
  }

  /** Response-cache savings rollup. */
  cacheSavings(): Promise<CacheSavings> {
    return this.client.get<CacheSavings>('/v1/finops/cache-savings');
  }

  /** Per-saver cost telemetry. */
  saverMetrics(): Promise<SaverMetrics> {
    return this.client.get<SaverMetrics>('/v1/finops/saver-metrics');
  }
}
