import './style.css';

import * as signalR from '@microsoft/signalr';
import {
  Application,
  Assets,
  Container,
  Sprite,
  Text,
  TextStyle,
} from 'pixi.js';

// ── Config ────────────────────────────────────────────────────────────────────

/** Override via VITE_HUB_URL env var (e.g. in a .env.local file). */
const HUB_URL: string = import.meta.env.VITE_HUB_URL ?? 'https://localhost:7159/game';

const ASSET_PATHS = {
  player: '/assets/Player.png',
  asteroid: '/assets/Asteroid.png',
  bullet: '/assets/Bullet.png',
  star: '/assets/Star.png',
} as const;

/** Tint colours cycled for newly joining players (yellow is reserved for the local player). */
const PEER_COLORS: number[] = [
  0x00ff88, 0xff44ff, 0x44ddff, 0xff8800, 0xaaaaff, 0xff4455,
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlayerEntry {
  container: Container;
  sprite: Sprite;
  label: Text;
  /** Server-authoritative target position for lerp. */
  targetX: number;
  targetY: number;
  score: number;
}

// ── Mutable state ─────────────────────────────────────────────────────────────

const players = new Map<string, PlayerEntry>();
const asteroids = new Map<string, Sprite>();
const bullets = new Map<string, Sprite>();

let localId: string | null = null;
let playerName = '';
let connected = false;

// ── Pixi application (top-level await is fine in an ES module) ────────────────

const app = new Application();
await app.init({
  resizeTo: window,
  backgroundColor: 0x000011,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
});
document.body.appendChild(app.canvas);

await Assets.load(Object.values(ASSET_PATHS));

// ── Scene layers (bottom → top: stars → game → hud) ──────────────────────────

const starsLayer = new Container();
const gameLayer = new Container();
const hudLayer = new Container();
app.stage.addChild(starsLayer, gameLayer, hudLayer);

// ── Starfield ─────────────────────────────────────────────────────────────────

const starSprites: Sprite[] = [];

function buildStarfield(): void {
  for (let i = 0; i < 160; i++) {
    const s = Sprite.from(ASSET_PATHS.star);
    s.anchor.set(0.5);
    s.x = Math.random() * app.screen.width;
    s.y = Math.random() * app.screen.height;
    s.scale.set(Math.random() * 0.22 + 0.04);
    s.alpha = Math.random() * 0.6 + 0.15;
    starsLayer.addChild(s);
    starSprites.push(s);
  }
}

buildStarfield();

// ── HUD ───────────────────────────────────────────────────────────────────────

const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: 'monospace',
  fontSize: 13,
  fill: 0xffffff,
};

/** Create a Text node with the shared base style, optionally overriding fields. */
function makeText(
  content: string,
  overrides: Partial<TextStyle> = {},
): Text {
  return new Text({ text: content, style: new TextStyle({ ...BASE_STYLE, ...overrides }) });
}

const statusText = makeText('Connecting…', { fill: 0xffaa00 });
statusText.position.set(10, 10);
hudLayer.addChild(statusText);

const fpsText = makeText('FPS: --');
fpsText.position.set(10, 28);
hudLayer.addChild(fpsText);

const controlsText = makeText(
  'WASD / ↑←↓→ — fly   SPACE — shoot',
  { fontSize: 11, fill: 0x445566 },
);
controlsText.anchor.set(0.5, 1);
hudLayer.addChild(controlsText);

const scoreContainer = new Container();
scoreContainer.position.set(10, 50);
hudLayer.addChild(scoreContainer);

function positionHUD(): void {
  controlsText.x = app.screen.width / 2;
  controlsText.y = app.screen.height - 8;
}
positionHUD();
app.renderer.on('resize', positionHUD);

function refreshScoreboard(): void {
  scoreContainer.removeChildren();
  let y = 0;
  for (const [id, p] of players) {
    const isMe = id === localId;
    const entry = makeText(
      `${isMe ? '▶' : ' '} ${id.slice(0, 8)}  ${p.score}`,
      { fontSize: 12, fill: isMe ? 0xffff00 : 0x888899 },
    );
    entry.y = y;
    scoreContainer.addChild(entry);
    y += 16;
  }
}

