# The Book of Eternity: Chronicle of the Unwritten

A persistent, text-driven fantasy role-playing game. Players explore a reactive world, meet characters and factions, pursue quests, manage inventory and character progression, and build a story through consequential choices. The app includes a staged game-master pipeline, save/load support, world simulation, and local party or multiple-personality play. Network multiplayer is no longer supported; legacy multiplayer saves are converted to local games on load.

This fork is adapted to use the **Arena conversation agent as the game master** through a workspace-backed relay. It does not require a separate LLM provider for the default game-master path. Image generation can also be requested from the Arena agent. See [Arena deployment and relay guide](docs/ARENA-DEPLOYMENT.md) before running it in a fresh Arena workspace.

## Requirements

- Node.js 20 or newer (Node 22 recommended)
- npm
- An Arena workspace/agent session with access to this project's working directory for file-based relay

## Run in Arena

1. Open/clone this repository in the Arena workspace.
2. In the project terminal, install dependencies and start the Vite development server:

   ```sh
   npm install
   npm run dev -- --host 0.0.0.0
   ```

3. Open the Vite preview. Keep the dev server running: the relay's HTTP endpoints are provided by the Vite development middleware and are not part of a static production build.
4. Keep an Arena agent session available. The application cannot wake or invoke an agent when a request appears. For each active relay request, inspect `.arena-gm-relay/pending.json` and write its response atomically to `.arena-gm-relay/responses/<correlationId>.json`. The relay queues concurrent jobs without overwriting the active request and prioritizes game-turn stages over images. Detailed per-stage, image, and recovery instructions are in [docs/ARENA-DEPLOYMENT.md](docs/ARENA-DEPLOYMENT.md); the persistent agent workflow for monitoring sequential stages is in [AGENTS.md](AGENTS.md). The watcher only notifies and cannot process requests or wake an agent.

AI generation is fixed to the Arena GM relay; there is no provider/model selector, external model API key field, or provider-off switch in the game.

## Local development without Arena

```sh
npm install
npm run dev
```

The Vite server uses `0.0.0.0` by default. Without a responding Arena agent, an enabled relay request waits until it is answered or cancelled. Do not expect the game to automatically call an AI service.

## Build

```sh
npm run build
npm run preview -- --host 0.0.0.0
```

`npm run build` checks and bundles the app. The file relay is supplied by this repository’s Vite middleware in both the development server and `vite preview`; generic static hosting cannot service relay requests. For a production deployment, implement and configure a persistent server-side mailbox adapter; do not expose workspace files directly to the public internet.

## Relay docs

- [Arena deployment and setup](docs/ARENA-DEPLOYMENT.md)
- [Relay protocol and safety notes](docs/arena-gm-relay.md)

## Notes

- `.arena-gm-relay/` is transient runtime state and is deliberately ignored by Git.
- Never commit API keys, saved games, relay payloads, or generated images.
- `npm run relay:watch` is an optional local mailbox watcher; it only announces requests and does not contact or wake the Arena agent.
- Run `npm test`, `npm run typecheck`, and `npm run build` to validate changes. Automated tests do not replace a real browser/game-master playthrough.

Legacy network saves retain their character IDs, party, story and inventory. The active character becomes the locally controlled character. Unfinished collective/simultaneous actions are kept as inert `legacyNetworkActions` in the save rather than executed. An interrupted network-turn checkpoint cannot safely be replayed because its delivery was not known; load a normal or crash-recovery save instead. Local interrupted turns remain resumable.
