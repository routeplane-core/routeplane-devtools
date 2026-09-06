# Changelog

## Unreleased

### Fixed

- The SDK and existing CLI feedback helpers now serialize ergonomic
  `requestId`/`score` arguments to the gateway's legacy `trace_id`/integer `value`
  contract. Valid scores are −10 through 10 without rescaling; invalid scores
  fail before dispatch.
- Unsupported nonempty comments now fail explicitly, including whitespace-only
  notes. Omitted, null and empty comments are omitted. Return contracts remain
  unchanged; the CLI confirms acknowledgement rather than durable recording.
