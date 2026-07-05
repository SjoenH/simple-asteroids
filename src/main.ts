import './style.css';

import PartySocket from 'partysocket';
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
} from 'pixi.js';

const PARTY_HOST: string = import.meta.env.VITE_PARTY_HOST ??
  (import.meta.env.DEV ? `${window.location.hostname}:8787` : window.location.host);

const ASSET_PATHS = {
  player: '/assets/Player.png',
  asteroid: '/assets/Asteroid.png',
  bullet: '/assets/Bullet.png',
} as const;

const ROOM_ANIMALS = ['penguin', 'otter', 'monkey', 'zebra', 'llama', 'platypus', 'capybara', 'narwhal', 'axolotl', 'quokka', 'wombat', 'lemur', 'toucan', 'pangolin', 'okapi'];
const ROOM_VERBS = ['bounces', 'splashes', 'spins', 'dashes', 'zooms', 'wobbles', 'flips', 'twirls', 'sprints', 'glides', 'hops', 'cartwheels', 'backflips', 'somersaults'];
const ROOM_ACTIONS = ['wildly', 'happily', 'furiously', 'joyfully', 'chaotically', 'bravely', 'sleepily', 'magnificently', 'awkwardly', 'triumphantly'];

function generateRoomKey(): string {
  const animal = ROOM_ANIMALS[Math.floor(Math.random() * ROOM_ANIMALS.length)];
  const verb = ROOM_VERBS[Math.floor(Math.random() * ROOM_VERBS.length)];
  const action = ROOM_ACTIONS[Math.floor(Math.random() * ROOM_ACTIONS.length)];
  return `${animal}-${verb}-${action}`;
}

function getRoomFromURL(): string {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  return room && /^[a-z0-9-]+$/.test(room) ? room : 'game';
}

function setRoomInURL(room: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('room', room);
  window.history.replaceState({}, '', url.toString());
}

let currentRoom = getRoomFromURL();

interface Vec3 { x: number; y: number; z: number; }

// Physics constants (from party/physics.ts)
const RADIUS = 1000;
const ROTATION_SPEED = 3;
const PLAYER_ACCEL = 300;
const FRICTION = 0.015;
const BRAKE_DECEL = 0.08;
const MAX_SPEED = 400;

function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function vScale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function vCross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function vLen(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function vNorm(v: Vec3): Vec3 {
  const l = vLen(v);
  return l === 0 ? { x: 0, y: 0, z: 1 } : vScale(v, 1 / l);
}

function tangentOf(v: Vec3, n: Vec3): Vec3 {
  const u = vNorm(n);
  return vSub(v, vScale(u, vDot(v, u)));
}

function sphereAdvance(pos: Vec3, vel: Vec3, dt: number): { pos: Vec3; vel: Vec3 } {
  const newPos = vScale(vNorm(vAdd(pos, vScale(vel, dt))), RADIUS);
  const newVel = tangentOf(vel, newPos);
  return { pos: newPos, vel: newVel };
}

function rotateForward(fwd: Vec3, pos: Vec3, angle: number): Vec3 {
  const n = vNorm(pos);
  const right = vNorm(vCross(fwd, n));
  return vNorm(vAdd(vScale(fwd, Math.cos(angle)), vScale(right, Math.sin(angle))));
}

function radToScreen(q: Vec3, p: Vec3, fwd: Vec3): { x: number; y: number } | null {
  const n = vNorm(p);
  const cosAngle = Math.max(-1, Math.min(1, vDot(vNorm(q), n)));
  const angle = Math.acos(cosAngle);
  if (angle > Math.PI / 2) return null;
  const d = vSub(q, p);
  const dTan = tangentOf(d, n);
  const dTanLen = vLen(dTan);
  if (dTanLen < 0.001) return { x: 0, y: 0 };
  const dir = vScale(dTan, 1 / dTanLen);
  const screenDist = angle * vLen(p);
  const right = vNorm(vCross(fwd, n));
  return { x: vDot(dir, right) * screenDist, y: -vDot(dir, fwd) * screenDist };
}

function forwardScreenAngle(pos: Vec3, fwd: Vec3, pp: Vec3, pf: Vec3): number {
  const step = vAdd(pos, vScale(fwd, 20));
  const s1 = radToScreen(pos, pp, pf);
  const s2 = radToScreen(step, pp, pf);
  if (!s1 || !s2) return 0;
  return Math.atan2(s2.x - s1.x, -(s2.y - s1.y));
}

const PEER_COLORS: number[] = [
  0x00ff88, 0xff44ff, 0x44ddff, 0xff8800, 0xaaaaff, 0xff4455,
];

interface PlayerEntry {
  container: Container;
  sprite: Sprite;
  label: Text;
  targetPos: Vec3;
  currentPos: Vec3;
  forward: Vec3;
  score: number;
  lives: number;
  name: string;
  color: number;
  isNPC: boolean;
  // Client-side prediction
  vel: Vec3;
  predictedPos: Vec3;
  predictedForward: Vec3;
}

type PowerUpType = 'extraLife' | 'invisibility' | 'multiCannon';

interface PowerUpEntry {
  gfx: Graphics;
  pos: Vec3;
  type: PowerUpType;
}

const players = new Map<string, PlayerEntry>();
const asteroids = new Map<string, Sprite>();
const bullets = new Map<string, Sprite>();
const asteroidPos = new Map<string, Vec3>();
const bulletPos = new Map<string, Vec3>();
const powerUps = new Map<string, PowerUpEntry>();

let localId: string | null = null;
let playerName = '';
let connected = false;
let hostId: string | null = null;

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

function getZoom(): number {
  return Math.max(0.35, Math.min(app.screen.width, app.screen.height) / 900);
}

const gameLayer = new Container();
const hudLayer = new Container();
const particleLayer = new Container();
const debugContainer = new Container();
const gameOverLayer = new Container();
gameLayer.addChildAt(particleLayer, 0);
app.stage.addChild(gameLayer, hudLayer, debugContainer, gameOverLayer);
gameOverLayer.visible = false;

interface AmbientParticle {
  pos: Vec3;
  size: number;
  alpha: number;
}

const ambientParticles: AmbientParticle[] = [];
for (let i = 0; i < 400; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = RADIUS * (0.6 + Math.random() * 0.5);
  ambientParticles.push({
    pos: {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
    },
    size: Math.random() * 1.8 + 0.3,
    alpha: Math.random() * 0.75 + 0.05,
  });
}

interface ExhaustParticle {
  pos: Vec3;
  vel: Vec3;
  life: number;
  maxLife: number;
}

const exhaustParticles: ExhaustParticle[] = [];

const ambientGFX = new Graphics();
const exhaustGFX = new Graphics();
const powerUpGFX = new Graphics();
particleLayer.addChild(ambientGFX, exhaustGFX, powerUpGFX);



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
  'WASD / ↑←↓→ — fly   SPACE — shoot   S/↓ — brake',
  { fontSize: 11, fill: 0x445566 },
);
controlsText.anchor.set(0.5, 1);
hudLayer.addChild(controlsText);

