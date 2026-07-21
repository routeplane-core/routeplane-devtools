/**
 * Inference tools — the request-serving surfaces: chat, embeddings, rerank,
 * moderation, image generation, speech, and prompt-template completion.
 */

import {
  type ToolDef,
  type ToolResult,
  jsonResult,
  objectSchema,
  optNumber,
  optString,
  requireArray,
  requireString,
  routingHeaders,
  str,
  strArray,
  bool,
  num,
  record,
  enumStr,
  textResult,
} from './common.js';

const DEFAULT_CHAT_MODEL = 'gpt-4o';
const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';

interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ChatChoice {
  message?: { content?: unknown };
  finish_reason?: string;
}

interface ChatResponse {
  id?: string;
  model?: string;
  choices?: ChatChoice[];
  usage?: ChatUsage;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text: unknown }).text)
          : JSON.stringify(part),
      )
      .join('');
  }
  return content === undefined ? '' : JSON.stringify(content);
}

function formatChat(response: ChatResponse, provider?: string): ToolResult {
  const choice = response.choices?.[0];
  const text = contentToText(choice?.message?.content);
  const meta: string[] = [];
  if (response.model) meta.push(`model: ${response.model}`);
  if (provider) meta.push(`provider: ${provider}`);
  if (choice?.finish_reason) meta.push(`finish: ${choice.finish_reason}`);
  if (response.usage) {
    const u = response.usage;
    meta.push(
      `tokens: ${u.prompt_tokens ?? '?'} in / ${u.completion_tokens ?? '?'} out / ${u.total_tokens ?? '?'} total`,
    );
  }
  if (response.id) meta.push(`id: ${response.id}`);
  const footer = meta.length > 0 ? `\n\n---\n${meta.join(' · ')}` : '';
  return textResult(`${text}${footer}`);
}

const chatCompletion: ToolDef = {
  name: 'chat_completion',
  description:
    'Send a chat completion through the Routeplane gateway. Supports provider fallback chains, routing strategy, and sovereign residency routing.',
  inputSchema: objectSchema(
    {
      messages: {
        type: 'array',
        description: 'OpenAI-style messages, each { role, content }.',
        items: {
          type: 'object',
          properties: { role: str('system | user | assistant'), content: str() },
          required: ['role', 'content'],
        },
      },
      model: str(`Model id. Default "${DEFAULT_CHAT_MODEL}".`),
      stream: bool('Stream the response and return the assembled text.'),
      provider: str('Provider or comma-separated fallback chain (e.g. "openai,anthropic").'),
      strategy: enumStr(['priority', 'weighted', 'cost', 'latency'], 'Candidate ordering strategy.'),
      residency: str('Requested data-residency region (e.g. "IN").'),
    },
    ['messages'],
  ),
  handler: async (make, args) => {
    const messages = requireArray(args, 'messages');
    const model = optString(args, 'model') ?? DEFAULT_CHAT_MODEL;
    const client = make(routingHeaders(args));
    const provider = optString(args, 'provider');

    if (args.stream === true) {
      let text = '';
      let model_ = model;
      let finish: string | undefined;
      for await (const chunk of client.stream('/v1/chat/completions', {
        model,
        messages,
        stream: true,
      })) {
        if (typeof chunk.model === 'string') model_ = chunk.model;
        const choices = chunk.choices;
        if (Array.isArray(choices) && choices.length > 0) {
          const first = choices[0] as { delta?: { content?: unknown }; finish_reason?: string };
          if (first.delta?.content !== undefined) text += contentToText(first.delta.content);
          if (first.finish_reason) finish = first.finish_reason;
        }
      }
      const footer = [`model: ${model_}`, provider ? `provider: ${provider}` : '', finish ? `finish: ${finish}` : '', 'streamed']
        .filter(Boolean)
        .join(' · ');
      return textResult(`${text}\n\n---\n${footer}`);
    }

    const response = await client.post<ChatResponse>('/v1/chat/completions', { model, messages });
    return formatChat(response, provider);
  },
};

const embedText: ToolDef = {
  name: 'embed_text',
  description: 'Generate embedding vectors for one or more input strings.',
  inputSchema: objectSchema(
    {
      input: {
        type: ['string', 'array'],
        description: 'A string or array of strings to embed.',
        items: { type: 'string' },
      },
      model: str(`Embedding model. Default "${DEFAULT_EMBED_MODEL}".`),
      provider: str('Provider override.'),
    },
    ['input'],
  ),
  handler: async (make, args) => {
    const input = args.input;
    if (typeof input !== 'string' && !Array.isArray(input)) {
      throw new Error('Missing or invalid "input": expected a string or array of strings.');
    }
    const model = optString(args, 'model') ?? DEFAULT_EMBED_MODEL;
    const client = make(routingHeaders(args));
    const response = await client.post<{
      data?: Array<{ embedding?: number[] }>;
      model?: string;
      usage?: { total_tokens?: number };
    }>('/v1/embeddings', { model, input });
    const vectors = response.data ?? [];
    const dims = vectors[0]?.embedding?.length;
    return jsonResult({
      model: response.model ?? model,
      count: vectors.length,
      dimensions: dims,
      total_tokens: response.usage?.total_tokens,
    });
  },
};

