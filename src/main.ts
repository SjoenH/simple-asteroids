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

interface Vec3 { x: number; y: number; z: number; }

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
  isNPC: boolean;
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

const RADIUS = 1000;

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

  const mapSize = Math.min(w, h) * 0.45;
  const mapX = w / 2;
  const mapY = h / 2 + 5;
  const mapR = mapSize / 2;

  const mapBg = new Graphics();
  mapBg.setStrokeStyle({ color: 0x334466, width: 1 });
  mapBg.circle(mapX, mapY, mapR);
  mapBg.stroke();
  gameOverLayer.addChild(mapBg);

  const mapGfx = new Graphics();

  for (const [eid, ep] of players) {
    if (ep.currentPos.z <= 0) continue;
    const sx = (ep.currentPos.x / RADIUS) * mapR * 0.85;
    const sy = (ep.currentPos.y / RADIUS) * mapR * 0.85;
    if (Math.sqrt(sx * sx + sy * sy) > mapR - 4) continue;
    const color = eid === localId ? 0xffff00 : ep.isNPC ? 0x88ff88 : 0x44ddff;
    const a = Math.atan2(ep.forward.x, ep.forward.y);
    const sz = 4;
    const tipX = mapX + sx + Math.sin(a) * sz;
    const tipY = mapY + sy - Math.cos(a) * sz;
    const lx = mapX + sx + Math.sin(a + 2.3) * sz * 0.55;
    const ly = mapY + sy - Math.cos(a + 2.3) * sz * 0.55;
    const rx = mapX + sx + Math.sin(a - 2.3) * sz * 0.55;
    const ry = mapY + sy - Math.cos(a - 2.3) * sz * 0.55;
    mapGfx.setFillStyle({ color, alpha: 0.9 });
    mapGfx.poly([tipX, tipY, lx, ly, rx, ry]);
    mapGfx.fill();
  }

  for (const apos of asteroidPos.values()) {
    if (apos.z <= 0) continue;
    const sx = (apos.x / RADIUS) * mapR * 0.85;
    const sy = (apos.y / RADIUS) * mapR * 0.85;
    if (Math.sqrt(sx * sx + sy * sy) > mapR - 4) continue;
    mapGfx.setFillStyle({ color: 0xff6644, alpha: 0.6 });
    mapGfx.circle(mapX + sx, mapY + sy, 2);
    mapGfx.fill();
  }

  for (const bpos of bulletPos.values()) {
    if (bpos.z <= 0) continue;
    const sx = (bpos.x / RADIUS) * mapR * 0.85;
    const sy = (bpos.y / RADIUS) * mapR * 0.85;
    if (Math.sqrt(sx * sx + sy * sy) > mapR - 4) continue;
    mapGfx.setFillStyle({ color: 0xffffff, alpha: 0.5 });
    mapGfx.circle(mapX + sx, mapY + sy, 1);
    mapGfx.fill();
  }

  gameOverLayer.addChild(mapGfx);

  gameOverLayer.addChild(createGameOverButton(w));
  gameOverLayer.visible = true;
}

let gameOverBtn: Text | null = null;

function createGameOverButton(w: number): Text {
  const otherAlive = [...players.values()].some(p => !p.isNPC && p.lives > 0);
  if (otherAlive) {
    const msg = makeText("Waiting for all players to die...", { fill: 0x888899, fontSize: 16 });
    msg.anchor.set(0.5);
    msg.x = w / 2;
    msg.y = 530;
    gameOverBtn = null;
    return msg;
  }
  const btn = makeText("[ Click to Respawn ]", { fill: 0x44ddff, fontSize: 20 });
  btn.anchor.set(0.5);
  btn.x = w / 2;
  btn.y = 520;
  btn.eventMode = "static";
  btn.cursor = "pointer";
  btn.on("pointertap", () => {
    ws.send(JSON.stringify({ type: "restart" }));
  });
  gameOverBtn = btn;
  return btn;
}

function updateGameOverButton(): void {
  if (!gameOverLayer.visible) return;
  const w = app.screen.width;
  const otherAlive = [...players.values()].some(p => !p.isNPC && p.lives > 0);
  if (otherAlive) {
    if (gameOverBtn) {
      const idx = gameOverLayer.getChildIndex(gameOverBtn);
      gameOverLayer.removeChild(gameOverBtn);
      gameOverBtn = null;
      const msg = makeText("Waiting for all players to die...", { fill: 0x888899, fontSize: 16 });
      msg.anchor.set(0.5);
      msg.x = w / 2;
      msg.y = 530;
      gameOverLayer.addChildAt(msg, idx);
    }
  } else {
    if (!gameOverBtn) {
      gameOverBtn = makeText("[ Click to Respawn ]", { fill: 0x44ddff, fontSize: 20 });
      gameOverBtn.anchor.set(0.5);
      gameOverBtn.x = w / 2;
      gameOverBtn.y = 520;
      gameOverBtn.eventMode = "static";
      gameOverBtn.cursor = "pointer";
      gameOverBtn.on("pointertap", () => {
        ws.send(JSON.stringify({ type: "restart" }));
      });
      gameOverLayer.addChild(gameOverBtn);
    }
  }
}

function hideGameOver(): void {
  gameOverLayer.visible = false;
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

  for (const p of players.values()) {
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
    targetPos: { x: 0, y: 0, z: RADIUS },
    currentPos: { x: 0, y: 0, z: RADIUS },
    forward: { x: 0, y: 0, z: 1 },
    score: 0,
    lives: 3,
    name: displayName,
    isNPC: id.startsWith('npc_'),
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

function movePlayer(id: string, pos: Vec3, forward?: Vec3): void {
  const p = ensurePlayer(id);
  p.targetPos = pos;
  if (forward) p.forward = forward;
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
      localLives = (data.lives as number) ?? 3;
      updateLivesDisplay();
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
  }
}

function connect(): void {
  keys.clear();
  setStatus('⏳ Connecting…', 0xffaa00);

  ws = new PartySocket({
    host: PARTY_HOST,
    party: "game-server",
    room: "game",
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
