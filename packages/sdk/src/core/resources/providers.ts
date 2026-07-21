/** Custom-provider resource (`/v1/providers`). */

import type { RouteplaneCoreClient } from '../client.js';
import type { Provider } from '../models.js';

export interface ProviderCreateOptions {
  /** Unique provider name. */
  name: string;
  /** OpenAI-compatible base URL. */
  base_url: string;
  /** Upstream API key (optional). */
  api_key?: string;
}

export class ProvidersResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** List the custom (self-registered) OpenAI-compatible providers. */
  async list(): Promise<Provider[]> {
    const body = await this.client.get<{ data?: Provider[] }>('/v1/providers');
    return body.data ?? [];
  }

  /** Register a custom OpenAI-compatible provider (e.g. an Ollama/vLLM endpoint). */
  create(opts: ProviderCreateOptions): Promise<Provider> {
    const body: Record<string, unknown> = { name: opts.name, base_url: opts.base_url };
    if (opts.api_key !== undefined) body.api_key = opts.api_key;
    return this.client.post<Provider>('/v1/providers', body);
  }

  /** Remove a previously registered custom provider. */
  async delete(name: string): Promise<void> {
    await this.client.delete<unknown>(`/v1/providers/${encodeURIComponent(name)}`);
  }
}
