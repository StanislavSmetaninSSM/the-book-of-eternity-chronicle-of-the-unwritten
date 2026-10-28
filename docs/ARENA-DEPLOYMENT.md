# Run this project in an Arena workspace

This is a practical setup guide for rebuilding the Arena-adapted game from the repository. The Arena game-master connection is a **manual, file-based relay**. It is not an Arena agent plugin or background invocation API: the browser cannot invoke/wake an agent. The agent must be asked to handle mailbox files in the same workspace while the game is waiting.

## 1. Start the app

From the repository root in an Arena terminal:

```sh
npm ci
npm run arena:preview
```

Open the Vite preview created by this command and keep the process alive. `arena:preview` builds the app and serves the built files with `vite preview` (no Vite HMR client / WebSocket auto-reload), while `vite.config.ts` also registers the filesystem relay middleware on the preview server. The relay endpoints are `/__arena_gm/turn`, `/__arena_gm/response`, `/__arena_gm/cancel`, `/__arena_gm/image`, and `/__arena_gm/status`. If you are actively developing code, `npm run dev -- --host 0.0.0.0` remains available, but its HMR WebSocket recovery may reload the page if the connection is lost; use `arena:preview` for a more stable game session.

Keep the preview process running in the same workspace as the `.arena-gm-relay` mailbox. Start the optional mailbox watcher separately with `npm run relay:watch` if desired. After changing code, rerun `npm run arena:preview` to rebuild and serve the updated app.

The Arena relay is the only configured backend. The app sends each game-generation pipeline step separately. The server persists requests in a queue and exposes only one active `pending.json`; turn stages are prioritized over images and each response is isolated by correlation ID. The browser holds a whole-turn lease, serializes image requests, and defers them until all stages for that player action finish. One action may require multiple agent responses.

## 2. What the agent needs to do

The Arena agent must have access to this same repository workspace. When the game is waiting:

1. Read `.arena-gm-relay/pending.json`.
2. Follow that packet's `instructions` and `prompt` exactly. For `arena-gm-step`, perform only the named step and honor the prompt's output-key contract. Do not combine the entire turn into one response.
3. Write the response envelope atomically to `.arena-gm-relay/responses/<correlationId>.json`, using the exact ID from the packet and its required response `kind`. For `arena-gm-step`, include only that stage's output object. The Vite server returns only the matching response and then promotes the next queued request.
4. Continue checking the active `pending.json` until the game finishes that action or the user cancels. A step/correction response may be followed immediately by another step request; never combine the stages.

You may run the optional watcher in another terminal to see when the mailbox changes:

```sh
npm run relay:watch
```

The watcher monitors only the active `pending.json`; it is only a notifier. It does not call an agent, write a response, inspect the private server-side queue, or make the agent autonomous. An active agent turn/user interaction is still required. Responses live under `responses/<correlationId>.json`, so unrelated requests cannot overwrite each other's results. The legacy `.arena-gm-relay/response.json` path remains accepted for compatibility, but new requests should use the correlation-specific path.

### Stage response envelope

For an `arena-gm-step` packet, write `.arena-gm-relay/responses/<correlationId>.json` in this form. Copy the actual correlation ID from the request and set `output` to the JSON object for this one stage (not a complete `GameResponse`):

```json
{
  "kind": "arena-gm-step-response",
  "protocolVersion": 1,
  "correlationId": "COPY-THE-REQUEST-CORRELATION-ID",
  "output": {
    "only": "the keys requested by this step's prompt"
  }
}
```

Do not copy the illustrative `output` key as a literal schema. The current step's prompt defines the valid keys. For example, the game can request analysis/planning, world/faction progression, a simple full response, or a correction step, and each has a different output contract.

### Image request/response

An image request has `kind: "arena-gm-image"`, a prompt, and requested dimensions. Generate one PNG image for the prompt and save it at:

```text
.arena-gm-relay/images/<REQUEST-CORRELATION-ID>.png
```

Then write `.arena-gm-relay/responses/<correlationId>.json`:

```json
{
  "kind": "arena-gm-image-response",
  "protocolVersion": 1,
  "correlationId": "COPY-THE-REQUEST-CORRELATION-ID"
}
```

The PNG must be in the same workspace so the Vite middleware can read it. The response envelope alone is insufficient if the image file was not created. The image pipeline currently expects PNG output.

## 3. Verify the setup

- `npm run build` should complete successfully.
- Open the in-game **Arena GM Relay** control and confirm it says `ON`.
- Submit a simple player action and verify a pending stage request appears in `.arena-gm-relay/pending.json` while the game waits.
- Have the Arena agent write a correctly correlated stage response. The game should resume and may request another step before applying the turn.
- Request/regenerate an image to exercise the separate image packet and file response.

If you can see the preview but the request stays waiting, confirm the Vite dev server is still running, the Arena agent is using the same workspace, the request's exact correlation ID was copied, and the response file is valid JSON with the expected `kind` and `protocolVersion`.

## 4. What is and is not persisted

- `.arena-gm-relay/` contains transient requests, responses, and generated images; `.gitignore` excludes it. Do not commit it.
- Game save data is managed by the app and browser storage; it is separate from the relay mailbox. An in-progress local turn stores its submitted action, pre-turn state, and history in IndexedDB so the start screen can offer **Resume** or **Discard** after a reload.
- Resume replays the submitted action from the saved pre-turn baseline. It is not an exact continuation of an intermediate generation stage, so already completed stages may be generated again. Recovery is limited to local single-player turns.
- The browser never receives provider secrets through relay packets. Avoid putting credentials into prompts or response files.
- A repository clone by itself cannot restore an in-flight mailbox or browser save. Recreate those in the new workspace as needed.

## 5. Production deployment

The current relay is Vite middleware backed by local filesystem I/O. It runs in the repository's dev server and `vite preview` server, but is not included in `vite build` output or available on generic static hosting. To deploy outside the Arena workspace, build an authenticated server-side mailbox adapter that implements the same request/response correlation protocol, stores image files securely, enforces request size and access limits, and is reachable by the browser through same-origin relative URLs. Do not publish `.arena-gm-relay` or add a public file server for the workspace. The agent invocation step will remain manual unless Arena provides an authorized invocation mechanism.

## 6. Troubleshooting

- **`Failed to fetch` / endpoint 404:** run `npm run arena:preview` (or the Vite dev server) from this repository; generic static hosting does not include the filesystem relay middleware.
- **Request waits indefinitely:** the app cannot invoke the agent. Start/continue an Arena agent interaction and have it process the pending file.
- **Response ignored:** verify exact `correlationId`, `kind`, `protocolVersion: 1`, valid JSON, and that the response is in `.arena-gm-relay/responses/<correlationId>.json` (or, for a legacy client only, `.arena-gm-relay/response.json`).
- **Image not displayed:** verify the PNG exists at the correlation-ID path and is readable before writing the image response envelope.
