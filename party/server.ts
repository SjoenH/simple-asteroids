import type * as Party from "partykit/server";

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

export default class GameServer implements Party.Server {
  private players = new Map<string, PlayerState>();
  private asteroids = new Map<string, AsteroidState>();
  private bullets = new Map<string, BulletState>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {}

  async onStart(): Promise<void> {
    this.spawnAsteroids(6);
    this.tickInterval = setInterval(() => this.tick(), 1000 / 30);
  }

  async onConnect(connection: Party.Connection): Promise<void> {
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

    this.room.broadcast(
      JSON.stringify({
        type: "playerJoined",
        id: connection.id,
      }),
    );
  }

  async onMessage(message: string | ArrayBuffer, sender: Party.Connection): Promise<void> {
    if (typeof message !== "string") return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const player = this.players.get(sender.id);
    if (!player) return;

    switch (data.type) {
      case "setName":
        player.name = String(data.name ?? "Unknown");
        break;
      case "playerInput":
        player.thrust = Boolean(data.thrust);
        player.rotateLeft = Boolean(data.rotateLeft);
        player.rotateRight = Boolean(data.rotateRight);
        player.shoot = Boolean(data.shoot);
        break;
    }
  }

  async onClose(connection: Party.Connection): Promise<void> {
    this.players.delete(connection.id);
    this.room.broadcast(JSON.stringify({ type: "playerLeft", id: connection.id }));
  }

  private spawnAsteroids(count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const id = `ast_${nextAsteroidId++}`;
      this.asteroids.set(id, {
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        vx: Math.cos(angle) * ASTEROID_SPEED * (0.5 + Math.random()),
        vy: Math.sin(angle) * ASTEROID_SPEED * (0.5 + Math.random()),
        size: 1,
      });
      this.room.broadcast(
        JSON.stringify({
          type: "asteroidMoved",
          id,
          x: this.asteroids.get(id)!.x,
          y: this.asteroids.get(id)!.y,
        }),
      );
    }
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

      this.room.broadcast(
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

      this.room.broadcast(
        JSON.stringify({ type: "bulletMoved", id, x: b.x, y: b.y, rotation: Math.atan2(b.vy, b.vx) }),
      );
    }

    for (const [id, a] of this.asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.x = wrap(a.x, WORLD_W);
      a.y = wrap(a.y, WORLD_H);

      this.room.broadcast(
        JSON.stringify({ type: "asteroidMoved", id, x: a.x, y: a.y }),
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
        if (Math.sqrt(dx * dx + dy * dy) < 40) {
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
      this.room.broadcast(JSON.stringify({ type: "bulletRemoved", id: bid }));
    }

    for (const [aid, ownerIds] of hitAsteroids) {
      const a = this.asteroids.get(aid);
      if (!a) continue;

      this.asteroids.delete(aid);
      this.room.broadcast(JSON.stringify({ type: "asteroidRemoved", id: aid }));

      for (const ownerId of ownerIds) {
        const p = this.players.get(ownerId);
        if (p) {
          p.score += 100;
          this.room.broadcast(
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
        if (Math.sqrt(dx * dx + dy * dy) < 35) {
          p.alive = false;
          this.room.broadcast(JSON.stringify({ type: "playerKilled", id: pid }));

          setTimeout(() => {
            const player = this.players.get(pid);
            if (!player) return;
            player.x = WORLD_W / 2 + (Math.random() - 0.5) * 200;
            player.y = WORLD_H / 2 + (Math.random() - 0.5) * 200;
            player.vx = 0;
            player.vy = 0;
            player.alive = true;
            this.room.broadcast(
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
        this.room.broadcast(
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
