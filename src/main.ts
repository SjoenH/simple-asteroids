import './style.css';

import PartySocket from 'partysocket';
import {
  Application,
  Assets,
  Container,
  Sprite,
  Text,
  TextStyle,
} from 'pixi.js';

const PARTY_HOST: string = import.meta.env.VITE_PARTY_HOST ?? 'localhost:1999';

const ASSET_PATHS = {
  player: '/assets/Player.png',
  asteroid: '/assets/Asteroid.png',
  bullet: '/assets/Bullet.png',
  star: '/assets/Star.png',
} as const;

const PEER_COLORS: number[] = [
  0x00ff88, 0xff44ff, 0x44ddff, 0xff8800, 0xaaaaff, 0xff4455,
];

interface PlayerEntry {
  container: Container;
  sprite: Sprite;
  label: Text;
  targetX: number;
  targetY: number;
  score: number;
  name: string;
}

const players = new Map<string, PlayerEntry>();
const asteroids = new Map<string, Sprite>();
const bullets = new Map<string, Sprite>();

let localId: string | null = null;
let playerName = '';
let connected = false;

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

const starsLayer = new Container();
const gameLayer = new Container();
const hudLayer = new Container();
app.stage.addChild(starsLayer, gameLayer, hudLayer);

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

const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: 'monospace',
  fontSize: 13,
  fill: 0xffffff,
};

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
      `${isMe ? '▶' : ' '} ${p.name}  ${p.score}`,
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

app.ticker.add(() => {
  fpsText.text = `FPS: ${Math.round(app.ticker.FPS)}`;

  if (Math.random() < 0.4) {
    const s = starSprites[Math.floor(Math.random() * starSprites.length)];
    s.alpha = Math.random() * 0.6 + 0.15;
  }

  for (const p of players.values()) {
    p.container.x += (p.targetX - p.container.x) * 0.18;
    p.container.y += (p.targetY - p.container.y) * 0.18;
  }
});

function colorForIndex(index: number): number {
  return PEER_COLORS[index % PEER_COLORS.length];
}

function ensurePlayer(id: string, name?: string): PlayerEntry {
  if (players.has(id)) return players.get(id) as PlayerEntry;

  const isMe = id === localId;
  const displayName = name ?? id.slice(0, 8);

  const container = new Container();

  const sprite = Sprite.from(ASSET_PATHS.player);
  sprite.anchor.set(0.5);
  sprite.tint = isMe ? 0xffff00 : colorForIndex(players.size);

  const label = makeText(displayName, {
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
    name: displayName,
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
  if (rotation !== undefined) p.sprite.rotation = rotation + Math.PI / 2;
}

const ASTEROID_SCALES: Record<number, number> = { 1: 1, 2: 0.6, 3: 0.35 };

function ensureAsteroid(id: string, x: number, y: number, size?: number): void {
  if (!asteroids.has(id)) {
    const s = Sprite.from(ASSET_PATHS.asteroid);
    s.anchor.set(0.5);
    gameLayer.addChildAt(s, 0);
    asteroids.set(id, s);
  }
  const s = asteroids.get(id) as Sprite;
  s.x = x;
  s.y = y;
  if (size !== undefined) s.scale.set(ASTEROID_SCALES[size] ?? 1);
}

function dropAsteroid(id: string): void {
  const s = asteroids.get(id);
  if (!s) return;
  gameLayer.removeChild(s);
  asteroids.delete(id);
}

function ensureBullet(id: string, x: number, y: number, rotation?: number): void {
  if (!bullets.has(id)) {
    const s = Sprite.from(ASSET_PATHS.bullet);
    s.anchor.set(0.5);
    s.scale.set(0.6);
    gameLayer.addChildAt(s, 0);
    bullets.set(id, s);
  }
  const s = bullets.get(id) as Sprite;
  s.x = x;
  s.y = y;
  if (rotation !== undefined) s.rotation = rotation + Math.PI / 2;
}

function dropBullet(id: string): void {
  const s = bullets.get(id);
  if (!s) return;
  gameLayer.removeChild(s);
  bullets.delete(id);
}

const keys = new Set<string>();

window.addEventListener('keydown', (e: KeyboardEvent) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});

window.addEventListener('keyup', (e: KeyboardEvent) => {
  keys.delete(e.code);
});

// ── Mobile touch controls ─────────────────────────────────────────────────────

function setupTouchControls(): void {
  const overlay = document.createElement('div');
  overlay.id = 'touch-controls';
  overlay.innerHTML = `
    <button class="tc-btn" data-key="KeyA">◀</button>
    <button class="tc-btn" data-key="KeyW">▲</button>
    <button class="tc-btn" data-key="KeyD">▶</button>
    <button class="tc-btn tc-shoot" data-key="Space">⚡</button>
  `;
  document.body.appendChild(overlay);

  for (const btn of overlay.querySelectorAll<HTMLElement>('.tc-btn')) {
    const code = btn.dataset.key!;
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); keys.add(code); });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); keys.delete(code); });
    btn.addEventListener('touchcancel', () => { keys.delete(code); });
    btn.addEventListener('mousedown', () => { keys.add(code); });
    btn.addEventListener('mouseup', () => { keys.delete(code); });
    btn.addEventListener('mouseleave', () => { keys.delete(code); });
  }
}

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  setupTouchControls();
}

