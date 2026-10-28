# Arena GM Relay protocol

The relay lets the Arena conversation agent act as the RPG game master without a separate text-model API. It uses the project workspace as a temporary mailbox, served to the browser through Vite development middleware. The app cannot trigger or wake the agent: a user/active Arena agent turn must handle mailbox requests. For setup and exact file workflows, see [ARENA-DEPLOYMENT.md](ARENA-DEPLOYMENT.md).

## Turn-stage flow

The relay is inside the existing game generation pipeline; it does not replace it with one final response. For each generation stage:

1. The game prepares the stage prompt, allowed output contract, step name, attempt number, and correlation ID.
2. The browser posts an `arena-gm-step` request to `/__arena_gm/turn`. Vite queues it durably, then publishes it as `.arena-gm-relay/pending.json` when it becomes the single active request; it never overwrites a different active request.
3. The Arena agent reads the active request and writes an `arena-gm-step-response` atomically to `.arena-gm-relay/responses/<correlationId>.json`. Its `output` object must contain only that stage's requested JSON. The relay keeps additional requests queued and publishes one active `pending.json` at a time.
4. The browser polls `/__arena_gm/response?correlationId=...`. Vite returns only a matching envelope and removes the consumed mailbox files.
5. The existing game code validates/parses the stage, merges intermediate results, runs conditional steps and correction/retry stages, and eventually applies the completed game response.

The next request has a new correlation ID. Each requested step must be processed separately; do not combine intermediate steps into one `GameResponse`. The prompt in the request is the source of truth for the stage schema.

### Stage request

```json
{
  "kind": "arena-gm-step",
  "protocolVersion": 1,
  "correlationId": "unique-id",
  "stepName": "Step0_AnalysisAndPlanning_TaskGuide",
  "modelName": "configured-model-label",
  "attempt": 1,
  "instructions": "...",
  "prompt": "..."
}
```

### Stage response

```json
{
  "kind": "arena-gm-step-response",
  "protocolVersion": 1,
  "correlationId": "unique-id",
  "output": { "only": "keys authorized by the request prompt" }
}
```

`output` is a stage-level object, not the full game response. Use the exact correlation ID and `protocolVersion: 1`.

## Image flow

Images are separate, lower-priority relay jobs. The browser serializes image jobs and defers them while a full staged game turn holds the relay lease; the server also prioritizes queued turn stages over image requests. For `arena-gm-image`, create one PNG at `.arena-gm-relay/images/<correlationId>.png`, then write its response envelope atomically to `.arena-gm-relay/responses/<correlationId>.json`:

```json
{
  "kind": "arena-gm-image-response",
  "protocolVersion": 1,
  "correlationId": "same-image-request-id"
}
```

The Vite middleware serves the matching image through `/__arena_gm/image`. A response envelope without the PNG file is an incomplete image response.

## Runtime and security

- Endpoints are same-origin relative URLs; the development server binds to `0.0.0.0` and accepts preview hosts.
- Vite development middleware owns mailbox I/O and enforces a request body size limit. The correlation ID is checked before returning a response or image.
- `.arena-gm-relay/` is transient and ignored by Git. It can contain game prompts and generated art; treat it as private workspace data and do not publish it.
- The default game relay does not pass provider API keys. Avoid adding credentials to request/response envelopes.
- The active mailbox is sequential. Queued turn stages are promoted before image jobs; the browser additionally serializes images and holds them until the full game-turn lease is released. The relay has no autonomous agent invocation mechanism. The optional watcher monitors only the active `pending.json` and reports it; it cannot process requests or wake an agent.
- Static builds do not contain the middleware. Production needs an authenticated server-side adapter and secure mailbox storage.
