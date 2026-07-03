import { Server, Connection, ConnectionContext } from "partyserver";

const WORLD_W = 800;
const WORLD_H = 600;
const ROTATION_SPEED = 3;
const PLAYER_ACCEL = 300;
const FRICTION = 0.015;
const MAX_SPEED = 400;
const BULLET_SPEED = 400;
const BULLET_LIFE = 2;
const SHOOT_COOLDOWN = 0.25;
const ASTEROID_SPEED = 60;
const ASTEROID_RADII: Record<number, number> = { 1: 40, 2: 26, 3: 14 };
const PLAYER_RADII: Record<number, number> = { 1: 35, 2: 24, 3: 14 };
const ASTEROID_SCORES: Record<number, number> = { 1: 20, 2: 50, 3: 100 };

let nextAsteroidId = 1;
let nextBulletId = 1;

interface PlayerState {
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  score: number;
  alive: boolean;
  thrust: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  shoot: boolean;
  shootCooldown: number;
}

interface AsteroidState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

interface BulletState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ownerId: string;
  life: number;
}

function wrap(v: number, max: number): number {
  return ((v % max) + max) % max;
}

export class GameServer extends Server {
  private players = new Map<string, PlayerState>();
  private asteroids = new Map<string, AsteroidState>();
  private bullets = new Map<string, BulletState>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
  }

  async onStart(): Promise<void> {
    this.spawnAsteroids(6);
    this.tickInterval = setInterval(() => this.tick(), 1000 / 30);
  }

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const player: PlayerState = {
      name: "Unknown",
      x: WORLD_W / 2 + (Math.random() - 0.5) * 200,
      y: WORLD_H / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
      rotation: Math.random() * Math.PI * 2,
      score: 0,
      alive: true,
      thrust: false,
      rotateLeft: false,
      rotateRight: false,
      shoot: false,
      shootCooldown: 0,
    };
    this.players.set(connection.id, player);

    connection.send(JSON.stringify({ type: "connected", id: connection.id }));

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
        player.rotateLeft = Boolean(data.rotateLeft);
        player.rotateRight = Boolean(data.rotateRight);
        player.shoot = Boolean(data.shoot);
        break;
    }
  }

  async onClose(connection: Connection): Promise<void> {
    this.players.delete(connection.id);
    this.broadcast(JSON.stringify({ type: "playerLeft", id: connection.id }));
  }

  private spawnAsteroids(count: number, size = 1): void {
    for (let i = 0; i < count; i++) {
      this.spawnAsteroidAt(
        Math.random() * WORLD_W,
        Math.random() * WORLD_H,
        size,
        Math.random() * Math.PI * 2,
      );
    }
  }

  private spawnAsteroidAt(x: number, y: number, size: number, angle: number): string {
    const id = `ast_${nextAsteroidId++}`;
    const speed = ASTEROID_SPEED * (0.5 + Math.random()) * (4 - size) * 0.5;
    this.asteroids.set(id, { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size });
    this.broadcast(
      JSON.stringify({ type: "asteroidMoved", id, x, y, size }),
    );
    return id;
  }

  private tick(): void {
    const dt = 1 / 30;

    for (const [id, p] of this.players) {
      if (!p.alive) continue;

      if (p.rotateLeft) p.rotation -= ROTATION_SPEED * dt;
      if (p.rotateRight) p.rotation += ROTATION_SPEED * dt;

      if (p.thrust) {
        p.vx += Math.cos(p.rotation) * PLAYER_ACCEL * dt;
        p.vy += Math.sin(p.rotation) * PLAYER_ACCEL * dt;
      }

      p.vx *= 1 - FRICTION * dt;
      p.vy *= 1 - FRICTION * dt;

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (speed > MAX_SPEED) {
        p.vx = (p.vx / speed) * MAX_SPEED;
        p.vy = (p.vy / speed) * MAX_SPEED;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      p.x = wrap(p.x, WORLD_W);
      p.y = wrap(p.y, WORLD_H);

      this.broadcast(
        JSON.stringify({
          type: "playerMoved",
          id,
          x: p.x,
          y: p.y,
          rotation: p.rotation,
        }),
      );
    }

    for (const [id, b] of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.x = wrap(b.x, WORLD_W);
      b.y = wrap(b.y, WORLD_H);
      b.life -= dt;

      this.broadcast(
        JSON.stringify({ type: "bulletMoved", id, x: b.x, y: b.y, rotation: Math.atan2(b.vy, b.vx) }),
      );
    }

    for (const [id, a] of this.asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.x = wrap(a.x, WORLD_W);
      a.y = wrap(a.y, WORLD_H);

      this.broadcast(
        JSON.stringify({ type: "asteroidMoved", id, x: a.x, y: a.y, size: a.size }),
      );
    }

    const deadBullets: string[] = [];
    const hitAsteroids: Map<string, string[]> = new Map();

    for (const [bid, b] of this.bullets) {
      if (b.life <= 0) {
        deadBullets.push(bid);
        continue;
      }

      for (const [aid, a] of this.asteroids) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.sqrt(dx * dx + dy * dy) < ASTEROID_RADII[a.size]) {
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
          const cid = this.spawnAsteroidAt(a.x, a.y, childSize, angle);
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

    for (const [pid, p] of this.players) {
      if (!p.alive) continue;

      for (const [aid, a] of this.asteroids) {
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        if (Math.sqrt(dx * dx + dy * dy) < PLAYER_RADII[a.size]) {
          p.alive = false;
          this.broadcast(JSON.stringify({ type: "playerKilled", id: pid }));

          setTimeout(() => {
            const player = this.players.get(pid);
            if (!player) return;
            player.x = WORLD_W / 2 + (Math.random() - 0.5) * 200;
            player.y = WORLD_H / 2 + (Math.random() - 0.5) * 200;
            player.vx = 0;
            player.vy = 0;
            player.alive = true;
            this.broadcast(
              JSON.stringify({
                type: "playerRespawned",
                id: pid,
                x: player.x,
                y: player.y,
              }),
            );
          }, 3000);
          break;
        }
      }
    }

    for (const [id, p] of this.players) {
      if (!p.alive) continue;

      if (p.shoot && p.shootCooldown <= 0) {
        const bid = `bul_${nextBulletId++}`;
        this.bullets.set(bid, {
          x: p.x,
          y: p.y,
          vx: Math.cos(p.rotation) * BULLET_SPEED,
          vy: Math.sin(p.rotation) * BULLET_SPEED,
          ownerId: id,
          life: BULLET_LIFE,
        });
        p.shootCooldown = SHOOT_COOLDOWN;
        const b = this.bullets.get(bid)!;
        this.broadcast(
          JSON.stringify({ type: "bulletMoved", id: bid, x: b.x, y: b.y, rotation: Math.atan2(b.vy, b.vx) }),
        );
      }
      if (p.shootCooldown > 0) p.shootCooldown -= dt;
    }

    if (this.asteroids.size === 0) {
      this.spawnAsteroids(6);
    }
  }
}