const scoreContainer = new Container();
scoreContainer.position.set(10, 50);
hudLayer.addChild(scoreContainer);

const livesLabel = makeText('', { fill: 0xff4444, fontSize: 14 });
livesLabel.position.set(10, 50);
hudLayer.addChild(livesLabel);

const effectLabel = makeText('', { fill: 0x44ff88, fontSize: 12 });
effectLabel.position.set(10, 70);
hudLayer.addChild(effectLabel);

let localLives = 3;
let localEffects: string[] = [];

function updateLivesDisplay(): void {
  livesLabel.text = '♥'.repeat(Math.max(0, localLives));
  livesLabel.style = new TextStyle({
    ...BASE_STYLE, fontSize: 14,
    fill: localLives > 0 ? 0xff4444 : 0x444444,
  });
}

function updateEffectDisplay(): void {
  effectLabel.text = localEffects.join('  ');
}

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
    const livesStr = '♥'.repeat(Math.max(0, p.lives));
    const entry = makeText(
      `${isMe ? '▶' : ' '} ${p.name}  ${p.score}  ${livesStr}`,
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

function showGameOver(): void {
  gameOverLayer.removeChildren();
  const w = app.screen.width;
  const h = app.screen.height;

  const bg = new Graphics();
  bg.setFillStyle({ color: 0x000000, alpha: 0.65 });
  bg.rect(0, 0, w, h);
  bg.fill();
  gameOverLayer.addChild(bg);

  const title = makeText("GAME OVER", { fill: 0xff4444, fontSize: 42, fontWeight: "bold" });
  title.anchor.set(0.5);
  title.x = w / 2;
  title.y = 50;
  gameOverLayer.addChild(title);

  const localPlayer = localId ? players.get(localId) : undefined;
  const scoreText = makeText(
    `Score: ${localPlayer?.score ?? 0}`,
    { fill: 0xffffff, fontSize: 24 },
  );
  scoreText.anchor.set(0.5);
  scoreText.x = w / 2;
  scoreText.y = 95;
  gameOverLayer.addChild(scoreText);

  const mapBg = new Graphics();
  mapBg.setStrokeStyle({ color: 0x334466, width: 1 });
  mapBg.circle(w / 2, h / 2 + 5, Math.min(w, h) * 0.45 / 2);
  mapBg.stroke();
  gameOverLayer.addChild(mapBg);

  gameOverLayer.addChild(gameOverMapGfx);

  gameOverLayer.addChild(createGameOverButton(w));
  gameOverLayer.visible = true;
}

function drawGameOverMap(): void {
  const w = app.screen.width;
  const h = app.screen.height;
  const mapSize = Math.min(w, h) * 0.45;
  const mapX = w / 2;
  const mapY = h / 2 + 5;
  const mapR = mapSize / 2;

  // Calculate centroid of alive players for rotation target
  const alivePositions: Vec3[] = [];
  for (const [eid, ep] of players) {
    if (ep.lives > 0) {
      alivePositions.push(ep.currentPos);
    }
  }
  let targetAngle = globeAngle;
  if (alivePositions.length > 0) {
    const centroid = alivePositions.reduce((a, b) => vAdd(a, b));
    centroid.x /= alivePositions.length;
    centroid.y /= alivePositions.length;
    centroid.z /= alivePositions.length;
    targetAngle = Math.atan2(centroid.y, centroid.x);
  }

  // Smoothly interpolate globe angle toward target
  const diff = targetAngle - globeAngle;
  globeAngle += diff * 0.05;

  const cosA = Math.cos(globeAngle);
  const sinA = Math.sin(globeAngle);

  function rotX(x: number, y: number): number { return x * cosA - y * sinA; }
  function rotY(x: number, y: number): number { return x * sinA + y * cosA; }

  gameOverMapGfx.clear();

  // Players
  for (const [eid, ep] of players) {
    const rx = rotX(ep.currentPos.x, ep.currentPos.y);
    const ry = rotY(ep.currentPos.x, ep.currentPos.y);
    if (ry <= 0) continue;
    const sx = (rx / RADIUS) * mapR * 0.85;
    const sy = (ep.currentPos.z / RADIUS) * mapR * 0.85;
    if (Math.sqrt(sx * sx + sy * sy) > mapR - 4) continue;
    const color = eid === localId ? 0xffff00 : ep.isNPC ? 0x88ff88 : 0x44ddff;
    const fwd = ep.forward;
    const frx = rotX(fwd.x, fwd.y);
    const fry = rotY(fwd.x, fwd.y);
    const a = Math.atan2(frx, fry);
    const sz = 4;
    const tipX = mapX + sx + Math.sin(a) * sz;
    const tipY = mapY + sy - Math.cos(a) * sz;
    const lx = mapX + sx + Math.sin(a + 2.3) * sz * 0.55;
    const ly = mapY + sy - Math.cos(a + 2.3) * sz * 0.55;
    const rx2 = mapX + sx + Math.sin(a - 2.3) * sz * 0.55;
    const ry2 = mapY + sy - Math.cos(a - 2.3) * sz * 0.55;
    gameOverMapGfx.setFillStyle({ color, alpha: 0.9 });
    gameOverMapGfx.poly([tipX, tipY, lx, ly, rx2, ry2]);
    gameOverMapGfx.fill();
  }

  // Asteroids
  for (const apos of asteroidPos.values()) {
    const rx = rotX(apos.x, apos.y);
    const ry = rotY(apos.x, apos.y);
    if (ry <= 0) continue;
    const sx = (rx / RADIUS) * mapR * 0.85;
    const sy = (apos.z / RADIUS) * mapR * 0.85;
    if (Math.sqrt(sx * sx + sy * sy) > mapR - 4) continue;
    gameOverMapGfx.setFillStyle({ color: 0xff6644, alpha: 0.6 });
    gameOverMapGfx.circle(mapX + sx, mapY + sy, 2);
    gameOverMapGfx.fill();
  }

  // Bullets
  for (const bpos of bulletPos.values()) {
    const rx = rotX(bpos.x, bpos.y);
    const ry = rotY(bpos.x, bpos.y);
    if (ry <= 0) continue;
    const sx = (rx / RADIUS) * mapR * 0.85;
    const sy = (bpos.z / RADIUS) * mapR * 0.85;
    if (Math.sqrt(sx * sx + sy * sy) > mapR - 4) continue;
    gameOverMapGfx.setFillStyle({ color: 0xffffff, alpha: 0.5 });
    gameOverMapGfx.circle(mapX + sx, mapY + sy, 1);
    gameOverMapGfx.fill();
  }
}

let gameOverBtn: Text | null = null;
let globeAngle = 0;
const gameOverMapGfx = new Graphics();

function updateGameOverButton(): void {
  if (!gameOverLayer.visible) return;
  const w = app.screen.width;
  if (!gameOverBtn) {
    const msg = makeText("Waiting for round to end...", { fill: 0x888899, fontSize: 16 });
    msg.anchor.set(0.5);
    msg.x = w / 2;
    msg.y = 530;
    gameOverLayer.addChild(msg);
    gameOverBtn = msg;
  }
}

function createGameOverButton(w: number): Text {
  const msg = makeText("Waiting for round to end...", { fill: 0x888899, fontSize: 16 });
  msg.anchor.set(0.5);
  msg.x = w / 2;
  msg.y = 530;
  gameOverBtn = msg;
  return msg;
}

function hideGameOver(): void {
  gameOverLayer.visible = false;
}

// ── Lobby UI ──────────────────────────────────────────────────────────────

const LOBBY_COLORS = [0xffff00, 0x44ddff, 0xff6644, 0x44ff88, 0xff44ff, 0xff8844, 0x8888ff, 0x44ffff];
let lobbyOverlay: HTMLDivElement | null = null;
let localReady = false;

function showLobby(): void {
  hideLobby();
  const overlay = document.createElement('div');
  overlay.id = 'lobby-overlay';
  overlay.innerHTML = `
    <div class="nd">
      <h1>🚀 Simple Asteroids</h1>
      <p class="lobby-players-title">Waiting for players...</p>
      <div class="lobby-players"></div>
      <div class="lobby-colors">
        ${LOBBY_COLORS.map(c => `<button class="lobby-color-swatch" data-color="${c}" style="background:#${c.toString(16).padStart(6, '0')}"></button>`).join('')}
      </div>
      <button class="lobby-ready-btn">Not Ready — Click to Ready Up</button>
      <button class="lobby-start-btn" style="display:none">▶ Start Game</button>
      <p class="hint">ESC — leave game &nbsp;·&nbsp; Ready up, then click Start</p>
    </div>`;
  document.body.appendChild(overlay);
  lobbyOverlay = overlay;

  // Color picker
  overlay.querySelectorAll('.lobby-color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = parseInt((btn as HTMLElement).dataset.color!);
      ws.send(JSON.stringify({ type: 'setColor', color }));
      overlay.querySelectorAll('.lobby-color-swatch').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Ready toggle
  const readyBtn = overlay.querySelector<HTMLButtonElement>('.lobby-ready-btn')!;
  readyBtn.addEventListener('click', () => {
    localReady = !localReady;
    ws.send(JSON.stringify({ type: 'ready', ready: localReady }));
  });

  // Start game
  const startBtn = overlay.querySelector<HTMLButtonElement>('.lobby-start-btn')!;
  startBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'startGame' }));
  });

  // Before game starts, hide the game layer
  gameLayer.visible = false;
  hudLayer.visible = false;
  debugContainer.visible = false;
}

