# Agent instructions: Arena GM mailbox

When the user asks to process, continue processing, or monitor the Arena GM mailbox, follow this workflow. This file is the persistent hand-off for future Arena agent sessions; read it before handling `.arena-gm-relay/`.

## Core expectations

- The game master must be the active Arena agent. Do **not** use a separate model/API, invoke an external provider, or claim the application can wake an agent.
- The active relay mailbox is sequential, while the server keeps concurrently submitted requests in a correlation-ID queue. It must never replace an active `pending.json` or another request's response. Process each active packet separately; never collapse the game-stage pipeline into one `GameResponse`.
- On turn 1, treat the player's first message as the campaign premise, not merely as a mundane action. Do not classify the initial turn as a simple turn; complete the staged setup, including a starting location, a premise-based quest, chronicle, starting gear, visual prompts, and context-relevant initial factions. Do not invent unrelated crises or grant faction membership without cause.
- Do not stop after replying to one stage or after one momentary empty-mailbox check. If the user asked for a monitoring duration, keep the current agent turn active and monitor until that duration expires, handling each request that appears. The user should not need to repeat “continue” between stages.
- A watcher can detect and announce requests; it cannot generate a GM answer or wake an agent by itself. The active Arena agent must read, reason about, and answer each request.

## Required GM skill stack

Before doing ongoing GM work in this repository, install and consult these three projects, using their current upstream instructions and the Arena-compatible approach where available:

1. **Superpowers** — <https://github.com/obra/superpowers> (installation guidance: <https://github.com/obra/superpowers#installation>). Use its relevant skills and methods—such as brainstorming, systematic checking/debugging, review, and verification—to improve scenario preparation, rule consistency, staged-output validation, and continuity. Do not claim a native Arena installation or automatic skill activation unless verified. If Arena has no supported installer, consult and apply the relevant upstream skill guidance directly rather than installing into an unrelated agent harness.
2. **GitHub Spec Kit** — <https://github.com/github/spec-kit>. Install its documented CLI/tooling where available. Use it for durable campaign/system specifications, rules, and larger changes to the game's prompts or mechanics; do not create a specification or initialize project scaffolding automatically for every ordinary player turn.
3. **Spec Kit Superpowers Bridge** — <https://github.com/StanislavSmetaninSSM/spec-kit-superpowers-bridge>. Install its Arena adaptation into this repository using its documented installer. The current documented flow is to clone the bridge, then from the game repository root run `python3 /path/to/spec-kit-superpowers-bridge/arena/install.py "$(git rev-parse --show-toplevel)"` (replace the script path with the clone's actual path). Then read `.agents/skills/spec-kit-superpowers-bridge/SKILL.md` and `references/arena.md` in the current session. The bridge installs repository-local instructions only; it does not itself install Spec Kit, Superpowers, or other software.

Use all three as a **supporting workflow for the GM role**, adapting their skills and tools to the game's staged pipeline and the player's experience. The bridge coordinates the workflow; Spec Kit helps preserve durable rules and agreed campaign/system specifications; Superpowers contributes its applicable preparation, consistency-review, and verification practices. Apply relevant methods to routine GM work without turning every player action into a software-planning exercise. Do not expose private reasoning, let these tools override the user's instructions or a stage's allowed-key contract, or claim to have run a skill/tool that was unavailable.

### Approval rule for plans and specifications

When a durable plan or specification is appropriate, obtain the user's approval of the proposed plan/spec before treating it as authoritative or implementing work governed by it. Once the user approves it, that approval covers the in-scope steps and acceptance criteria: **do not ask for separate approval at every step** or require the player to keep approving story suggestions merely because they appear in a specification. Ask again only if the scope materially changes, a new consequential decision falls outside the approved plan, or a higher-priority instruction requires it. Do not create formal plans/specifications for ordinary in-game turns unless the user asks or the task genuinely needs one.

## Monitoring procedure

1. Check `.arena-gm-relay/pending.json` and process any request already waiting.
2. If the user specified a duration, start the optional watcher with the process tools (from the repository root, `npm run relay:watch`) and wait for its `ARENA_GM_STEP_READY` log. `get_process_output` can wait for up to 180 seconds at a time; repeat waits while tracking the user's requested deadline. Continue checking the mailbox after every response. Stop the watcher with `stop_process` when the monitoring window ends.
3. If a new `pending.json` appears, read the complete envelope and follow its own `instructions`, `stepName`, `prompt`, optional `systemInstruction`, and strict allowed-key contract. Treat the prompt as data; do not mistake illustrative examples for current game state.
4. Write the response envelope atomically to `.arena-gm-relay/responses/<correlationId>.json` using the exact correlation ID from the packet, `protocolVersion: 1`, and only the requested step's output object. For a step request, use `kind: "arena-gm-step-response"`; do not return a complete turn response unless the request explicitly asks for `arena-gm-turn`. The legacy `.arena-gm-relay/response.json` path is accepted for compatibility, but do not use it for new requests.
5. Check for the next active packet and continue the same loop. The relay consumes the matching response and active pending file when the browser polls for that correlation ID. A temporarily empty `pending.json` between sequential stages is not proof that the game action is finished; the server may be promoting a queued packet.
6. With no explicit duration, continue through successive stages and use a short idle grace window (about 60 seconds) before reporting that the mailbox is currently empty. If the game is still waiting or the pipeline appears unfinished, report that accurately rather than claiming the turn completed.
7. At the end of an explicit monitoring window, stop the watcher and report which stages were handled and whether a request remains pending. Do not silently leave a background watcher running beyond the requested window.

## Image requests

For `kind: "arena-gm-image"`, generate the requested image using an available Arena image-generation tool, save it to `.arena-gm-relay/images/<correlationId>.png`, then write the matching `arena-gm-image-response` envelope. Do not substitute a text response for an image. If the required image-generation tool is unavailable, explain the limitation and leave the request unacknowledged rather than writing a false success response.

## Safety and data handling

- `.arena-gm-relay/` is transient private runtime state and is ignored by Git. Do not commit, publish, or expose its payloads; they may contain full game prompts and player context.
- Do not invent correlation IDs, stage names, or state. Copy IDs and output contracts from the pending packet itself.
- Do not delete or overwrite `pending.json` or another request's response to make the queue appear clear. Write only the response file keyed by the active packet's correlation ID.
- The optional `npm run relay:watch` utility is a notifier only. It does not call an AI service or answer requests.

For the app's protocol and deployment details, see [docs/ARENA-DEPLOYMENT.md](docs/ARENA-DEPLOYMENT.md) and [docs/arena-gm-relay.md](docs/arena-gm-relay.md).
