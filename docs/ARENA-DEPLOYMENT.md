# Run this project in an Arena workspace

This is a practical setup guide for rebuilding the Arena-adapted game from the repository. The Arena game-master connection is a **manual, file-based relay**. It is not an Arena agent plugin or background invocation API: the browser cannot invoke/wake an agent. The agent must be asked to handle mailbox files in the same workspace while the game is waiting.

## 1. Start the app

From the repository root in an Arena terminal:

```sh
npm install
npm run dev -- --host 0.0.0.0
```

Open the Vite preview created by the dev server and keep the process alive. `vite.config.ts` registers the relay middleware that implements `/__arena_gm/turn`, `/__arena_gm/response`, `/__arena_gm/image`, and `/__arena_gm/status`. The file relay works with this Vite development server; it is not included in `vite build` output or a static hosting deployment.

The Arena relay is the only configured backend. The app sends each game-generation pipeline step separately. It waits for the matching response before continuing to the next step, so one player action may require multiple agent responses. The image generation path also makes a separate relay request for each image.

## 2. What the agent needs to do

The Arena agent must have access to this same repository workspace. When the game is waiting:

1. Read `.arena-gm-relay/pending.json`.
2. Follow that packet's `instructions` and `prompt` exactly. For `arena-gm-step`, perform only the named step and honor the prompt's output-key contract. Do not combine the entire turn into one response.
3. Write a response JSON object to `.arena-gm-relay/response.json` with the same `correlationId` and protocol version. The Vite server detects the matching response and resumes the browser pipeline.
4. Continue checking for the next pending packet until the game finishes that action or the user cancels. A step/correction response may be followed immediately by another step request.

You may run the optional watcher in another terminal to see when the mailbox changes:

```sh
npm run relay:watch
```

The watcher is only a notifier. It does not call an agent, write a response, or make the agent autonomous. An active agent turn/user interaction is still required. Do not leave a stale response file in the mailbox; the server clears the previous response when accepting a new request.

### Stage response envelope

For an `arena-gm-step` packet, write `.arena-gm-relay/response.json` in this form. Copy the actual correlation ID from the request and set `output` to the JSON object for this one stage (not a complete `GameResponse`):

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

Then write `.arena-gm-relay/response.json`:

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
- Game save data is managed by the app and browser storage; it is separate from the relay mailbox.
- The browser never receives provider secrets through relay packets. Avoid putting credentials into prompts or response files.
- A repository clone by itself cannot restore an in-flight mailbox or browser save. Recreate those in the new workspace as needed.

## 5. Production deployment

The current relay is a Vite **development middleware** backed by local filesystem I/O. `npm run build` creates the front end, not the relay service. To deploy outside the Arena workspace, build an authenticated server-side mailbox adapter that implements the same request/response correlation protocol, stores image files securely, enforces request size and access limits, and is reachable by the browser through same-origin relative URLs. Do not publish `.arena-gm-relay` or add a public file server for the workspace. The agent invocation step will remain manual unless Arena provides an authorized invocation mechanism.

## 6. Troubleshooting

- **`Failed to fetch` / endpoint 404:** use the Vite dev server from this repository, not a static build preview or generic static host.
- **Request waits indefinitely:** the app cannot invoke the agent. Start/continue an Arena agent interaction and have it process the pending file.
- **Response ignored:** verify exact `correlationId`, `kind`, `protocolVersion: 1`, valid JSON, and that `response.json` is in the workspace root's `.arena-gm-relay` directory.
- **Image not displayed:** verify the PNG exists at the correlation-ID path and is readable before writing the image response envelope.