function hideLobby(): void {
  if (lobbyOverlay) {
    lobbyOverlay.remove();
    lobbyOverlay = null;
  }
  gameLayer.visible = true;
  hudLayer.visible = true;
  debugContainer.visible = true;
}

function updateLobby(data: Record<string, unknown>): void {
  if (!lobbyOverlay) return;
  const playersData = data.players as Array<{ id: string; name: string; color: number; ready: boolean }> | undefined;
  if (!playersData) return;

  if (data.hostId !== undefined) {
    hostId = (data.hostId as string) ?? null;
  }

  const listEl = lobbyOverlay.querySelector('.lobby-players');
  if (!listEl) return;

  const isHost = localId === hostId;

  listEl.innerHTML = playersData.map(p => {
    const colorHex = '#' + (p.color as number).toString(16).padStart(6, '0');
    const check = p.ready ? '✅' : '⏳';
    const showKick = isHost && p.id !== localId;
    const kickBtn = showKick
      ? `<button class="lobby-kick-btn" data-target="${p.id}">×</button>`
      : '';
    return `<div class="lobby-player-row ${p.id === localId ? 'is-me' : ''}">
      <span class="lobby-player-color" style="background:${colorHex}"></span>
      <span class="lobby-player-name">${escHtml(p.name)}${p.id === hostId ? ' 👑' : ''}</span>
      <span class="lobby-player-ready">${check}</span>
      ${kickBtn}
    </div>`;
  }).join('');

  if (isHost) {
    listEl.querySelectorAll('.lobby-kick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = (btn as HTMLElement).dataset.target;
        if (targetId) ws.send(JSON.stringify({ type: 'kick', targetId }));
      });
    });
  }

  const readyBtn = lobbyOverlay.querySelector<HTMLButtonElement>('.lobby-ready-btn');
  if (readyBtn) {
    readyBtn.textContent = localReady ? '✅ Ready! Click to unready' : 'Not Ready — Click to Ready Up';
  }

  const allReady = playersData.length > 0 && playersData.every(p => p.ready);
  const titleEl = lobbyOverlay.querySelector('.lobby-players-title');
  if (titleEl) {
    titleEl.textContent = allReady ? 'All players ready!' : 'Waiting for players to ready up...';
  }

  const startBtn = lobbyOverlay.querySelector<HTMLButtonElement>('.lobby-start-btn');
  if (startBtn) {
    startBtn.style.display = allReady ? 'block' : 'none';
  }
}

function escHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

app.ticker.add(() => {
  fpsText.text = `FPS: ${Math.round(app.ticker.FPS)}`;

  const localPlayer = localId ? players.get(localId) : undefined;
  const pp = localPlayer?.currentPos ?? { x: 0, y: 0, z: RADIUS };
  const pf = localPlayer?.forward ?? { x: 0, y: 0, z: 1 };

  // ── Stars (ambient particles) ──
  ambientGFX.clear();
  for (const ap of ambientParticles) {
    const s = radToScreen(ap.pos, pp, pf);
    if (!s) continue;
    ambientGFX.setFillStyle({ color: 0xffffff, alpha: ap.alpha });
    ambientGFX.circle(s.x, s.y, ap.size);
    ambientGFX.fill();
  }

  // ── Exhaust particles ──
  exhaustGFX.clear();
  exhaustGFX.setFillStyle({ color: 0xffaa44, alpha: 0.35 });
  const isThrusting = keys.has('KeyW') || keys.has('ArrowUp');
  if (isThrusting && localPlayer && exhaustParticles.length < 120) {
    const back = vScale(pf, -1);
    const n = vNorm(pp);
    const perp = vNorm(vCross(back, n));
    for (let i = 0; i < 4; i++) {
      const spread = vAdd(
        vScale(perp, (Math.random() - 0.5) * 12),
        vScale(back, Math.random() * 10 + 5),
      );
      exhaustParticles.push({
        pos: vAdd(pp, spread),
        vel: vAdd(vScale(back, Math.random() * 60 + 30), vScale(perp, (Math.random() - 0.5) * 30)),
        life: 1,
        maxLife: 0.5 + Math.random() * 0.4,
      });
    }
  }

  for (let i = exhaustParticles.length - 1; i >= 0; i--) {
    const ep = exhaustParticles[i];
    ep.pos = vAdd(ep.pos, vScale(ep.vel, 1 / 60));
    ep.vel = vScale(ep.vel, 0.97);
    ep.life -= 1 / 60;
    if (ep.life <= 0) {
      exhaustParticles.splice(i, 1);
      continue;
    }
    const s = radToScreen(ep.pos, pp, pf);
    if (!s) continue;
    const a = (ep.life / ep.maxLife);
    exhaustGFX.circle(s.x, s.y, 3 * a);
  }
  exhaustGFX.fill();

  // ── Power-up pickups ──
  powerUpGFX.clear();
  for (const [, pu] of powerUps) {
    const s = radToScreen(pu.pos, pp, pf);
    if (!s) continue;
    let color = 0xffffff;
    if (pu.type === 'extraLife') color = 0x44ff44;
    else if (pu.type === 'invisibility') color = 0xaa44ff;
    else if (pu.type === 'multiCannon') color = 0xff8800;
    powerUpGFX.setFillStyle({ color, alpha: 0.7 });
    powerUpGFX.circle(s.x, s.y, 7);
  }
  powerUpGFX.fill();

  // ── Client-side prediction for local player ──
  if (localPlayer) {
    const dt = app.ticker.deltaMS / 1000;
    
    // Apply input to predicted state
    const thrust = keys.has('KeyW') || keys.has('ArrowUp');
    const brake = keys.has('KeyS') || keys.has('ArrowDown');
    const rotateLeft = keys.has('KeyA') || keys.has('ArrowLeft');
    const rotateRight = keys.has('KeyD') || keys.has('ArrowRight');

    // Rotate predicted forward
    if (rotateLeft) {
      localPlayer.predictedForward = rotateForward(localPlayer.predictedForward, localPlayer.predictedPos, -ROTATION_SPEED * dt);
    }
    if (rotateRight) {
      localPlayer.predictedForward = rotateForward(localPlayer.predictedForward, localPlayer.predictedPos, ROTATION_SPEED * dt);
    }

    // Apply acceleration
    if (thrust) {
      localPlayer.vel = vAdd(localPlayer.vel, vScale(localPlayer.predictedForward, PLAYER_ACCEL * dt));
    }
    if (brake) {
      localPlayer.vel = vScale(localPlayer.vel, 1 - BRAKE_DECEL);
    }

    // Apply friction
    localPlayer.vel = vScale(localPlayer.vel, 1 - FRICTION * dt);

    // Clamp velocity
    const speed = vLen(localPlayer.vel);
    if (speed > MAX_SPEED) {
      localPlayer.vel = vScale(localPlayer.vel, MAX_SPEED / speed);
    }

    // Advance position on sphere
    const moved = sphereAdvance(localPlayer.predictedPos, localPlayer.vel, dt);
    localPlayer.predictedPos = moved.pos;
    localPlayer.vel = moved.vel;
    localPlayer.predictedForward = vNorm(tangentOf(localPlayer.predictedForward, localPlayer.predictedPos));

    // Use predicted position for camera and rendering
    localPlayer.currentPos = { ...localPlayer.predictedPos };
    localPlayer.forward = { ...localPlayer.predictedForward };
  }

  for (const p of players.values()) {
    // Skip interpolation for local player - we use prediction
    if (players.get(localId!) === p) continue;
    
    p.currentPos.x += (p.targetPos.x - p.currentPos.x) * 0.18;
    p.currentPos.y += (p.targetPos.y - p.currentPos.y) * 0.18;
    p.currentPos.z += (p.targetPos.z - p.currentPos.z) * 0.18;
  }

  for (const [id, p] of players) {
    const s = radToScreen(p.currentPos, pp, pf);
    if (!s) { p.sprite.visible = false; continue; }
    p.sprite.visible = true;
    p.container.x = s.x;
    p.container.y = s.y;
    p.sprite.rotation = id === localId ? 0 : forwardScreenAngle(p.currentPos, p.forward, pp, pf);
  }

  for (const [id, s] of asteroids) {
    const pos = asteroidPos.get(id);
    if (!pos) continue;
    const screen = radToScreen(pos, pp, pf);
    if (screen) {
      s.x = screen.x;
      s.y = screen.y;
    }
    s.visible = screen !== null;
  }

  for (const [id, s] of bullets) {
    const pos = bulletPos.get(id);
    if (!pos) continue;
    const screen = radToScreen(pos, pp, pf);
    if (screen) {
      s.x = screen.x;
      s.y = screen.y;
    }
    s.visible = screen !== null;
  }

  const zoom = getZoom();
  gameLayer.x = app.screen.width / 2;
  gameLayer.y = app.screen.height / 2;
  gameLayer.scale.set(zoom);

  updateDebugViews(pp, pf);

  if (gameOverLayer.visible) {
    drawGameOverMap();
  }
});