function setStatus(text: string, color: number): void {
  statusText.text = text;
  statusText.style = new TextStyle({ ...BASE_STYLE, fill: color });
}

// ── Game loop ─────────────────────────────────────────────────────────────────

app.ticker.add(() => {
  fpsText.text = `FPS: ${Math.round(app.ticker.FPS)}`;

  // Randomly twinkle a few stars each frame.
  if (Math.random() < 0.4) {
    const s = starSprites[Math.floor(Math.random() * starSprites.length)];
    s.alpha = Math.random() * 0.6 + 0.15;
  }

  // Smoothly interpolate each player sprite toward the server-authoritative position.
  for (const p of players.values()) {
    p.container.x += (p.targetX - p.container.x) * 0.18;
    p.container.y += (p.targetY - p.container.y) * 0.18;
  }
});

// ── Player sprite helpers ─────────────────────────────────────────────────────

function colorForIndex(index: number): number {
  return PEER_COLORS[index % PEER_COLORS.length];
}

function ensurePlayer(id: string): PlayerEntry {
  if (players.has(id)) return players.get(id) as PlayerEntry;

  const isMe = id === localId;

  const container = new Container();

  const sprite = Sprite.from(ASSET_PATHS.player);
  sprite.anchor.set(0.5);
  sprite.tint = isMe ? 0xffff00 : colorForIndex(players.size);

  const label = makeText(id.slice(0, 8), {
    fontSize: 11,
    fill: isMe ? 0xffff00 : 0xddddee,
  });
  label.anchor.set(0.5, 0);
  label.y = 20;

  container.addChild(sprite, label);
  gameLayer.addChild(container);

  const entry: PlayerEntry = {
    container, sprite, label,
    targetX: 0, targetY: 0,
    score: 0,
  };
  players.set(id, entry);
  return entry;
}

function dropPlayer(id: string): void {
  const p = players.get(id);
  if (!p) return;
  gameLayer.removeChild(p.container);
  players.delete(id);
}

function movePlayer(id: string, x: number, y: number, rotation?: number): void {
  const p = ensurePlayer(id);
  p.targetX = x;
  p.targetY = y;
  if (rotation !== undefined) p.sprite.rotation = rotation;
}

function ensureAsteroid(id: string, x: number, y: number): void {
  if (!asteroids.has(id)) {
    const s = Sprite.from(ASSET_PATHS.asteroid);
    s.anchor.set(0.5);
    gameLayer.addChildAt(s, 0); // render below players
    asteroids.set(id, s);
  }
  const s = asteroids.get(id) as Sprite;
  s.x = x;
  s.y = y;
}

function dropAsteroid(id: string): void {
  const s = asteroids.get(id);
  if (!s) return;
  gameLayer.removeChild(s);
  asteroids.delete(id);
}

function ensureBullet(id: string, x: number, y: number): void {
  if (!bullets.has(id)) {
    const s = Sprite.from(ASSET_PATHS.bullet);
    s.anchor.set(0.5);
    s.scale.set(0.6);
    gameLayer.addChildAt(s, 0); // render below players
    bullets.set(id, s);
  }
  const s = bullets.get(id) as Sprite;
  s.x = x;
  s.y = y;
}

function dropBullet(id: string): void {
  const s = bullets.get(id);
  if (!s) return;
  gameLayer.removeChild(s);
  bullets.delete(id);
}

// ── Keyboard input → server ───────────────────────────────────────────────────

const keys = new Set<string>();

window.addEventListener('keydown', (e: KeyboardEvent) => {
  keys.add(e.code);
  // Prevent space from scrolling the page.
  if (e.code === 'Space') e.preventDefault();
});

window.addEventListener('keyup', (e: KeyboardEvent) => {
  keys.delete(e.code);
});

let lastInputSent = 0;

app.ticker.add(() => {
  if (!connected || !localId) return;
  const now = performance.now();
  if (now - lastInputSent < 33) return; // ~30 Hz
  lastInputSent = now;

  const thrust = keys.has('KeyW') || keys.has('ArrowUp');
  const rotateLeft = keys.has('KeyA') || keys.has('ArrowLeft');
  const rotateRight = keys.has('KeyD') || keys.has('ArrowRight');
  const shoot = keys.has('Space');

  connection
    .invoke('PlayerInput', thrust, rotateLeft, rotateRight, shoot)
    .catch((err: unknown) => {
      // Server may not implement PlayerInput yet; suppress to avoid noise.
      if (import.meta.env.DEV) console.debug('PlayerInput not handled:', err);
    });
});

