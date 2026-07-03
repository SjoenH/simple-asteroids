# Simple Asteroids

A multiplayer Asteroids game played on the surface of a sphere, built with Pixi.js and Cloudflare Workers.

## Features

- **Spherical world**: Play on a continuous 3D sphere surface with no edge wrapping
- **Multiplayer**: Real-time multiplayer via PartyKit/Cloudflare Workers
- **Private rooms**: Create shareable private game rooms with funny URLs like `penguin-bounces-wildly`
- **Lives system**: 3 lives per player with respawning
- **Power-ups**: Extra life, invisibility, and multi-cannon pickups
- **NPC opponents**: AI bots that dodge, chase, and shoot
- **Lobby system**: Choose your name and ship color, ready up, and let the host start the game
- **Dynamic camera**: Zoomed viewport that follows your ship with smooth rotation
- **Debug overlay**: Multi-cam view showing off-screen players when you're game over

## Tech Stack

- **Client**: Pixi.js for rendering
- **Server**: PartyKit (Cloudflare Workers) for multiplayer backend
- **State management**: XState v5 for player and game state machines
- **Build**: Vite (client), esbuild (worker)
- **Tests**: Vitest with 50+ unit tests
- **Package manager**: pnpm

## Setup

```bash
# Install dependencies
pnpm install

# Run development server (client + worker)
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Type check
npx tsc --noEmit                      # client
npx tsc -p tsconfig.worker.json --noEmit  # worker
```

## How to Play

### Starting a Game

1. Enter your name
2. Choose to join the public game room or create a private room
3. Pick your ship color from the color palette
4. Click "Ready" when you're set
5. When all players are ready, the host clicks "Start Game"

### Controls

- **W / ↑**: Thrust forward
- **A / ←**: Rotate left
- **D / →**: Rotate right
- **S / ↓**: Brake (decelerate)
- **Space**: Shoot
- **Escape**: Surrender (instant game over)

### Gameplay

- Destroy asteroids to earn points
- Shoot other players and NPCs for 10 points per kill
- Collect power-ups:
  - **Green**: Extra life
  - **Purple**: Invisibility (5 seconds)
  - **Orange**: Multi-cannon (8 seconds)
- You have 3 lives; respawn takes 3 seconds
- When all human players are out of lives, the round ends and everyone returns to the lobby

### Host Controls

- The first player to join a room becomes the host
- Host can kick players from the lobby
- If the host leaves, another player becomes the new host

## Project Structure

```
simple-asteroids/
├── src/
│   ├── main.ts           # Client code (rendering, input, UI)
│   └── style.css         # Lobby UI styles
├── party/
│   ├── server.ts         # Server code (game loop, state machines, lobbies)
│   └── physics.ts        # Pure physics/math functions (sphere movement, NPC AI)
├── tests/
│   ├── physics.test.ts   # Unit tests for math functions
│   └── game-logic.test.ts # Unit tests for game logic and state machines
└── AGENTS.md             # Development notes
```

## Architecture Notes

- **Sphere physics**: Players move on a 3D sphere (radius 1000) with continuous tangent-space velocity
- **Forward vector system**: No heading angles; rotation uses 3D forward vectors to avoid pole singularities
- **Pure physics layer**: All math/physics in `party/physics.ts` for easy testing without server dependencies
- **State machines**: `playerMachine` manages alive/dead/gameOver states; `gameMachine` handles lobby/playing transitions
- **Lobby/game separation**: Players exist in `lobbyPlayers` during lobby, moved to `players` map during active rounds

## License

MIT
