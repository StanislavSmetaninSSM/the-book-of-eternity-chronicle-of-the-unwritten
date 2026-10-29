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

### Turn-drain rule for the Arena agent

A mailbox response completes one **stage**, not necessarily the player's **turn**. When asked to process/continue/finish a turn, the active Arena agent must keep handling successive requests for that same action until the final stage response is consumed: `Step7_Finalization_TaskGuide` for the staged path, `StepSimpleFullResponse_TaskGuide` for the simple-turn path, or the matching response for a direct `arena-gm-turn`. A missing `pending.json`, an empty status snapshot, or one response disappearing from `responses/` is not by itself proof of completion. After every response, verify consumption and check `pending.json`, `/__arena_gm/status`, and `request-queue`; tolerate brief gaps while the next stage is promoted. If the terminal stage does not appear within the documented idle grace, report the turn as stalled/pending and name the last confirmed stage—do not claim completion or ask the player to resubmit an action already present in the prompt. The watcher is only a notifier; the active Arena agent must remain responsible for draining the turn.

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

Images are separate, lower-priority relay jobs. The browser serializes image jobs and defers them while a game turn holds its explicit lease. A turn lease is released only by its owner; an empty server queue is normal between stages and is never proof the turn ended. If a turn begins while an image is already generating (including a startup portrait), the browser cancels that attempt and retries it after the turn. The server also yields an active image slot to a newly arriving turn by re-queuing the same image packet without deleting its request or response, so a live owner can continue polling and consume it after the turn. Active and queued image packets expire only after 30 seconds without a browser heartbeat (`ARENA_GM_RELAY_IMAGE_LEASE_MS` can tune the server threshold); live image owners keep their request alive by polling, while abandoned duplicate portraits cannot block newer requests indefinitely. If a still-live image owner receives the stale-request response, it resubmits the same packet and correlation ID; explicit user cancellation still stops that retry. For `arena-gm-image`, create one PNG at `.arena-gm-relay/images/<correlationId>.png`, then write its response envelope atomically to `.arena-gm-relay/responses/<correlationId>.json`:

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
- The active mailbox is sequential. Queued turn stages are promoted before image jobs, and a newly arriving turn can yield an already-active image back to the queue without deleting it. Browser-side image serialization holds or retries background work until the turn owner explicitly releases its lease. The relay has no autonomous agent invocation mechanism. The optional watcher monitors only the active `pending.json` and reports it; it cannot process requests or wake an agent.
- Static builds do not contain the middleware. Production needs an authenticated server-side adapter and secure mailbox storage.
