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
  /** Start date (ISO 8601 or YYYY-MM-DD). */
  from?: string;
  /** End date (ISO 8601 or YYYY-MM-DD). */
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
    if (!opts.from || !opts.to) {
      throw new TypeError('legacy timeseries date ranges require both `from` and `to`');
    }
    const from = Date.parse(opts.from);
    const to = Date.parse(opts.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      throw new RangeError('legacy timeseries `from`/`to` must be valid and ordered');
    }
    // The server has only a RECENT relative window, not an absolute date range.
    // Preserve old call sites by converting the interval to an explicit duration;
    // the gateway then applies its documented 1..1440 minute clamp.
    return { window_mins: String(Math.max(1, Math.ceil((to - from) / 60_000))) };
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
   * Legacy `{from,to}` options are accepted for source compatibility and are
   * converted to a relative `window_mins` duration. They never select absolute
   * historical dates; use {@link usageDailyReport} for durable date ranges.
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