let lastInputSent = 0;

function sendInput(): void {
  if (!connected || !localId) return;
  const now = performance.now();
  if (now - lastInputSent < 33) return;
  lastInputSent = now;

  const thrust = keys.has('KeyW') || keys.has('ArrowUp');
  const rotateLeft = keys.has('KeyA') || keys.has('ArrowLeft');
  const rotateRight = keys.has('KeyD') || keys.has('ArrowRight');
  const shoot = keys.has('Space');

  ws.send(JSON.stringify({
    type: 'playerInput',
    thrust,
    rotateLeft,
    rotateRight,
    shoot,
  }));
}

app.ticker.add(sendInput);

// ── PartyKit connection ─────────────────────────────────────────────────────

let ws: PartySocket;

function handleMessage(e: MessageEvent): void {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(e.data as string);
  } catch {
    return;
  }

  switch (data.type) {
    case 'connected':
      localId = data.id as string;
      break;

    case 'playerJoined': {
      const id = data.id as string;
      const name = data.name as string | undefined;
      ensurePlayer(id, name);
      refreshScoreboard();
      break;
    }

    case 'playerLeft': {
      const id = data.id as string;
      dropPlayer(id);
      refreshScoreboard();
      break;
    }

    case 'playerRenamed': {
      const id = data.id as string;
      const name = data.name as string;
      const p = players.get(id);
      if (!p) break;
      p.name = name;
      p.label.text = name;
      refreshScoreboard();
      break;
    }

    case 'playerMoved': {
      const id = data.id as string;
      const x = data.x as number;
      const y = data.y as number;
      const rotation = data.rotation as number | undefined;
      movePlayer(id, x, y, rotation);
      break;
    }

    case 'asteroidMoved': {
      const id = data.id as string;
      const x = data.x as number;
      const y = data.y as number;
      const size = data.size as number | undefined;
      ensureAsteroid(id, x, y, size);
      break;
    }

    case 'asteroidRemoved': {
      const id = data.id as string;
      dropAsteroid(id);
      break;
    }

    case 'bulletMoved': {
      const id = data.id as string;
      const x = data.x as number;
      const y = data.y as number;
      const rotation = data.rotation as number | undefined;
      ensureBullet(id, x, y, rotation);
      break;
    }

    case 'bulletRemoved': {
      const id = data.id as string;
      dropBullet(id);
      break;
    }

    case 'playerKilled': {
      const id = data.id as string;
      const p = players.get(id);
      if (!p) return;
      p.sprite.visible = false;
      p.label.text = '💀';
      break;
    }

    case 'playerRespawned': {
      const id = data.id as string;
      const x = data.x as number;
      const y = data.y as number;
      const p = ensurePlayer(id);
      p.container.x = p.targetX = x;
      p.container.y = p.targetY = y;
      p.sprite.visible = true;
      p.label.text = p.name;
      break;
    }

    case 'scoreUpdated': {
      const id = data.id as string;
      const score = data.score as number;
      const p = players.get(id);
      if (!p) return;
      p.score = score;
      refreshScoreboard();
      break;
    }
  }
}

function connect(): void {
  keys.clear();
  setStatus('⏳ Connecting…', 0xffaa00);

  ws = new PartySocket({
    host: PARTY_HOST,
    room: 'game',
    startClosed: true,
  });

  ws.addEventListener('open', () => {
    connected = true;
    setStatus('✓ Connected', 0x00ff88);
    ws.send(JSON.stringify({ type: 'setName', name: playerName }));
  });

  ws.addEventListener('message', handleMessage);

  ws.addEventListener('close', () => {
    connected = false;
    setStatus('✗ Disconnected — reconnecting…', 0xff4444);
  });

  ws.reconnect();
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
    connect();
  };

  btn.addEventListener('click', join);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') join();
  });
}

showNameEntry();
