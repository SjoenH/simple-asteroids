import { Server, Connection, ConnectionContext } from "partyserver";
import { setup, assign, interpret, type Actor } from "xstate";

interface Vec3 { x: number; y: number; z: number; }

const RADIUS = 1000;
const ROTATION_SPEED = 3;
const PLAYER_ACCEL = 300;
const FRICTION = 0.015;
const BRAKE_DECEL = 0.08;
const MAX_SPEED = 400;
const BULLET_SPEED = 400;
const BULLET_LIFE = 2;
const SHOOT_COOLDOWN = 0.25;
const ASTEROID_SPEED = 60;
const ASTEROID_RADII: Record<number, number> = { 1: 40, 2: 26, 3: 14 };
const PLAYER_RADII: Record<number, number> = { 1: 35, 2: 24, 3: 14 };
const ASTEROID_SCORES: Record<number, number> = { 1: 20, 2: 50, 3: 100 };

const INITIAL_LIVES = 3;
const RESPAWN_DELAY = 3;
const GAME_OVER_RESPAWN_DELAY = 5;
const POWERUP_SPAWN_INTERVAL = 6;
const MAX_POWERUPS = 6;
const POWERUP_LIFETIME = 20;
const POWERUP_RADIUS = 60;
const INVISIBILITY_DURATION = 5;
const MULTI_CANNON_DURATION = 8;
const MULTI_CANNON_SPREAD = 0.12;

type PowerUpType = 'extraLife' | 'invisibility' | 'multiCannon';
const POWERUP_TYPES: PowerUpType[] = ['extraLife', 'invisibility', 'multiCannon'];

// ── XState machines ──

const playerMachine = setup({
  types: {
    context: {} as { lives: number },
    events: {} as
      | { type: "HIT" }
      | { type: "COLLECT_LIFE" }
      | { type: "RESPAWN" }
      | { type: "GAME_OVER" }
      | { type: "RESTART" },
  },
  guards: {
    hasLives: ({ context }) => context.lives > 0,
  },
  actions: {
    loseLife: assign({ lives: ({ context }) => context.lives - 1 }),
    gainLife: assign({ lives: ({ context }) => Math.min(context.lives + 1, 5) }),
    resetLives: assign({ lives: () => INITIAL_LIVES }),
  },
}).createMachine({
  id: "player",
  initial: "alive",
  context: { lives: INITIAL_LIVES },
  states: {
    alive: {
      on: {
        HIT: { target: "dead", actions: "loseLife" },
        COLLECT_LIFE: { actions: "gainLife" },
      },
    },
    dead: {
      on: {
        RESPAWN: { target: "alive", guard: "hasLives" },
        GAME_OVER: { target: "gameOver" },
      },
    },
    gameOver: {
      on: {
        RESTART: { target: "alive", actions: "resetLives" },
      },
    },
  },
});

const gameMachine = setup({
  types: {
    context: {} as { playerCount: number },
    events: {} as
      | { type: "PLAYER_JOINED" }
      | { type: "PLAYER_LEFT" },
  },
  actions: {
    inc: assign({ playerCount: ({ context }) => context.playerCount + 1 }),
    dec: assign({ playerCount: ({ context }) => context.playerCount - 1 }),
    reset: assign({ playerCount: () => 0 }),
  },
}).createMachine({
  id: "game",
  initial: "idle",
  context: { playerCount: 0 },
  states: {
    idle: {
      on: {
        PLAYER_JOINED: { target: "playing", actions: "inc" },
      },
    },
    playing: {
      on: {
        PLAYER_JOINED: { actions: "inc" },
        PLAYER_LEFT: [
          { guard: ({ context }) => context.playerCount <= 1, target: "idle", actions: "reset" },
          { actions: "dec" },
        ],
      },
    },
  },
});

type PlayerActor = Actor<typeof playerMachine>;

let nextAsteroidId = 1;
let nextPowerUpId = 1;
let nextBulletId = 1;

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

