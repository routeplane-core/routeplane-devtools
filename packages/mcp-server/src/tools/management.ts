/**
 * Management tools — model catalog, custom-provider registration, prompt
 * templates, and quality feedback.
 */

import {
  type ToolDef,
  EMPTY_SCHEMA,
  jsonResult,
  objectSchema,
  optString,
  requireNumber,
  requireString,
  str,
  num,
  record,
  textResult,
} from './common.js';

const listModels: ToolDef = {
  name: 'list_models',
  description: 'List the models available through the gateway, optionally filtered by provider.',
  readOnly: true,
  inputSchema: objectSchema({ provider: str('Filter to a single provider.') }),
  handler: async (make, args) => {
    const provider = optString(args, 'provider');
    const params = provider ? { provider } : undefined;
    const response = await make().get('/v1/models', params);
    return jsonResult(response);
  },
};

const getModel: ToolDef = {
  name: 'get_model',
  description: 'Get details for a single model by id.',
  readOnly: true,
  inputSchema: objectSchema({ model_id: str('The model id.') }, ['model_id']),
  handler: async (make, args) => {
    const modelId = requireString(args, 'model_id');
    const response = await make().get(`/v1/models/${encodeURIComponent(modelId)}`);
    return jsonResult(response);
  },
};

const listProviders: ToolDef = {
  name: 'list_providers',
  description: 'List the custom (self-registered) OpenAI-compatible providers.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/providers')),
};

const createProvider: ToolDef = {
  name: 'create_provider',
  description: 'Register a custom OpenAI-compatible provider (e.g. an Ollama/vLLM endpoint).',
  inputSchema: objectSchema(
    {
      name: str('Unique provider name.'),
      base_url: str('OpenAI-compatible base URL.'),
      api_key: str('Upstream API key (optional).'),
    },
    ['name', 'base_url'],
  ),
  handler: async (make, args) => {
    const name = requireString(args, 'name');
    const baseUrl = requireString(args, 'base_url');
    const apiKey = optString(args, 'api_key');
    const body: Record<string, unknown> = { name, base_url: baseUrl };
    if (apiKey) body.api_key = apiKey;
    return jsonResult(await make().post('/v1/providers', body));
  },
};

const deleteProvider: ToolDef = {
  name: 'delete_provider',
  description: 'Remove a previously registered custom provider.',
  destructive: true,
  inputSchema: objectSchema({ name: str('The provider name to delete.') }, ['name']),
  handler: async (make, args) => {
    const name = requireString(args, 'name');
    await make().delete(`/v1/providers/${encodeURIComponent(name)}`);
    return textResult(`Deleted custom provider "${name}".`);
  },
};

const getPrompt: ToolDef = {
  name: 'get_prompt',
  description: 'Fetch a stored prompt template by reference.',
  readOnly: true,
  inputSchema: objectSchema({ reference: str('Prompt reference (id or slug).') }, ['reference']),
  handler: async (make, args) => {
    const reference = requireString(args, 'reference');
    const response = await make().get(`/v1/prompts/${encodeURIComponent(reference)}`);
    return jsonResult(response);
  },
};

const renderPrompt: ToolDef = {
  name: 'render_prompt',
  description: 'Render a prompt template with variables, without running a completion.',
  readOnly: true,
  inputSchema: objectSchema(
    {
      reference: str('Prompt reference (id or slug).'),
      variables: record('Template variables as string key/value pairs.'),
    },
    ['reference'],
  ),
  handler: async (make, args) => {
    const reference = requireString(args, 'reference');
    const variables = args.variables ?? {};
    const response = await make().post(
      `/v1/prompts/${encodeURIComponent(reference)}/render`,
      { variables },
    );
    return jsonResult(response);
  },
};

const submitFeedback: ToolDef = {
  name: 'submit_feedback',
  description: 'Attach a quality score (and optional comment) to a prior request by its id.',
  inputSchema: objectSchema(
    {
      request_id: str('The gateway request id to score.'),
      score: num('Quality score (e.g. 0-1 or thumbs as a number).'),
      comment: str('Optional free-text comment.'),
    },
    ['request_id', 'score'],
  ),
  handler: async (make, args) => {
    const requestId = requireString(args, 'request_id');
    const score = requireNumber(args, 'score');
    const comment = optString(args, 'comment');
    const body: Record<string, unknown> = { request_id: requestId, score };
    if (comment) body.comment = comment;
    return jsonResult(await make().post('/v1/feedback', body));
  },
};

export const managementTools: ToolDef[] = [
  listModels,
  getModel,
  listProviders,
  createProvider,
  deleteProvider,
  getPrompt,
  renderPrompt,
  submitFeedback,
];