function updateDebugViews(camPP: Vec3, camPF: Vec3): void {
  debugContainer.removeChildren();

  if (players.size === 0) return;

  const screenW = app.screen.width;
  const screenH = app.screen.height;
  const hw = screenW / 2;
  const hh = screenH / 2;
  const zm = getZoom();

  for (const [id, p] of players) {
    if (id === localId) continue;

    const dist = Math.max(0, Math.min(RADIUS * 2, vLen(vSub(p.currentPos, camPP))));
    const viewSize = Math.round(130 - (dist / (RADIUS * 2)) * 80);

    const s = radToScreen(p.currentPos, camPP, camPF);
    let visible = false;
    if (s) {
      const sx = s.x * zm + hw;
      const sy = s.y * zm + hh;
      if (sx >= -10 && sx < screenW + 10 && sy >= -10 && sy < screenH + 10) {
        visible = true;
      }
    }
    if (visible) continue;

    let angle: number;
    if (s) {
      angle = Math.atan2(s.y, s.x);
    } else {
      const dir = vNorm(vSub(p.currentPos, camPP));
      const n = vNorm(camPP);
      const right = vNorm(vCross(camPF, n));
      const dx = vDot(dir, right);
      const dy = -vDot(dir, camPF);
      angle = Math.atan2(dy, dx);
    }

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let t: number;
    if (Math.abs(cos) * hh > Math.abs(sin) * hw) {
      t = hw / Math.abs(cos);
    } else {
      t = hh / Math.abs(sin);
    }

    let ex = hw + cos * t - viewSize / 2;
    let ey = hh + sin * t - viewSize / 2;
    ex = Math.max(2, Math.min(ex, screenW - viewSize - 2));
    ey = Math.max(2, Math.min(ey, screenH - viewSize - 2));

    const c = new Container();
    c.x = ex;
    c.y = ey;

    const bg = new Graphics();
    bg.setFillStyle({ color: 0x000022, alpha: 0.85 });
    bg.rect(0, 0, viewSize, viewSize);
    bg.fill();
    bg.setStrokeStyle({ color: 0x444488, width: 1 });
    bg.rect(0, 0, viewSize, viewSize);
    bg.stroke();
    c.addChild(bg);

    const label = makeText(p.name, { fontSize: 8, fill: id === localId ? 0xffff00 : 0xaaaacc });
    label.x = 2;
    label.y = 2;
    c.addChild(label);

    const gfx = new Graphics();
    c.addChild(gfx);

    const dvPP = p.currentPos;
    const lp = localId ? players.get(localId) : undefined;
    const dvPF = lp ? lp.forward : { x: 0, y: 0, z: 1 };
    const scale = 0.2;
    const cx = viewSize / 2;
    const cy = viewSize / 2;

    for (const [eid, ep] of players) {
      const es = radToScreen(ep.currentPos, dvPP, dvPF);
      if (!es) continue;
      const esx = es.x * scale + cx;
      const esy = es.y * scale + cy;
      if (esx < -5 || esx > viewSize + 5 || esy < -5 || esy > viewSize + 5) continue;
      const color = eid === id ? 0xffff00 : eid === localId ? 0x44ddff : 0x88ff88;
      const a = forwardScreenAngle(ep.currentPos, ep.forward, dvPP, dvPF);
      const sz = 4;
      const tipX = esx + Math.sin(a) * sz;
      const tipY = esy - Math.cos(a) * sz;
      const lx = esx + Math.sin(a + 2.3) * sz * 0.55;
      const ly = esy - Math.cos(a + 2.3) * sz * 0.55;
      const rx = esx + Math.sin(a - 2.3) * sz * 0.55;
      const ry = esy - Math.cos(a - 2.3) * sz * 0.55;
      gfx.setFillStyle({ color, alpha: 0.9 });
      gfx.poly([tipX, tipY, lx, ly, rx, ry]);
      gfx.fill();
    }

    for (const apos of asteroidPos.values()) {
      const es = radToScreen(apos, dvPP, dvPF);
      if (!es) continue;
      const esx = es.x * scale + cx;
      const esy = es.y * scale + cy;
      if (esx < -5 || esx > viewSize + 5 || esy < -5 || esy > viewSize + 5) continue;
      gfx.setFillStyle({ color: 0xff6644, alpha: 0.7 });
      gfx.circle(esx, esy, 2);
      gfx.fill();
    }

    for (const bpos of bulletPos.values()) {
      const es = radToScreen(bpos, dvPP, dvPF);
      if (!es) continue;
      const esx = es.x * scale + cx;
      const esy = es.y * scale + cy;
      if (esx < -5 || esx > viewSize + 5 || esy < -5 || esy > viewSize + 5) continue;
      gfx.setFillStyle({ color: 0xffffff, alpha: 0.8 });
      gfx.circle(esx, esy, 1);
      gfx.fill();
    }

    for (const [, pu] of powerUps) {
      const es = radToScreen(pu.pos, dvPP, dvPF);
      if (!es) continue;
      const esx = es.x * scale + cx;
      const esy = es.y * scale + cy;
      if (esx < -5 || esx > viewSize + 5 || esy < -5 || esy > viewSize + 5) continue;
      gfx.setFillStyle({ color: 0x44ff44, alpha: 0.7 });
      gfx.circle(esx, esy, 2);
      gfx.fill();
    }

    debugContainer.addChild(c);
  }
}