const rerank: ToolDef = {
  name: 'rerank',
  description: 'Rerank a set of documents by relevance to a query.',
  inputSchema: objectSchema(
    {
      query: str('The search query.'),
      documents: strArray('Documents to rank.'),
      model: str('Rerank model (optional; gateway default applies).'),
      top_n: num('Return only the top N results.'),
      provider: str('Provider override.'),
    },
    ['query', 'documents'],
  ),
  handler: async (make, args) => {
    const query = requireString(args, 'query');
    const documents = requireArray(args, 'documents');
    const model = optString(args, 'model');
    const topN = optNumber(args, 'top_n');
    const client = make(routingHeaders(args));
    const body: Record<string, unknown> = { query, documents };
    if (model) body.model = model;
    if (topN !== undefined) body.top_n = topN;
    const response = await client.post('/v1/rerank', body);
    return jsonResult(response);
  },
};

const moderate: ToolDef = {
  name: 'moderate',
  description: 'Run content moderation over the input text.',
  inputSchema: objectSchema(
    {
      input: str('Text to classify.'),
      model: str('Moderation model (optional).'),
      provider: str('Provider override.'),
    },
    ['input'],
  ),
  handler: async (make, args) => {
    const input = requireString(args, 'input');
    const model = optString(args, 'model');
    const client = make(routingHeaders(args));
    const body: Record<string, unknown> = { input };
    if (model) body.model = model;
    const response = await client.post('/v1/moderations', body);
    return jsonResult(response);
  },
};

const imageGenerate: ToolDef = {
  name: 'image_generate',
  description: 'Generate an image from a text prompt.',
  inputSchema: objectSchema(
    {
      prompt: str('Image description.'),
      model: str('Image model (optional).'),
      size: str('Image size, e.g. "1024x1024".'),
      provider: str('Provider override.'),
    },
    ['prompt'],
  ),
  handler: async (make, args) => {
    const prompt = requireString(args, 'prompt');
    const model = optString(args, 'model');
    const size = optString(args, 'size');
    const client = make(routingHeaders(args));
    const body: Record<string, unknown> = { prompt };
    if (model) body.model = model;
    if (size) body.size = size;
    const response = await client.post('/v1/images/generations', body);
    return jsonResult(response);
  },
};

const speech: ToolDef = {
  name: 'speech',
  description:
    'Synthesize speech audio from text. Returns a confirmation; the raw audio is not embedded in the tool result.',
  inputSchema: objectSchema(
    {
      input: str('Text to speak.'),
      model: str('TTS model (optional).'),
      voice: str('Voice name (optional).'),
      provider: str('Provider override.'),
    },
    ['input'],
  ),
  handler: async (make, args) => {
    const input = requireString(args, 'input');
    const model = optString(args, 'model');
    const voice = optString(args, 'voice');
    const client = make(routingHeaders(args));
    const body: Record<string, unknown> = { input };
    if (model) body.model = model;
    if (voice) body.voice = voice;
    const result = await client.post<unknown>('/v1/audio/speech', body);
    const bytes = typeof result === 'string' ? result.length : undefined;
    return textResult(
      `Speech synthesized${voice ? ` (voice: ${voice})` : ''}${bytes !== undefined ? ` — ${bytes} bytes of audio` : ''}.`,
    );
  },
};

const promptCompletion: ToolDef = {
  name: 'prompt_completion',
  description: 'Render a stored prompt template with variables and run it as a chat completion.',
  inputSchema: objectSchema(
    {
      reference: str('Prompt template reference (id or slug).'),
      variables: record('Template variables as string key/value pairs.'),
      model: str('Model override (optional).'),
      provider: str('Provider override.'),
    },
    ['reference'],
  ),
  handler: async (make, args) => {
    const reference = requireString(args, 'reference');
    const variables = args.variables ?? {};
    const model = optString(args, 'model');
    const client = make(routingHeaders(args));
    const body: Record<string, unknown> = { variables };
    if (model) body.model = model;
    const response = await client.post<ChatResponse>(
      `/v1/prompts/${encodeURIComponent(reference)}/completions`,
      body,
    );
    return formatChat(response, optString(args, 'provider'));
  },
};

export const inferenceTools: ToolDef[] = [
  chatCompletion,
  embedText,
  rerank,
  moderate,
  imageGenerate,
  speech,
  promptCompletion,
];
