/** Model-catalog resource (`/v1/models`). */

import type { RouteplaneCoreClient } from '../client.js';
import type { Model, ModelList } from '../types.js';

export interface ModelListOptions {
  /** Filter to a single provider. */
  provider?: string;
}

export class ModelsResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** List the models available through the gateway. */
  async list(opts: ModelListOptions = {}): Promise<Model[]> {
    const params = opts.provider !== undefined ? { provider: opts.provider } : undefined;
    const body = await this.client.get<ModelList>('/v1/models', params);
    return body.data ?? [];
  }

  /** Get details for a single model by id. */
  get(modelId: string): Promise<Model> {
    return this.client.get<Model>(`/v1/models/${encodeURIComponent(modelId)}`);
  }
}