function colorForIndex(index: number): number {
  return PEER_COLORS[index % PEER_COLORS.length];
}

function ensurePlayer(id: string, name?: string, color?: number): PlayerEntry {
  if (players.has(id)) {
    const existing = players.get(id) as PlayerEntry;
    if (name !== undefined) existing.name = name;
    if (color !== undefined) {
      existing.color = color;
      existing.sprite.tint = color;
      existing.label.style = new TextStyle({ ...BASE_STYLE, fontSize: 11, fill: id === localId ? 0xffff00 : 0xddddee });
    }
    return existing;
  }

  const isMe = id === localId;
  const displayName = name ?? id.slice(0, 8);
  const tintColor = color ?? (isMe ? 0xffff00 : colorForIndex(players.size));

  const container = new Container();

  const sprite = Sprite.from(ASSET_PATHS.player);
  sprite.anchor.set(0.5);
  sprite.tint = tintColor;

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
    targetPos: { x: 0, y: 0, z: RADIUS },
    currentPos: { x: 0, y: 0, z: RADIUS },
    forward: { x: 0, y: 0, z: 1 },
    score: 0,
    lives: 3,
    name: displayName,
    color: tintColor,
    isNPC: id.startsWith('npc_'),
    // Client-side prediction
    vel: { x: 0, y: 0, z: 0 },
    predictedPos: { x: 0, y: 0, z: RADIUS },
    predictedForward: { x: 0, y: 0, z: 1 },
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

function clearPlayers(): void {
  for (const [, p] of players) {
    gameLayer.removeChild(p.container);
  }
  players.clear();
}

function movePlayer(id: string, pos: Vec3, forward?: Vec3): void {
  const p = ensurePlayer(id);
  
  if (id === localId) {
    // Server reconciliation for local player
    // Only correct if error is significant
    const errorX = pos.x - p.predictedPos.x;
    const errorY = pos.y - p.predictedPos.y;
    const errorZ = pos.z - p.predictedPos.z;
    const errorDist = Math.sqrt(errorX * errorX + errorY * errorY + errorZ * errorZ);
    
    // Only correct if error is > 10 units (small threshold)
    if (errorDist > 10) {
      const blendFactor = 0.05; // Very gentle correction (5% per update)
      p.predictedPos.x += errorX * blendFactor;
      p.predictedPos.y += errorY * blendFactor;
      p.predictedPos.z += errorZ * blendFactor;
    }
    
    if (forward) {
      // Very gentle forward correction
      const blendFactor = 0.05;
      p.predictedForward.x = p.predictedForward.x * (1 - blendFactor) + forward.x * blendFactor;
      p.predictedForward.y = p.predictedForward.y * (1 - blendFactor) + forward.y * blendFactor;
      p.predictedForward.z = p.predictedForward.z * (1 - blendFactor) + forward.z * blendFactor;
      p.predictedForward = vNorm(p.predictedForward);
    }
    
    // Don't update targetPos for local player, we use predicted position
  } else {
    // Remote players use normal interpolation
    p.targetPos = pos;
    if (forward) p.forward = forward;
  }
}

const ASTEROID_SCALES: Record<number, number> = { 1: 1, 2: 0.6, 3: 0.35 };

function ensureAsteroid(id: string, pos: Vec3, size?: number): void {
  if (!asteroids.has(id)) {
    const s = Sprite.from(ASSET_PATHS.asteroid);
    s.anchor.set(0.5);
    gameLayer.addChildAt(s, 0);
    asteroids.set(id, s);
  }
  asteroidPos.set(id, pos);
  if (size !== undefined) asteroids.get(id)!.scale.set(ASTEROID_SCALES[size] ?? 1);
}

function dropAsteroid(id: string): void {
  const s = asteroids.get(id);
  if (!s) return;
  gameLayer.removeChild(s);
  asteroids.delete(id);
  asteroidPos.delete(id);
}

function ensureBullet(id: string, pos: Vec3): void {
  if (!bullets.has(id)) {
    const s = Sprite.from(ASSET_PATHS.bullet);
    s.anchor.set(0.5);
    s.scale.set(0.6);
    gameLayer.addChildAt(s, 0);
    bullets.set(id, s);
  }
  bulletPos.set(id, pos);
}

function dropBullet(id: string): void {
  const s = bullets.get(id);
  if (!s) return;
  gameLayer.removeChild(s);
  bullets.delete(id);
  bulletPos.delete(id);
}

const keys = new Set<string>();

window.addEventListener('keydown', (e: KeyboardEvent) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'Escape') {
    ws.send(JSON.stringify({ type: "surrender" }));
  }
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
  const brake = keys.has('KeyS') || keys.has('ArrowDown');
  const rotateLeft = keys.has('KeyA') || keys.has('ArrowLeft');
  const rotateRight = keys.has('KeyD') || keys.has('ArrowRight');
  const shoot = keys.has('Space');

  ws.send(JSON.stringify({
    type: 'playerInput',
    thrust,
    brake,
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
      hostId = (data.hostId as string) ?? null;
      if (data.inGame) {
        hideLobby();
      } else {
        showLobby();
      }
      break;

    case 'gameState': {
      // Batched game state update (Phase 1 optimization)
      const players = data.players as Array<{ id: string; x: number; y: number; z: number; fx: number; fy: number; fz: number; invisible?: boolean }> | undefined;
      const asteroids = data.asteroids as Array<{ id: string; x: number; y: number; z: number; size: number }> | undefined;
      const bullets = data.bullets as Array<{ id: string; x: number; y: number; z: number }> | undefined;

      if (players) {
        for (const p of players) {
          const pos: Vec3 = { x: p.x, y: p.y, z: p.z };
          const forward: Vec3 = { x: p.fx, y: p.fy, z: p.fz };
          movePlayer(p.id, pos, forward);
        }
      }

      if (asteroids) {
        for (const a of asteroids) {
          const pos: Vec3 = { x: a.x, y: a.y, z: a.z };
          ensureAsteroid(a.id, pos, a.size);
        }
      }

      if (bullets) {
        for (const b of bullets) {
          const pos: Vec3 = { x: b.x, y: b.y, z: b.z };
          ensureBullet(b.id, pos);
        }
      }
      break;
    }

    case 'playerJoined': {
      const id = data.id as string;
      const name = data.name as string | undefined;
      const color = data.color as number | undefined;
      const p = ensurePlayer(id, name, color);
      if (data.x !== undefined) {
        p.targetPos = { x: data.x as number, y: data.y as number, z: data.z as number };
        p.currentPos = { ...p.targetPos };
      }
      if (data.fx !== undefined) {
        p.forward = { x: data.fx as number, y: data.fy as number, z: data.fz as number };
      }
      if (data.isNPC !== undefined) {
        p.isNPC = Boolean(data.isNPC);
      }
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
      const pos: Vec3 = { x: data.x as number, y: data.y as number, z: data.z as number };
      const forward: Vec3 | undefined =
        data.fx !== undefined
          ? { x: data.fx as number, y: data.fy as number, z: data.fz as number }
          : undefined;
      movePlayer(id, pos, forward);
      break;
    }

    case 'asteroidMoved': {
      const id = data.id as string;
      const pos: Vec3 = { x: data.x as number, y: data.y as number, z: data.z as number };
      const size = data.size as number | undefined;
      ensureAsteroid(id, pos, size);
      break;
    }

    case 'asteroidRemoved': {
      const id = data.id as string;
      dropAsteroid(id);
      break;
    }

    case 'bulletMoved': {
      const id = data.id as string;
      const pos: Vec3 = { x: data.x as number, y: data.y as number, z: data.z as number };
      ensureBullet(id, pos);
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
      const lives = data.lives as number | undefined;
      if (lives !== undefined) {
        p.lives = lives;
        if (id === localId) {
          localLives = lives;
          updateLivesDisplay();
          if (lives === 0) showGameOver();
        }
      }
      refreshScoreboard();
      if (gameOverLayer.visible) updateGameOverButton();
      break;
    }

    case 'playerRespawned': {
      const id = data.id as string;
      const pos: Vec3 = { x: data.x as number, y: data.y as number, z: data.z as number };
      const p = ensurePlayer(id);
      p.targetPos = { ...pos };
      p.currentPos = { ...pos };
      if (data.fx !== undefined) {
        p.forward = { x: data.fx as number, y: data.fy as number, z: data.fz as number };
      }
      const lives = data.lives as number | undefined;
      if (lives !== undefined) {
        p.lives = lives;
        if (id === localId) {
          localLives = lives;
          updateLivesDisplay();
          hideGameOver();
        }
      }
      p.sprite.visible = true;
      p.label.text = p.name;
      refreshScoreboard();
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

    case 'powerUpSpawned': {
      const id = data.id as string;
      const pos: Vec3 = { x: data.x as number, y: data.y as number, z: data.z as number };
      const puType = data.puType as PowerUpType;
      const gfx = new Graphics();
      powerUps.set(id, { gfx, pos, type: puType });
      break;
    }

    case 'powerUpCollected':
    case 'powerUpExpired': {
      const id = data.id as string;
      const pu = powerUps.get(id);
      if (pu) {
        pu.gfx.destroy();
        powerUps.delete(id);
      }
      break;
    }

    case 'livesChanged': {
      const id = data.id as string;
      const lives = data.lives as number;
      const p = players.get(id);
      if (p) {
        p.lives = lives;
        if (id === localId) {
          localLives = lives;
          updateLivesDisplay();
        }
      }
      refreshScoreboard();
      break;
    }

    case 'effectActivated': {
      const id = data.id as string;
      const effect = data.effect as string;
      if (id === localId) {
        localEffects.push(effect);
        updateEffectDisplay();
      }
      break;
    }

    case 'effectExpired': {
      const id = data.id as string;
      const effect = data.effect as string;
      if (id === localId) {
        localEffects = localEffects.filter(e => e !== effect);
        updateEffectDisplay();
      }
      break;
    }

    case 'roundOver': {
      hideGameOver();
      showLobby();
      break;
    }

    case 'gameStarted': {
      hideGameOver();
      hideLobby();
      clearPlayers();
      const list = data.players as Array<{
        id: string; name: string; color: number; isNPC: boolean;
        x: number; y: number; z: number;
        fx: number; fy: number; fz: number;
        score: number; lives: number;
      }> | undefined;
      if (list) {
        for (const p of list) {
          const entry = ensurePlayer(p.id, p.name, p.color);
          entry.targetPos = { x: p.x, y: p.y, z: p.z };
          entry.currentPos = { ...entry.targetPos };
          entry.forward = { x: p.fx, y: p.fy, z: p.fz };
          entry.score = p.score ?? 0;
          entry.lives = p.lives ?? 3;
          entry.isNPC = p.isNPC ?? false;
          if (p.id === localId) {
            localLives = entry.lives;
            updateLivesDisplay();
          }
        }
      }
      refreshScoreboard();
      break;
    }

    case 'lobbyState':
    case 'lobbyUpdate': {
      updateLobby(data);
      break;
    }

    case 'hostChanged': {
      hostId = data.hostId as string | undefined ?? null;
      updateLobby({ type: 'lobbyUpdate' });
      break;
    }
  }
}

function connect(): void {
  keys.clear();
  setStatus('⏳ Connecting…', 0xffaa00);

  ws = new PartySocket({
    host: PARTY_HOST,
    party: "game-server",
    room: currentRoom,
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
    hideLobby();
    setStatus('✗ Disconnected — reconnecting…', 0xff4444);
  });

  ws.reconnect();
}

// ── Name-entry screen (HTML overlay) ─────────────────────────────────────────

function showNameEntry(): void {
  const overlay = document.createElement('div');
  overlay.id = 'name-overlay';

  const isPrivateRoom = currentRoom !== 'game';
  const roomHint = isPrivateRoom
    ? `<p class="room-key">Room: <code>${currentRoom}</code></p>`
    : '<p>Join the public game, or create a private room for friends.</p>';

  overlay.innerHTML = `
    <div class="nd">
      <h1>🚀 Simple Asteroids</h1>
      ${roomHint}
      <input id="pname" type="text" maxlength="20" placeholder="Ace Pilot" />
      <button id="join-btn">${isPrivateRoom ? 'Join Room' : 'Join Public Game'}</button>
      ${isPrivateRoom ? '' : '<button id="create-room-btn">Create Private Room</button>'}
      <p class="hint">WASD / ↑←↓→ — fly &nbsp;·&nbsp; SPACE — shoot &nbsp;·&nbsp; ESC — surrender</p>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>('#pname') as HTMLInputElement;
  const joinBtn = overlay.querySelector<HTMLButtonElement>('#join-btn') as HTMLButtonElement;
  const createBtn = overlay.querySelector<HTMLButtonElement>('#create-room-btn');
  input.focus();

  const join = (): void => {
    const raw = input.value.trim();
    playerName = raw.length > 0 ? raw : `Pilot${Math.floor(Math.random() * 999)}`;
    overlay.remove();
    connect();
  };

  const createRoom = (): void => {
    currentRoom = generateRoomKey();
    setRoomInURL(currentRoom);
    overlay.remove();
    showNameEntry();
  };

  joinBtn.addEventListener('click', join);
  if (createBtn) createBtn.addEventListener('click', createRoom);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') join();
  });
}

showNameEntry();
