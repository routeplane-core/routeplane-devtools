/** Sovereign-residency resource (`/v1/residency/*`). All reads. */

import type { RouteplaneCoreClient } from '../client.js';
import type { ResidencyLedger, ResidencySummary } from '../models.js';

export class ResidencyResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Residency-decision summary (counts, by-region, by-outcome). */
  summary(): Promise<ResidencySummary> {
    return this.client.get<ResidencySummary>('/v1/residency/summary');
  }

  /** Residency-decision ledger (recent per-decision entries). */
  ledger(): Promise<ResidencyLedger> {
    return this.client.get<ResidencyLedger>('/v1/residency/ledger');
  }
}
