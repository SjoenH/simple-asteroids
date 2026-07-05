import { Server, Connection, ConnectionContext } from "partyserver";
import { setup, assign, interpret, type Actor } from "xstate";
import {
  Vec3, ROTATION_SPEED, PLAYER_ACCEL, FRICTION, BRAKE_DECEL,
  MAX_SPEED, BULLET_SPEED, BULLET_LIFE, SHOOT_COOLDOWN,
  ASTEROID_SPEED, ASTEROID_RADII, PLAYER_RADII, ASTEROID_SCORES,
  INITIAL_LIVES, RESPAWN_DELAY, GAME_OVER_RESPAWN_DELAY,
  POWERUP_SPAWN_INTERVAL, MAX_POWERUPS, POWERUP_LIFETIME, POWERUP_RADIUS,
  PLAYER_KILL_SCORE, INVISIBILITY_DURATION, MULTI_CANNON_DURATION, MULTI_CANNON_SPREAD,
  NPC_COUNT, NPC_NAMES, SPAWN_MIN_DIST,
  type PowerUpType, POWERUP_TYPES,
  vAdd, vSub, vScale, vLen, vLenSq, vNorm,
  tangentOf, randomPos, randomPosAwayFrom, sphereAdvance, rotateForward, initialTangent,
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
      | { type: "RESTART" }
      | { type: "SURRENDER" },
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
        SURRENDER: { target: "gameOver" },
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
    context: {} as Record<string, never>,
    events: {} as
      | { type: "START" }
      | { type: "ROUND_OVER" },
  },
}).createMachine({
  id: "game",
  initial: "lobby",
  context: {},
  states: {
    lobby: {
      on: {
        START: { target: "playing" },
      },
    },
    playing: {
      on: {
        ROUND_OVER: { target: "lobby" },
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
  color: number;
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
  aiThrustTimer: number;
}

interface LobbyPlayer {
  id: string;
  name: string;
  color: number;
  ready: boolean;
  connection: Connection;
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
  private lobbyPlayers = new Map<string, LobbyPlayer>();
  private hostId: string | null = null;
  private asteroids = new Map<string, AsteroidState>();
  private bullets = new Map<string, BulletState>();
  private powerUps = new Map<string, PowerUpState>();
  private gameActor = interpret(gameMachine).start();
  private powerUpSpawnTimer = 0;

  async onStart(): Promise<void> {
    setInterval(() => this.tick(), 1000 / 30);
  }

  async onConnect(connection: Connection, _ctx: ConnectionContext): Promise<void> {
    const lobbyPlayer: LobbyPlayer = {
      id: connection.id,
      name: "Unknown",
      color: 0xffff00,
      ready: false,
      connection,
    };
    this.lobbyPlayers.set(connection.id, lobbyPlayer);

    if (!this.hostId) {
      this.hostId = connection.id;
      connection.send(JSON.stringify({ type: "hostChanged", hostId: connection.id }));
    }

    const inGame = this.gameActor.getSnapshot().matches("playing");

    connection.send(JSON.stringify({ type: "connected", id: connection.id, inGame, hostId: this.hostId }));

    // Send lobby state
    connection.send(JSON.stringify({
      type: "lobbyState",
      hostId: this.hostId,
      players: [...this.lobbyPlayers.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, ready: p.ready,
      })),
    }));

    // If a round is in progress, send game state to new joiner (they watch / play next round)
    if (inGame) {
      for (const [pid, p] of this.players) {
        connection.send(JSON.stringify({
          type: "playerJoined",
          id: pid, name: p.name, isNPC: p.isNPC, color: p.color,
        }));
      }
    }

    this.broadcastLobbyUpdate();
  }

  async onMessage(connection: Connection, message: string): Promise<void> {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const player = this.players.get(connection.id);
    if (player) {
      switch (data.type) {
        case "playerInput":
          player.thrust = Boolean(data.thrust);
          player.brake = Boolean(data.brake);
          player.rotateLeft = Boolean(data.rotateLeft);
          player.rotateRight = Boolean(data.rotateRight);
          player.shoot = Boolean(data.shoot);
          break;
        case "surrender":
          if (player.actor.getSnapshot().matches("alive")) {
            player.actor.send({ type: "SURRENDER" });
            this.broadcast(JSON.stringify({ type: "playerKilled", id: connection.id, lives: 0 }));
            this.checkRoundOver();
          }
          break;
      }
      return;
    }

    const lobbyPlayer = this.lobbyPlayers.get(connection.id);
    if (lobbyPlayer) {
      switch (data.type) {
        case "setName":
          lobbyPlayer.name = String(data.name ?? "Unknown");
          this.broadcastLobbyUpdate();
          break;
        case "setColor":
          lobbyPlayer.color = Number(data.color);
          this.broadcastLobbyUpdate();
          break;
        case "ready":
          lobbyPlayer.ready = Boolean(data.ready);
          this.broadcastLobbyUpdate();
          this.checkAllReady();
          break;
        case "startGame":
          if (this.gameActor.getSnapshot().matches("playing")) break;
          if ([...this.lobbyPlayers.values()].every(p => p.ready)) {
            this.startRound();
          }
          break;
        case "kick":
          if (connection.id !== this.hostId) break;
          const targetId = String(data.targetId);
          if (targetId === connection.id) break;
          const target = this.lobbyPlayers.get(targetId);
          if (target) {
            target.connection.close(1008, "Kicked by host");
            this.lobbyPlayers.delete(targetId);
            this.broadcastLobbyUpdate();
          }
          break;
      }
      return;
    }
  }

  async onClose(connection: Connection): Promise<void> {
    this.lobbyPlayers.delete(connection.id);
    this.players.delete(connection.id);
    this.broadcast(JSON.stringify({ type: "playerLeft", id: connection.id }));

    // Reassign host if the host left
    if (connection.id === this.hostId) {
      const nextHost = this.lobbyPlayers.values().next().value as LobbyPlayer | undefined;
      this.hostId = nextHost?.id ?? null;
      if (this.hostId) {
        const msg = JSON.stringify({ type: "hostChanged", hostId: this.hostId });
        for (const [, lp] of this.lobbyPlayers) {
          lp.connection.send(msg);
        }
      }
    }

    if (this.gameActor.getSnapshot().matches("playing")) {
      this.checkRoundOver();
    }
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
    const others: Vec3[] = [];
    for (const [pid, p] of this.players) {
      if (pid === id) continue;
      if (!p.actor.getSnapshot().matches("alive")) continue;
      others.push(p.pos);
    }
    player.pos = randomPosAwayFrom(others, SPAWN_MIN_DIST);
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

  private spawnNPC(index: number, existing?: Vec3[]): void {
    const pos = existing ? randomPosAwayFrom(existing, SPAWN_MIN_DIST) : randomPos();
    if (existing) existing.push(pos);
    const id = `npc_${index}`;
    const player: PlayerState = {
      name: NPC_NAMES[index] ?? `Bot ${index}`,
      color: 0x888888,
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
      aiThrustTimer: Math.random() * 3,
    };
    this.players.set(id, player);
    this.broadcast(JSON.stringify({ type: "playerJoined", id, name: player.name, isNPC: true, color: player.color }));
  }

  private broadcastLobbyUpdate(): void {
    const msg = JSON.stringify({
      type: "lobbyUpdate",
      hostId: this.hostId,
      players: [...this.lobbyPlayers.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, ready: p.ready,
      })),
    });
    for (const [, lp] of this.lobbyPlayers) {
      lp.connection.send(msg);
    }
  }

  private checkAllReady(): void {
    // No-op — round starts via explicit startGame message
  }

  private startRound(): void {
    const usedSpawnPositions: Vec3[] = [];
    for (const [, lp] of this.lobbyPlayers) {
      const pos = randomPosAwayFrom(usedSpawnPositions, SPAWN_MIN_DIST);
      usedSpawnPositions.push(pos);
      const p: PlayerState = {
        name: lp.name,
        color: lp.color,
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
        aiThrustTimer: 0,
      };
      this.players.set(lp.id, p);
    }

    // Reset lobby ready states
    for (const [, lp] of this.lobbyPlayers) {
      lp.ready = false;
    }

    this.spawnAsteroids(6);
    for (let i = 0; i < NPC_COUNT; i++) {
      this.spawnNPC(i, usedSpawnPositions);
    }

    this.gameActor.send({ type: "START" });

    this.broadcastLobbyUpdate();

    this.broadcast(JSON.stringify({
      type: "gameStarted",
      players: [...this.players.entries()].map(([id, p]) => ({
        id, name: p.name, color: p.color,
        x: p.pos.x, y: p.pos.y, z: p.pos.z,
        fx: p.forward.x, fy: p.forward.y, fz: p.forward.z,
        score: p.score,
        isNPC: p.isNPC,
        lives: p.actor.getSnapshot().context.lives,
      })),
    }));
  }

  private checkRoundOver(): void {
    if (!this.gameActor.getSnapshot().matches("playing")) return;
    let humansAlive = false;
    for (const [, p] of this.players) {
      if (p.isNPC) continue;
      if (p.actor.getSnapshot().matches("alive")) {
        humansAlive = true;
        break;
      }
    }
    if (!humansAlive) {
      this.endRound();
    }
  }

  private endRound(): void {
    this.players.clear();
    this.asteroids.clear();
    this.bullets.clear();
    this.powerUps.clear();
    nextAsteroidId = 1;
    nextBulletId = 1;
    nextPowerUpId = 1;

    this.gameActor.send({ type: "ROUND_OVER" });

    this.broadcast(JSON.stringify({ type: "roundOver" }));
  }

  private tick(): void {
    const dt = 1 / 30;

    if (!this.gameActor.getSnapshot().matches("playing")) return;

    // ── Player movement ──
    for (const [id, p] of this.players) {
      // Phase 3.1: Cache snapshot to avoid multiple getSnapshot() calls
      const snapshot = p.actor.getSnapshot();
      if (!snapshot.matches("alive")) continue;

      if (p.isNPC) {
        const influences: BoidInfluence[] = [];

        for (const [oid, o] of this.players) {
          if (oid === id) continue;
          const oSnapshot = o.actor.getSnapshot();
          if (!oSnapshot.matches("alive")) continue;
          
          const distSq = vLenSq(vSub(p.pos, o.pos));
          if (distSq < 60 * 60) {
            influences.push({ pos: o.pos, repel: true, range: 60, strength: 1 });
          }
        }

        for (const [, o] of this.players) {
          if (o.isNPC) continue;
          const oSnapshot = o.actor.getSnapshot();
          if (!oSnapshot.matches("alive")) continue;
          
          const distSq = vLenSq(vSub(p.pos, o.pos));
          if (distSq < 200 * 200) {
            if (distSq < 40 * 40) {
              influences.push({ pos: o.pos, repel: true, range: 40, strength: 2 });
            } else {
              influences.push({ pos: o.pos, repel: false, range: 200, strength: 1.5 });
            }
          }
        }

        for (const [, b] of this.bullets) {
          const distSq = vLenSq(vSub(p.pos, b.pos));
          if (distSq < 60 * 60) {
            influences.push({ pos: b.pos, repel: true, range: 60, strength: 3 });
          }
        }

        for (const [, a] of this.asteroids) {
          const distSq = vLenSq(vSub(p.pos, a.pos));
          if (distSq < 40 * 40) {
            influences.push({ pos: a.pos, repel: true, range: 40, strength: 2 });
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
        p.vel = vScale(p.vel, Math.pow(1 - BRAKE_DECEL, dt * 30));
      }

      p.vel = vScale(p.vel, 1 - FRICTION * dt);

      const speed = vLen(p.vel);
      if (speed > MAX_SPEED) {
        p.vel = vScale(p.vel, MAX_SPEED / speed);
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
        const distSq = vLenSq(vSub(p.pos, pu.pos));
        if (distSq < POWERUP_RADIUS * POWERUP_RADIUS) {
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
    for (const [, b] of this.bullets) {
      const speed = vLen(b.vel);
      const moved = sphereAdvance(b.pos, b.vel, dt);
      b.pos = moved.pos;
      const newSpeed = vLen(moved.vel);
      if (newSpeed > 0.001) {
        b.vel = vScale(moved.vel, speed / newSpeed);
      } else {
        b.vel = moved.vel;
      }
      b.life -= dt;
    }

    // ── Asteroids ──
    for (const [, a] of this.asteroids) {
      const moved = sphereAdvance(a.pos, a.vel, dt);
      a.pos = moved.pos;
      a.vel = moved.vel;
    }

    // ── Bullet-asteroid collisions ──
    const deadBullets = new Set<string>();
    const hitAsteroids: Map<string, string[]> = new Map();

    for (const [bid, b] of this.bullets) {
      if (b.life <= 0) {
        deadBullets.add(bid);
        continue;
      }

      for (const [aid, a] of this.asteroids) {
        const distSq = vLenSq(vSub(b.pos, a.pos));
        const radiusSq = ASTEROID_RADII[a.size] * ASTEROID_RADII[a.size];
        if (distSq < radiusSq) {
          deadBullets.add(bid);
          const list = hitAsteroids.get(aid) ?? [];
          list.push(b.ownerId);
          hitAsteroids.set(aid, list);
          break;
        }
      }
    }

    // ── Bullet-player collisions ──
    for (const [bid, b] of this.bullets) {
      if (deadBullets.has(bid)) continue;
      if (b.life <= 0) continue;

      for (const [pid, p] of this.players) {
        // Phase 3.1: Cache snapshot
        const pSnapshot = p.actor.getSnapshot();
        if (!pSnapshot.matches("alive")) continue;
        if (b.ownerId === pid) continue;
        const distSq = vLenSq(vSub(b.pos, p.pos));
        if (distSq < 15 * 15) {
          deadBullets.add(bid);
          p.actor.send({ type: "HIT" });
          const livesLeft = pSnapshot.context.lives - 1; // Already decremented by HIT action
          if (livesLeft === 0) p.actor.send({ type: "GAME_OVER" });
          this.broadcast(JSON.stringify({ type: "playerKilled", id: pid, lives: livesLeft }));
          // Check new snapshot after sending events
          const newSnapshot = p.actor.getSnapshot();
          if (newSnapshot.matches("gameOver")) {
            if (p.isNPC) setTimeout(() => this.respawnPlayer(pid, true), GAME_OVER_RESPAWN_DELAY * 1000);
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
      // Phase 3.1: Cache snapshot
      const pSnapshot = p.actor.getSnapshot();
      if (!pSnapshot.matches("alive")) continue;

      for (const [, a] of this.asteroids) {
        const distSq = vLenSq(vSub(p.pos, a.pos));
        const radiusSq = PLAYER_RADII[a.size] * PLAYER_RADII[a.size];
        if (distSq < radiusSq) {
          p.actor.send({ type: "HIT" });
          const livesLeft = pSnapshot.context.lives - 1; // Already decremented
          if (livesLeft === 0) p.actor.send({ type: "GAME_OVER" });
          this.broadcast(JSON.stringify({ type: "playerKilled", id: pid, lives: livesLeft }));

          // Check new snapshot after sending events
          const newSnapshot = p.actor.getSnapshot();
          if (newSnapshot.matches("gameOver")) {
            if (p.isNPC) setTimeout(() => this.respawnPlayer(pid, true), GAME_OVER_RESPAWN_DELAY * 1000);
          } else {
            setTimeout(() => this.respawnPlayer(pid, false), RESPAWN_DELAY * 1000);
          }
          break;
        }
      }
    }

    // ── Shooting ──
    for (const [id, p] of this.players) {
      // Phase 3.1: Cache snapshot
      const snapshot = p.actor.getSnapshot();
      if (!snapshot.matches("alive")) continue;

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
        }
        p.shootCooldown = SHOOT_COOLDOWN;
      }
      if (p.shootCooldown > 0) p.shootCooldown -= dt;
    }

    if (this.asteroids.size === 0) {
      this.spawnAsteroids(6);
    }

    // ── Broadcast batched game state update ──
    // Collect state AFTER all deletions to ensure only existing entities are sent
    const updates: {
      type: "gameState";
      players: Array<{ id: string; x: number; y: number; z: number; fx: number; fy: number; fz: number; invisible?: boolean }>;
      bullets: Array<{ id: string; x: number; y: number; z: number }>;
      asteroids: Array<{ id: string; x: number; y: number; z: number; size: number }>;
    } = {
      type: "gameState",
      players: [],
      bullets: [],
      asteroids: [],
    };

    // Collect current player states
    for (const [id, p] of this.players) {
      // Phase 3.1: Cache snapshot
      const snapshot = p.actor.getSnapshot();
      if (!snapshot.matches("alive")) continue;
      updates.players.push({
        id,
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z,
        fx: p.forward.x,
        fy: p.forward.y,
        fz: p.forward.z,
        invisible: p.invisibilityTimer > 0 ? true : undefined,
      });
    }

    // Collect current bullet states (after deletions)
    for (const [id, b] of this.bullets) {
      updates.bullets.push({
        id,
        x: b.pos.x,
        y: b.pos.y,
        z: b.pos.z,
      });
    }

    // Collect current asteroid states (after deletions)
    for (const [id, a] of this.asteroids) {
      updates.asteroids.push({
        id,
        x: a.pos.x,
        y: a.pos.y,
        z: a.pos.z,
        size: a.size,
      });
    }

    this.broadcast(JSON.stringify(updates));

    // ── Check round over ──
    this.checkRoundOver();
  }
}