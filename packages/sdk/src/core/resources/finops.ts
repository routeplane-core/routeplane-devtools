/** FinOps usage/cost resource (`/v1/finops/*`). All reads. */

import type { RouteplaneCoreClient } from '../client.js';
import type {
  CacheSavings,
  DailyUsage,
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

function dateParams(opts?: DateRangeOptions): Record<string, string> | undefined {
  if (!opts) return undefined;
  const params: Record<string, string> = {};
  if (opts.from !== undefined) params.from = opts.from;
  if (opts.to !== undefined) params.to = opts.to;
  return Object.keys(params).length > 0 ? params : undefined;
}

export class FinOpsResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Aggregate spend and token counts. */
  usage(): Promise<UsageData> {
    return this.client.get<UsageData>('/v1/finops/usage');
  }

  /** Durable daily usage rollups over an optional date range. */
  async usageDaily(opts?: DateRangeOptions): Promise<DailyUsage[]> {
    const body = await this.client.get<{ days?: DailyUsage[] }>(
      '/v1/finops/usage/daily',
      dateParams(opts),
    );
    return body.days ?? [];
  }

  /** Usage timeseries suitable for charting. */
  timeseries(opts?: DateRangeOptions): Promise<TimeseriesData> {
    return this.client.get<TimeseriesData>('/v1/finops/timeseries', dateParams(opts));
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
