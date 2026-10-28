# The Book of Eternity: Chronicle of the Unwritten

A persistent, text-driven fantasy role-playing game. Players explore a reactive world, meet characters and factions, pursue quests, manage inventory and character progression, and build a story through consequential choices. The app includes a staged game-master pipeline, save/load support, world simulation, and optional multiplayer.

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
4. Keep an Arena agent session available. The application cannot wake or invoke an agent when a request appears. For each pending relay request, the agent must inspect `.arena-gm-relay/pending.json` and write the matching response to `.arena-gm-relay/response.json`. The detailed per-stage, image, and recovery instructions are in [docs/ARENA-DEPLOYMENT.md](docs/ARENA-DEPLOYMENT.md).

The relay is enabled by default. The in-game **Arena GM Relay** control can disable it, which may re-enable provider paths that require their own API credentials.

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

`npm run build` checks and bundles the app. The file relay is development-server middleware, so a built static site or `vite preview` alone cannot service relay requests. For a production deployment, implement and configure a persistent server-side mailbox adapter; do not expose workspace files directly to the public internet.

## Relay docs

- [Arena deployment and setup](docs/ARENA-DEPLOYMENT.md)
- [Relay protocol and safety notes](docs/arena-gm-relay.md)

## Notes

- `.arena-gm-relay/` is transient runtime state and is deliberately ignored by Git.
- Never commit API keys, saved games, relay payloads, or generated images.
- `npm run relay:watch` is an optional local mailbox watcher; it only announces requests and does not contact or wake the Arena agent.
- The repository currently has no automated regression-test suite. Use `npm run build` to validate a deployment build.
