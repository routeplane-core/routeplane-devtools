/**
 * Minimal Server-Sent Events parser for OpenAI-compatible streams.
 *
 * The gateway streams `text/event-stream` bodies as `data: {json}\n\n` frames
 * terminated by `data: [DONE]`. This parser is transport-only: it yields the
 * parsed JSON object from each `data:` frame and stops at the `[DONE]` sentinel.
 */

const DONE = Symbol('routeplane.sse.done');
type ParsedEvent = Record<string, unknown> | typeof DONE | null;

function parseEvent(dataLines: string[]): ParsedEvent {
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  if (raw === '[DONE]') return DONE;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Ignore non-JSON payloads (keep-alives / comments already filtered out).
    return null;
  }
}

/** Append a single SSE line to the in-flight event; returns true when the line ends an event. */
function accumulate(line: string, dataLines: string[]): boolean {
  if (line === '') return true; // blank line terminates the event
  if (line.startsWith(':')) return false; // comment
  if (line.startsWith('data:')) {
    let value = line.slice(5);
    if (value.startsWith(' ')) value = value.slice(1);
    dataLines.push(value);
  }
  // Other SSE fields (event:/id:/retry:) are irrelevant to the JSON stream.
  return false;
}

/**
 * Parse a streamed `fetch` Response into a sequence of JSON chunk objects.
 *
 * ```ts
 * for await (const chunk of parseSSEStream(response)) {
 *   // chunk is the decoded `data:` payload
 * }
 * ```
 */
export async function* parseSSEStream(
  response: Response,
): AsyncGenerator<Record<string, unknown>> {
  const body = response.body;
  if (!body) {
    throw new Error('Routeplane: streaming response has no body');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const dataLines: string[] = [];
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) break;
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);

        if (accumulate(line, dataLines)) {
          const event = parseEvent(dataLines);
          dataLines.length = 0;
          if (event === DONE) return;
          if (event !== null) yield event;
        }
      }
    }

    // Flush a trailing frame that was not terminated by a blank line.
    buffer += decoder.decode();
    if (buffer.length > 0) {
      let line = buffer;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      accumulate(line, dataLines);
    }
    const event = parseEvent(dataLines);
    if (event !== null && event !== DONE) yield event;
  } finally {
    reader.releaseLock();
  }
}
