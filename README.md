# simple-asteroids

A browser-based multiplayer Asteroids game built with [Pixi.js](https://pixijs.com/) and [SignalR](https://dotnet.microsoft.com/apps/aspnet/signalr).

## Frontend stack

| Package | Version |
|---|---|
| [pixi.js](https://pixijs.com/) | ^8 |
| [@microsoft/signalr](https://www.npmjs.com/package/@microsoft/signalr) | ^10 |
| [vite](https://vitejs.dev/) | ^8 |
| [typescript](https://www.typescriptlang.org/) | ^6 |

## Quick start

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`.  
By default the client connects to a SignalR hub at `https://localhost:7159/game`.  
Override the URL by setting `VITE_HUB_URL` in a `.env.local` file:

```
VITE_HUB_URL=https://your-server/game
```

## Controls

| Key | Action |
|---|---|
| `W` / `↑` | Thrust forward |
| `A` / `←` | Rotate left |
| `D` / `→` | Rotate right |
| `SPACE` | Shoot |

## Architecture

The frontend is intentionally **thin** — all game logic runs on the .NET SignalR backend.
The client:
1. Shows a name-entry screen, then connects to the hub.
2. Sends keyboard input to the server at ~30 Hz via `PlayerInput`.
3. Renders positions received from the server (`playerMoved`, `asteroidMoved`, `bulletMoved`, …).
4. Interpolates sprite positions each frame for smooth visuals.

## SignalR events (server → client)

| Event | Payload |
|---|---|
| `playerJoined` | `id` |
| `playerLeft` | `id` |
| `playerMoved` | `id, x, y, rotation?` |
| `asteroidMoved` | `id, x, y` |
| `asteroidRemoved` | `id` |
| `bulletMoved` | `id, x, y` |
| `bulletRemoved` | `id` |
| `playerKilled` | `id` |
| `playerRespawned` | `id, x, y` |
| `scoreUpdated` *(optional)* | `id, score` |

## SignalR methods (client → server)

| Method | Payload |
|---|---|
| `SetName` | `name` |
| `PlayerInput` | `thrust, rotateLeft, rotateRight, shoot` |

## Other branches

- [`dumbfrontend`](https://github.com/SjoenH/simple-asteroids/tree/dumbfrontend) — original minimal frontend
- [`inbrowser`](https://github.com/SjoenH/simple-asteroids/tree/inbrowser) — predecessor to this branch
