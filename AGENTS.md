# Agent Instructions

## Commands

Package manager is **pnpm**, not npm. But scripts run via `npm run`:

```bash
pnpm install                            # install deps
npm run dev                             # runs both wrangler + vite concurrently
npm run dev:lan                         # expose on LAN (0.0.0.0)
npm run build                           # vite build only
npm run deploy                          # vite build + wrangler deploy
npm test                                # vitest run
npm run check                           # typecheck both client and worker
npx tsc --noEmit                        # typecheck client only
npx tsc -p tsconfig.worker.json --noEmit  # typecheck worker only
```

## Architecture

- **Client**: `src/main.ts` (Pixi.js rendering, lobby UI, input)
- **Worker**: `src/worker.ts` routes requests to `party/server.ts` (PartyKit Durable Object)
- **Server**: `party/server.ts` (game loop, XState machines, multiplayer state)
- **Physics**: `party/physics.ts` (pure functions for sphere math, NPC AI, constants)
- **Tests**: `tests/*.test.ts` (vitest, imports from `party/physics.ts`)

Server is a PartyKit Durable Object deployed to Cloudflare Workers. Build uses Vite for client and esbuild/tsc for worker.

## Key conventions

- **Sphere coordinates**: 3D `Vec3` positions on sphere surface (radius 1000); no heading angle, only 3D `forward` vector to avoid pole singularities
- **XState v5**: `setup().createMachine()` + `interpret(machine).start()` creates synchronous actors; `actor.send(event)` transitions; `actor.getSnapshot().matches(state)` checks state
- **Physics layer**: All math/constants in `party/physics.ts`—pure functions testable without server dependencies
- **Lobby/game separation**: Players in `lobbyPlayers` map during lobby; moved to `players` map when round starts
- **Message routing bug**: `party/server.ts onMessage` must check `players` map before `lobbyPlayers`, or active players can't send input
- **Power-up messages**: Use field name `puType` (not `type`) to avoid duplicate JSON keys

## Type checking quirks

Worker typecheck (`tsconfig.worker.json`) intentionally disables `noUnusedLocals` and `noUnusedParameters` because PartyKit generates some unused DurableObjectState parameters. Client typecheck is strict.