function randomPos(): Vec3 {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return {
    x: RADIUS * Math.sin(phi) * Math.cos(theta),
    y: RADIUS * Math.sin(phi) * Math.sin(theta),
    z: RADIUS * Math.cos(phi),
  };
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

function initialTangent(pos: Vec3): Vec3 {
  const n = vNorm(pos);
  const t = tangentOf({ x: 0, y: 0, z: 1 }, n);
  return vLen(t) > 0.001 ? vNorm(t) : vNorm(tangentOf({ x: 1, y: 0, z: 0 }, n));
}

interface PlayerState {
  name: string;
  pos: Vec3;
  vel: Vec3;
  forward: Vec3;
  score: number;
  actor: PlayerActor;
  thrust: boolean;
  brake: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  shoot: boolean;
  shootCooldown: number;
  invisibilityTimer: number;
  multiCannonTimer: number;
}

interface AsteroidState {
  pos: Vec3;
  vel: Vec3;
  size: number;
}

interface BulletState {
  pos: Vec3;
  vel: Vec3;
  ownerId: string;
  life: number;
}

interface PowerUpState {
  pos: Vec3;
  type: PowerUpType;
  lifetime: number;
}

export class GameServer extends Server {
  private players = new Map<string, PlayerState>();
  private asteroids = new Map<string, AsteroidState>();
  private bullets = new Map<string, BulletState>();
  private powerUps = new Map<string, PowerUpState>();
  private gameActor = interpret(gameMachine).start();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private powerUpSpawnTimer = 0;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
  }

  async onStart(): Promise<void> {
    this.spawnAsteroids(6);
    this.tickInterval = setInterval(() => this.tick(), 1000 / 30);
  }

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const pos = randomPos();
    const player: PlayerState = {
      name: "Unknown",
      pos,
      vel: { x: 0, y: 0, z: 0 },
      forward: initialTangent(pos),
      score: 0,
      actor: interpret(playerMachine).start(),
      thrust: false,
      brake: false,
      rotateLeft: false,
      rotateRight: false,
      shoot: false,
      shootCooldown: 0,
      invisibilityTimer: 0,
      multiCannonTimer: 0,
    };
    this.players.set(connection.id, player);

    this.gameActor.send({ type: "PLAYER_JOINED" });

    connection.send(JSON.stringify({ type: "connected", id: connection.id, lives: player.actor.getSnapshot().context.lives }));

    for (const [pid, pu] of this.powerUps) {
      connection.send(JSON.stringify({
        type: "powerUpSpawned", id: pid,
        x: pu.pos.x, y: pu.pos.y, z: pu.pos.z,
        puType: pu.type,
      }));
    }

    this.broadcast(
      JSON.stringify({
        type: "playerJoined",
        id: connection.id,
        name: player.name,
      }),
    );
  }

  async onMessage(connection: Connection, message: string): Promise<void> {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const player = this.players.get(connection.id);
    if (!player) return;

    switch (data.type) {
      case "setName":
        player.name = String(data.name ?? "Unknown");
        this.broadcast(
          JSON.stringify({
            type: "playerRenamed",
            id: connection.id,
            name: player.name,
          }),
        );
        break;
      case "playerInput":
        player.thrust = Boolean(data.thrust);
        player.brake = Boolean(data.brake);
        player.rotateLeft = Boolean(data.rotateLeft);
        player.rotateRight = Boolean(data.rotateRight);
        player.shoot = Boolean(data.shoot);
        break;
    }
  }

  async onClose(connection: Connection): Promise<void> {
    this.players.delete(connection.id);
    this.gameActor.send({ type: "PLAYER_LEFT" });
    this.broadcast(JSON.stringify({ type: "playerLeft", id: connection.id }));
  }

  private spawnAsteroids(count: number, size = 1): void {
    if (!this.gameActor.getSnapshot().matches("playing")) return;
    for (let i = 0; i < count; i++) {
      this.spawnAsteroidAt(randomPos(), size, Math.random() * Math.PI * 2);
    }
  }

  private spawnAsteroidAt(pos: Vec3, size: number, angle: number): string {
    const id = `ast_${nextAsteroidId++}`;
    const speed = ASTEROID_SPEED * (0.5 + Math.random()) * (4 - size) * 0.5;
    const fwd = rotateForward(initialTangent(pos), pos, angle);
    this.asteroids.set(id, { pos, vel: vScale(fwd, speed), size });
    this.broadcast(
      JSON.stringify({ type: "asteroidMoved", id, x: pos.x, y: pos.y, z: pos.z, size }),
    );
    return id;
  }

  private spawnPowerUp(): void {
    const id = `pu_${nextPowerUpId++}`;
    const pos = randomPos();
    const puType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    this.powerUps.set(id, { pos, type: puType, lifetime: POWERUP_LIFETIME });
    this.broadcast(
      JSON.stringify({ type: "powerUpSpawned", id, x: pos.x, y: pos.y, z: pos.z, puType }),
    );
  }

  private collectPowerUp(playerId: string, puId: string): void {
    const p = this.players.get(playerId);
    const pu = this.powerUps.get(puId);
    if (!p || !pu) return;

    this.powerUps.delete(puId);
    this.broadcast(JSON.stringify({ type: "powerUpCollected", id: puId, playerId }));

    switch (pu.type) {
      case 'extraLife':
        p.actor.send({ type: "COLLECT_LIFE" });
        this.broadcast(JSON.stringify({ type: "livesChanged", id: playerId, lives: p.actor.getSnapshot().context.lives }));
        break;
      case 'invisibility':
        p.invisibilityTimer = INVISIBILITY_DURATION;
        this.broadcast(JSON.stringify({ type: "effectActivated", id: playerId, effect: "invisibility", duration: INVISIBILITY_DURATION }));
        break;
      case 'multiCannon':
        p.multiCannonTimer = MULTI_CANNON_DURATION;
        this.broadcast(JSON.stringify({ type: "effectActivated", id: playerId, effect: "multiCannon", duration: MULTI_CANNON_DURATION }));
        break;
    }
  }

  private respawnPlayer(id: string, fromGameOver: boolean): void {
    const player = this.players.get(id);
    if (!player) return;
    player.pos = randomPos();
    player.vel = { x: 0, y: 0, z: 0 };
    player.forward = initialTangent(player.pos);
    if (fromGameOver) {
      player.actor.send({ type: "RESTART" });
    } else {
      player.actor.send({ type: "RESPAWN" });
    }
    player.invisibilityTimer = 0;
    player.multiCannonTimer = 0;
    this.broadcast(
      JSON.stringify({
        type: "playerRespawned",
        id,
        x: player.pos.x,
        y: player.pos.y,
        z: player.pos.z,
        fx: player.forward.x,
        fy: player.forward.y,
        fz: player.forward.z,
        lives: player.actor.getSnapshot().context.lives,
      }),
    );
  }

  private tick(): void {
    const dt = 1 / 30;

    // ── Player movement ──
    for (const [id, p] of this.players) {
      if (!p.actor.getSnapshot().matches("alive")) continue;

      if (p.rotateLeft) {
        p.forward = rotateForward(p.forward, p.pos, -ROTATION_SPEED * dt);
      }
      if (p.rotateRight) {
        p.forward = rotateForward(p.forward, p.pos, ROTATION_SPEED * dt);
      }

      if (p.thrust) {
        p.vel = vAdd(p.vel, vScale(p.forward, PLAYER_ACCEL * dt));
      }
      if (p.brake) {
        p.vel = vScale(p.vel, 1 - BRAKE_DECEL);
      }

      p.vel = vScale(p.vel, 1 - FRICTION * dt);

      const speed = vLen(p.vel);
      if (speed > MAX_SPEED) {
        p.vel = vScale(vNorm(p.vel), MAX_SPEED);
      }

      const moved = sphereAdvance(p.pos, p.vel, dt);
      p.pos = moved.pos;
      p.vel = moved.vel;
      p.forward = vNorm(tangentOf(p.forward, p.pos));

      if (p.invisibilityTimer > 0) {
        p.invisibilityTimer -= dt;
        if (p.invisibilityTimer <= 0) {
          p.invisibilityTimer = 0;
          this.broadcast(JSON.stringify({ type: "effectExpired", id, effect: "invisibility" }));
        }
      }
      if (p.multiCannonTimer > 0) {
        p.multiCannonTimer -= dt;
        if (p.multiCannonTimer <= 0) {
          p.multiCannonTimer = 0;
          this.broadcast(JSON.stringify({ type: "effectExpired", id, effect: "multiCannon" }));
        }
      }

      this.broadcast(
        JSON.stringify({
          type: "playerMoved",
          id,
          x: p.pos.x,
          y: p.pos.y,
          z: p.pos.z,
          fx: p.forward.x,
          fy: p.forward.y,
          fz: p.forward.z,
          invisible: p.invisibilityTimer > 0 ? true : undefined,
        }),
      );
    }

    // ── Power-ups ──
    this.powerUpSpawnTimer += dt;
    if (this.powerUpSpawnTimer >= POWERUP_SPAWN_INTERVAL) {
      this.powerUpSpawnTimer = 0;
      if (this.powerUps.size < MAX_POWERUPS) {
        this.spawnPowerUp();
      }
    }

    const expiredPowerUps: string[] = [];
    for (const [id, pu] of this.powerUps) {
      pu.lifetime -= dt;
      if (pu.lifetime <= 0) {
        expiredPowerUps.push(id);
        continue;
      }
      for (const [pid, p] of this.players) {
        if (!p.actor.getSnapshot().matches("alive")) continue;
        const d = vLen(vSub(p.pos, pu.pos));
        if (d < POWERUP_RADIUS) {
          this.collectPowerUp(pid, id);
          break;
        }
      }
    }
    for (const id of expiredPowerUps) {
      this.powerUps.delete(id);
      this.broadcast(JSON.stringify({ type: "powerUpExpired", id }));
    }

    // ── Bullets ──
    for (const [id, b] of this.bullets) {
      const moved = sphereAdvance(b.pos, b.vel, dt);
      b.pos = moved.pos;
      b.vel = vScale(vNorm(moved.vel), BULLET_SPEED);
      b.life -= dt;

      this.broadcast(
        JSON.stringify({ type: "bulletMoved", id, x: b.pos.x, y: b.pos.y, z: b.pos.z }),
      );
    }

    // ── Asteroids ──
    for (const [id, a] of this.asteroids) {
      const moved = sphereAdvance(a.pos, a.vel, dt);
      a.pos = moved.pos;
      a.vel = moved.vel;

      this.broadcast(
        JSON.stringify({ type: "asteroidMoved", id, x: a.pos.x, y: a.pos.y, z: a.pos.z, size: a.size }),
      );
    }

    // ── Bullet-asteroid collisions ──
    const deadBullets: string[] = [];
    const hitAsteroids: Map<string, string[]> = new Map();

    for (const [bid, b] of this.bullets) {
      if (b.life <= 0) {
        deadBullets.push(bid);
        continue;
      }

      for (const [aid, a] of this.asteroids) {
        const d = vLen(vSub(b.pos, a.pos));
        if (d < ASTEROID_RADII[a.size]) {
          deadBullets.push(bid);
          const list = hitAsteroids.get(aid) ?? [];
          list.push(b.ownerId);
          hitAsteroids.set(aid, list);
          break;
        }
      }
    }

    for (const bid of deadBullets) {
      this.bullets.delete(bid);
      this.broadcast(JSON.stringify({ type: "bulletRemoved", id: bid }));
    }

    for (const [aid, ownerIds] of hitAsteroids) {
      const a = this.asteroids.get(aid);
      if (!a) continue;

      this.asteroids.delete(aid);
      this.broadcast(JSON.stringify({ type: "asteroidRemoved", id: aid }));

      if (a.size < 3) {
        const childSize = a.size + 1;
        for (let i = 0; i < 2; i++) {
          const angle = Math.random() * Math.PI * 2;
          this.spawnAsteroidAt(a.pos, childSize, angle);
        }
      }

      for (const ownerId of ownerIds) {
        const p = this.players.get(ownerId);
        if (p) {
          p.score += ASTEROID_SCORES[a.size];
          this.broadcast(
            JSON.stringify({ type: "scoreUpdated", id: ownerId, score: p.score }),
          );
        }
      }
    }

    // ── Player-asteroid collisions ──
    for (const [pid, p] of this.players) {
      if (!p.actor.getSnapshot().matches("alive")) continue;

      for (const [aid, a] of this.asteroids) {
        const d = vLen(vSub(p.pos, a.pos));
        if (d < PLAYER_RADII[a.size]) {
          p.actor.send({ type: "HIT" });
          const livesLeft = p.actor.getSnapshot().context.lives;
          this.broadcast(JSON.stringify({ type: "playerKilled", id: pid, lives: livesLeft }));

          if (p.actor.getSnapshot().matches("gameOver")) {
            setTimeout(() => this.respawnPlayer(pid, true), GAME_OVER_RESPAWN_DELAY * 1000);
          } else {
            setTimeout(() => this.respawnPlayer(pid, false), RESPAWN_DELAY * 1000);
          }
          break;
        }
      }
    }

    // ── Shooting ──
    for (const [id, p] of this.players) {
      if (!p.actor.getSnapshot().matches("alive")) continue;

      if (p.shoot && p.shootCooldown <= 0) {
        const isMulti = p.multiCannonTimer > 0;
        const count = isMulti ? 3 : 1;
        const spread = isMulti ? MULTI_CANNON_SPREAD : 0;
        for (let i = 0; i < count; i++) {
          const offset = (i - (count - 1) / 2) * spread;
          const dir = offset === 0 ? p.forward : rotateForward(p.forward, p.pos, offset);
          const bid = `bul_${nextBulletId++}`;
          this.bullets.set(bid, {
            pos: { ...p.pos },
            vel: vScale(dir, BULLET_SPEED),
            ownerId: id,
            life: BULLET_LIFE,
          });
          const b = this.bullets.get(bid)!;
          this.broadcast(
            JSON.stringify({ type: "bulletMoved", id: bid, x: b.pos.x, y: b.pos.y, z: b.pos.z }),
          );
        }
        p.shootCooldown = SHOOT_COOLDOWN;
      }
      if (p.shootCooldown > 0) p.shootCooldown -= dt;
    }

    if (this.asteroids.size === 0) {
      this.spawnAsteroids(6);
    }
  }
}