// ── SignalR connection ────────────────────────────────────────────────────────

const connection = new signalR.HubConnectionBuilder()
  .withUrl(HUB_URL, {
    skipNegotiation: true,
    transport: signalR.HttpTransportType.WebSockets,
  })
  .withAutomaticReconnect()
  .configureLogging(signalR.LogLevel.Warning)
  .build();

connection.onreconnecting(() => {
  connected = false;
  setStatus('⏳ Reconnecting…', 0xffaa00);
});

connection.onreconnected(() => {
  connected = true;
  setStatus('✓ Connected', 0x00ff88);
});

connection.onclose(() => {
  connected = false;
  setStatus('✗ Disconnected — refresh to retry', 0xff4444);
});

// ── Server → client events ────────────────────────────────────────────────────

connection.on('playerJoined', (id: string) => {
  ensurePlayer(id);
  refreshScoreboard();
});

connection.on('playerLeft', (id: string) => {
  dropPlayer(id);
  refreshScoreboard();
});

/** Server may pass an optional 4th rotation parameter (radians). */
connection.on('playerMoved', (id: string, x: number, y: number, rotation?: number) => {
  movePlayer(id, x, y, rotation);
});

connection.on('asteroidMoved', (id: string, x: number, y: number) => {
  ensureAsteroid(id, x, y);
});

connection.on('asteroidRemoved', (id: string) => {
  dropAsteroid(id);
});

connection.on('bulletMoved', (id: string, x: number, y: number) => {
  ensureBullet(id, x, y);
});

connection.on('bulletRemoved', (id: string) => {
  dropBullet(id);
});

connection.on('playerKilled', (id: string) => {
  const p = players.get(id);
  if (!p) return;
  p.sprite.visible = false;
  p.label.text = '💀';
});

connection.on('playerRespawned', (id: string, x: number, y: number) => {
  const p = ensurePlayer(id);
  // Snap immediately on respawn instead of lerping from the old position.
  p.container.x = p.targetX = x;
  p.container.y = p.targetY = y;
  p.sprite.visible = true;
  p.label.text = id.slice(0, 8);
});

/** Optional event — emitted if the server tracks individual scores. */
connection.on('scoreUpdated', (id: string, score: number) => {
  const p = players.get(id);
  if (!p) return;
  p.score = score;
  refreshScoreboard();
});

// ── Connection lifecycle ──────────────────────────────────────────────────────

async function connect(): Promise<void> {
  setStatus('⏳ Connecting…', 0xffaa00);
  try {
    await connection.start();
    localId = connection.connectionId;
    connected = true;
    setStatus('✓ Connected', 0x00ff88);
    // Let the server know our display name (no-op if not implemented server-side).
    await connection.invoke('SetName', playerName).catch(() => {});
  } catch {
    setStatus('✗ Connection failed — retrying…', 0xff4444);
    setTimeout((): void => { void connect(); }, 3_000);
  }
}

// ── Name-entry screen (HTML overlay) ─────────────────────────────────────────

function showNameEntry(): void {
  const overlay = document.createElement('div');
  overlay.id = 'name-overlay';
  overlay.innerHTML = `
    <div class="nd">
      <h1>🚀 Simple Asteroids</h1>
      <p>Enter your pilot name to join:</p>
      <input id="pname" type="text" maxlength="20" placeholder="Ace Pilot" />
      <button id="join-btn">Launch!</button>
      <p class="hint">WASD / ↑←↓→ — fly &nbsp;·&nbsp; SPACE — shoot</p>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>('#pname') as HTMLInputElement;
  const btn = overlay.querySelector<HTMLButtonElement>('#join-btn') as HTMLButtonElement;
  input.focus();

  const join = (): void => {
    const raw = input.value.trim();
    playerName = raw.length > 0 ? raw : `Pilot${Math.floor(Math.random() * 999)}`;
    overlay.remove();
    void connect();
  };

  btn.addEventListener('click', join);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') join();
  });
}

showNameEntry();
