# Arena GM Relay protocol

The current follow-up work and acceptance criteria for combat consequences and the living world are documented in [combat-world-progression-spec.md](combat-world-progression-spec.md).

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

## Player attachments

Player images attached to actions or out-of-character questions travel inside the stage prompt's `CurrentGameContext.image` as MIME type and base64 data. For a pending stage, run `node scripts/arena-gm-extract-attachment.mjs` and inspect the resulting image with the Arena file-reading tool before responding. Do not confuse these with requests to generate images. PNG, JPEG, WebP, GIF and BMP attachments up to 4 MiB are accepted; the entire request remains subject to the 12 MiB relay limit. Extracted images and packets are private transient files under `.arena-gm-relay/`.

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

## Rules and context document

`getGameMasterGuideRules()` returns the same complete rules document for every turn. Its `{{context.field}}` references describe fields and fallback behavior; they are not data to be returned literally. Each stage request appends a separate `<CurrentGameContext>` JSON document containing the actual values, preceded by a field overview. The stage's own task guide continues to define its allowed output keys. User super-instructions are in `context.superInstructions`; the action is in `context.message`; prior stage outputs, retry information and all state are in the corresponding context fields. The YouTube API key is deliberately omitted.

World progression and regeneration rules are both retained in the static guide as explicitly conditional branches. For world events, follow the branch matching `context.gameSettings.doNotUseWorldEvents` (absent means false); for regeneration, apply its block only when `context.isRegenerationAttempt` is true. Image attachments remain in `context.image` and should be inspected as described above. `npm test` includes a static-guide snapshot, checksums of both original world-progression branches, context serialization checks and staged-pipeline tests.

## Pilot: local rule bundle for narrative, NPC details, inventory, combat audit, world and faction progression

`Step6_NarrativeGeneration_TaskGuide` and `Step4_NPC_TaskGuide` may use the local reference. `Step5_Inventory_TaskGuide`, `Step3_Combat_TaskGuide` and `Step_WorldProgression_TaskGuide` and `Step_FactionProgression_TaskGuide` may use it after the first turn. First-turn inventory, combat audit, world and faction initialization, combat calculation logs, simple turns and the remaining mechanical stages still receive the complete inline guides. On demand, the relay materializes the exact static rule, literary and world-logic guides, plus a line index, under its private `rule-bundles/<content-hash>/` directory. The browser verifies that the returned rule, literary and world-logic hashes match its own bundled sources before using a reference. The server rechecks the files before queueing a referenced request. Missing, changed, stale, or unsupported bundles fall back to the full inline prompt; this does not alter the save or stage contract.

For a packet with `ruleBundleId`, the GM **must verify the four SHA-256 hashes stated in `<LocalRuleReference>`**, read the complete `narrative.txt` for narrative synthesis; for NPC detail processing, consult the relevant parts of `narrative.txt` and read `world.txt`; for inventory, read the relevant item, weight, equipment, resource, crafting and journal rules named in the task, including cross-references; for the combat audit, inspect the cited combat, resistance, effects and wound rules before verifying the prior combat log; for world progression, read the full world and narrative guides, the cited world-simulation rules and their cross-references, and account for prior faction events; for faction progression, read the full world and narrative guides and the cited economy, project, territory and consequence rules. For each stage, consult `rules.txt` using `index.txt` for rules relevant to the current task and any cross-references. The files supplement the stage instruction and current context, not replace them. If a file becomes unavailable or fails verification after queueing, reply with the usual response envelope and `output: {"_arenaRuleBundleUnavailable": true}`. The app then repeats the stage with the full inline guides; do not invent rules or return a partial narrative. This special response is only valid for a referenced stage.

The bundle contains static rules, not game context or credentials. It is local workspace storage, not provider-side model caching; no token savings or literary improvement is guaranteed. Versioned files remain while the relay directory exists, including for queued requests. The standard `.arena-gm-relay/` directory is private and ignored by Git.

### World-to-NPC activity handoff

After an enabled world-progression stage, if NPCs already exist or a preceding stage reported NPC data, the turn runs the NPC stage before finalization even when Step 0 initially marked the turn simple or did not request NPC processing. The world stage simulates off-screen activity; the NPC stage reports any resulting `NPCActivityUpdates` or `completeNPCActivities` using its existing contract. This does not force world progression when it is disabled or unrequested, nor does it prove that the GM will choose or calculate an activity correctly.

### Faction-event to NPC handoff

When an enabled faction-progression stage creates or changes a world event and existing or reported NPCs are present, the turn runs the NPC stage even if world progression was not requested and Step 0 marked the turn simple. The faction stage logs possible NPC motivations without emitting keys outside its existing whitelist; the NPC stage evaluates the accumulated event and logs, and reports justified goals or personal quests using its existing atomic commands. If the faction stage produces no new or changed event, this handoff does not by itself run. The handoff does not force a reaction, and world/faction progression remain subject to their existing gates.

### Combat-end NPC handoff

If combat ends with both combatant arrays explicitly empty and named NPCs are known, the turn also runs the NPC stage. The combat log must provide evidence for final named-NPC health and effects; the combat stage reports wounds and effects using its allowed atomic keys, and the NPC stage can report supported final health in `NPCsData`. This handoff does not compute or invent missing values and is not proof that the GM calculated them correctly. The combat-log stage continues to receive the full guide.

### Multiplayer turn synchronization

Hosts and players must run the updated protocol together; older peers without
protocol version 1 cannot submit turns or restore a full sync. Reconnect after
switching hosts or restarting the host session. Each host session issues a
revision with its authoritative snapshot. Player turns and questions include
that revision and a unique turn ID. A host consumes the grant once and rejects
late, duplicate, unauthorized, or incompatible results. A sync request revokes
the old grant before the replacement snapshot is sent; a pending host state
update delays publication until a current snapshot is available.

An ACK is best-effort, not a reliable delivery guarantee. If sending was
cancelled or an ACK/sync is lost, delivery can be unknown: request a host sync
and inspect the authoritative result before retrying. Do not repeat an action
just because an ACK was not received. Protocol IDs and PeerJS connection IDs
are concurrency checks, not authentication or protection against a malicious
host/player. The accepted-ID registry is in memory for the hosting session.

On the player, a received grant stays unusable until the corresponding state,
context and history/log snapshot has been restored and rendered. If restoring
fails, the grant remains blocked and the same revision can be retried; request
another synchronization or reconnect. This avoids using a fresh revision with
a previous client state while React updates are still pending.
