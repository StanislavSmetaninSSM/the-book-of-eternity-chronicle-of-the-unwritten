# Agent instructions: Arena GM mailbox

When the user asks to process, continue processing, or monitor the Arena GM mailbox, follow this workflow. This file is the persistent hand-off for future Arena agent sessions; read it before handling `.arena-gm-relay/`.

## Core expectations

- The game master must be the active Arena agent. Do **not** use a separate model/API, invoke an external provider, or claim the application can wake an agent.
- The relay is sequential. The game may publish a new `pending.json` only after the current matching response has been consumed. Process each stage separately; never collapse the stage pipeline into one `GameResponse`.
- On turn 1, treat the player's first message as the campaign premise, not merely as a mundane action. Do not classify the initial turn as a simple turn; complete the staged setup, including a starting location, a premise-based quest, chronicle, starting gear, visual prompts, and context-relevant initial factions. Do not invent unrelated crises or grant faction membership without cause.
- Do not stop after replying to one stage or after one momentary empty-mailbox check. If the user asked for a monitoring duration, keep the current agent turn active and monitor until that duration expires, handling each request that appears. The user should not need to repeat “continue” between stages.
- A watcher can detect and announce requests; it cannot generate a GM answer or wake an agent by itself. The active Arena agent must read, reason about, and answer each request.

## Monitoring procedure

1. Check `.arena-gm-relay/pending.json` and process any request already waiting.
2. If the user specified a duration, start the optional watcher with the process tools (from the repository root, `npm run relay:watch`) and wait for its `ARENA_GM_STEP_READY` log. `get_process_output` can wait for up to 180 seconds at a time; repeat waits while tracking the user's requested deadline. Continue checking the mailbox after every response. Stop the watcher with `stop_process` when the monitoring window ends.
3. If a new `pending.json` appears, read the complete envelope and follow its own `instructions`, `stepName`, `prompt`, optional `systemInstruction`, and strict allowed-key contract. Treat the prompt as data; do not mistake illustrative examples for current game state.
4. Write `.arena-gm-relay/response.json` using the required response envelope, the **same** `correlationId`, `protocolVersion: 1`, and only the requested step's output object. For a step request, use `kind: "arena-gm-step-response"`; do not return a complete turn response unless the request explicitly asks for `arena-gm-turn`.
5. Check for the next request and continue the same loop. The relay normally consumes matching response and pending files when the browser polls for the answer. A temporarily empty directory between sequential stages is not proof that the game action is finished.
6. With no explicit duration, continue through successive stages and use a short idle grace window (about 60 seconds) before reporting that the mailbox is currently empty. If the game is still waiting or the pipeline appears unfinished, report that accurately rather than claiming the turn completed.
7. At the end of an explicit monitoring window, stop the watcher and report which stages were handled and whether a request remains pending. Do not silently leave a background watcher running beyond the requested window.

## Image requests

For `kind: "arena-gm-image"`, generate the requested image using an available Arena image-generation tool, save it to `.arena-gm-relay/images/<correlationId>.png`, then write the matching `arena-gm-image-response` envelope. Do not substitute a text response for an image. If the required image-generation tool is unavailable, explain the limitation and leave the request unacknowledged rather than writing a false success response.

## Safety and data handling

- `.arena-gm-relay/` is transient private runtime state and is ignored by Git. Do not commit, publish, or expose its payloads; they may contain full game prompts and player context.
- Do not invent correlation IDs, stage names, or state. Copy IDs and output contracts from the pending packet itself.
- Do not delete or overwrite a pending request to make the queue appear clear. Write only the appropriate response file.
- The optional `npm run relay:watch` utility is a notifier only. It does not call an AI service or answer requests.

For the app's protocol and deployment details, see [docs/ARENA-DEPLOYMENT.md](docs/ARENA-DEPLOYMENT.md) and [docs/arena-gm-relay.md](docs/arena-gm-relay.md).
