import { Server, Connection, ConnectionContext } from "partyserver";
import { setup, assign, interpret, type Actor } from "xstate";
import {
  Vec3, ROTATION_SPEED, PLAYER_ACCEL, FRICTION, BRAKE_DECEL,
  MAX_SPEED, BULLET_SPEED, BULLET_LIFE, SHOOT_COOLDOWN,
  ASTEROID_SPEED, ASTEROID_RADII, PLAYER_RADII, ASTEROID_SCORES,
  INITIAL_LIVES, RESPAWN_DELAY, GAME_OVER_RESPAWN_DELAY,
  POWERUP_SPAWN_INTERVAL, MAX_POWERUPS, POWERUP_LIFETIME, POWERUP_RADIUS,
  PLAYER_KILL_SCORE, INVISIBILITY_DURATION, MULTI_CANNON_DURATION, MULTI_CANNON_SPREAD,
  NPC_COUNT, NPC_NAMES,
  type PowerUpType, POWERUP_TYPES,
  vAdd, vSub, vScale, vLen, vNorm,
  tangentOf, randomPos, sphereAdvance, rotateForward, initialTangent,
  npcAI, BoidInfluence,
} from "./physics";

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
  isNPC: boolean;
  aiRotateDir: number;
  aiSwitchTimer: number;
  aiThrustTimer: number;
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
    for (let i = 0; i < NPC_COUNT; i++) {
      this.spawnNPC(i);
    }
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
      isNPC: false,
      aiRotateDir: 0,
      aiSwitchTimer: 0,
      aiThrustTimer: 0,
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

    for (const [pid, p] of this.players) {
      if (pid === connection.id) continue;
      connection.send(JSON.stringify({
        type: "playerJoined",
        id: pid,
        name: p.name,
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
    player.shootCooldown = player.isNPC ? Math.random() * SHOOT_COOLDOWN : 0;
    if (player.isNPC) {
      player.aiRotateDir = Math.random() < 0.5 ? -1 : 1;
      player.aiSwitchTimer = 1 + Math.random() * 3;
    }
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

  private spawnNPC(index: number): void {
    const pos = randomPos();
    const id = `npc_${index}`;
    const player: PlayerState = {
      name: NPC_NAMES[index] ?? `Bot ${index}`,
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
      shootCooldown: Math.random() * SHOOT_COOLDOWN,
      invisibilityTimer: 0,
      multiCannonTimer: 0,
      isNPC: true,
      aiRotateDir: Math.random() < 0.5 ? -1 : 1,
      aiSwitchTimer: 1 + Math.random() * 3,
      aiThrustTimer: Math.random() * 3,
    };
    this.players.set(id, player);
    this.broadcast(JSON.stringify({ type: "playerJoined", id, name: player.name }));
  }

  private tick(): void {
    const dt = 1 / 30;

    // ── Player movement ──
    for (const [id, p] of this.players) {
      if (!p.actor.getSnapshot().matches("alive")) continue;

      if (p.isNPC) {
        const influences: BoidInfluence[] = [];

        for (const [oid, o] of this.players) {
          if (oid === id || !o.actor.getSnapshot().matches("alive")) continue;
          const d = vLen(vSub(p.pos, o.pos));
          if (d < 100) {
            influences.push({ pos: o.pos, repel: true, range: 100, strength: 1 });
          }
        }

        // Follow/avoid local players
        for (const [, o] of this.players) {
          if (o.isNPC || !o.actor.getSnapshot().matches("alive")) continue;
          const d = vLen(vSub(p.pos, o.pos));
          if (d < 400) {
            if (d < 80) {
              influences.push({ pos: o.pos, repel: true, range: 80, strength: 2 });
            } else {
              influences.push({ pos: o.pos, repel: false, range: 400, strength: 1.5 });
            }
          }
        }

        for (const [, b] of this.bullets) {
          const d = vLen(vSub(p.pos, b.pos));
          if (d < 100) {
            influences.push({ pos: b.pos, repel: true, range: 100, strength: 3 });
          }
        }

        for (const [, a] of this.asteroids) {
          const d = vLen(vSub(p.pos, a.pos));
          if (d < 60) {
            influences.push({ pos: a.pos, repel: true, range: 60, strength: 2 });
          }
        }

        npcAI(p, dt, influences, p.pos, p.forward);
      }

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
      const speed = vLen(b.vel);
      const moved = sphereAdvance(b.pos, b.vel, dt);
      b.pos = moved.pos;
      b.vel = vScale(vNorm(moved.vel), speed);
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

    // ── Bullet-player collisions ──
    for (const [bid, b] of this.bullets) {
      if (deadBullets.includes(bid)) continue;
      if (b.life <= 0) continue;

      for (const [pid, p] of this.players) {
        if (!p.actor.getSnapshot().matches("alive")) continue;
        if (b.ownerId === pid) continue;
        const d = vLen(vSub(b.pos, p.pos));
        if (d < 15) {
          deadBullets.push(bid);
          p.actor.send({ type: "HIT" });
          const livesLeft = p.actor.getSnapshot().context.lives;
          this.broadcast(JSON.stringify({ type: "playerKilled", id: pid, lives: livesLeft }));
          if (p.actor.getSnapshot().matches("gameOver")) {
            setTimeout(() => this.respawnPlayer(pid, true), GAME_OVER_RESPAWN_DELAY * 1000);
          } else {
            setTimeout(() => this.respawnPlayer(pid, false), RESPAWN_DELAY * 1000);
          }
          const shooter = this.players.get(b.ownerId);
          if (shooter) {
            shooter.score += PLAYER_KILL_SCORE;
            this.broadcast(
              JSON.stringify({ type: "scoreUpdated", id: b.ownerId, score: shooter.score }),
            );
          }
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
            vel: vAdd(vScale(dir, BULLET_SPEED), p.vel),
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