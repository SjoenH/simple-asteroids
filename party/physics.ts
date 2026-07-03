export interface Vec3 { x: number; y: number; z: number; }

export const RADIUS = 1000;
export const ROTATION_SPEED = 3;
export const PLAYER_ACCEL = 300;
export const FRICTION = 0.015;
export const BRAKE_DECEL = 0.08;
export const MAX_SPEED = 400;
export const BULLET_SPEED = 400;
export const BULLET_LIFE = 2;
export const SHOOT_COOLDOWN = 0.25;
export const ASTEROID_SPEED = 60;
export const ASTEROID_RADII: Record<number, number> = { 1: 40, 2: 26, 3: 14 };
export const PLAYER_RADII: Record<number, number> = { 1: 35, 2: 24, 3: 14 };
export const ASTEROID_SCORES: Record<number, number> = { 1: 20, 2: 50, 3: 100 };

export const INITIAL_LIVES = 3;
export const RESPAWN_DELAY = 3;
export const GAME_OVER_RESPAWN_DELAY = 5;
export const POWERUP_SPAWN_INTERVAL = 6;
export const MAX_POWERUPS = 6;
export const POWERUP_LIFETIME = 20;
export const POWERUP_RADIUS = 60;
export const PLAYER_KILL_SCORE = 10;
export const INVISIBILITY_DURATION = 5;
export const MULTI_CANNON_DURATION = 8;
export const MULTI_CANNON_SPREAD = 0.12;

export const NPC_COUNT = 3;
export const NPC_NAMES = ['Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta', 'Bot Epsilon'];

export type PowerUpType = 'extraLife' | 'invisibility' | 'multiCannon';
export const POWERUP_TYPES: PowerUpType[] = ['extraLife', 'invisibility', 'multiCannon'];

export function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vScale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vCross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function vLen(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vNorm(v: Vec3): Vec3 {
  const l = vLen(v);
  return l === 0 ? { x: 0, y: 0, z: 1 } : vScale(v, 1 / l);
}

export function tangentOf(v: Vec3, n: Vec3): Vec3 {
  const u = vNorm(n);
  return vSub(v, vScale(u, vDot(v, u)));
}

export function randomPos(): Vec3 {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return {
    x: RADIUS * Math.sin(phi) * Math.cos(theta),
    y: RADIUS * Math.sin(phi) * Math.sin(theta),
    z: RADIUS * Math.cos(phi),
  };
}

export function sphereAdvance(pos: Vec3, vel: Vec3, dt: number): { pos: Vec3; vel: Vec3 } {
  const newPos = vScale(vNorm(vAdd(pos, vScale(vel, dt))), RADIUS);
  const newVel = tangentOf(vel, newPos);
  return { pos: newPos, vel: newVel };
}

export function rotateForward(fwd: Vec3, pos: Vec3, angle: number): Vec3 {
  const n = vNorm(pos);
  const right = vNorm(vCross(fwd, n));
  return vNorm(vAdd(vScale(fwd, Math.cos(angle)), vScale(right, Math.sin(angle))));
}

export function initialTangent(pos: Vec3): Vec3 {
  const n = vNorm(pos);
  const t = tangentOf({ x: 0, y: 0, z: 1 }, n);
  return vLen(t) > 0.001 ? vNorm(t) : vNorm(tangentOf({ x: 1, y: 0, z: 0 }, n));
}

export interface NpcInput {
  aiRotateDir: number;
  aiSwitchTimer: number;
  rotateLeft: boolean;
  rotateRight: boolean;
  thrust: boolean;
  brake: boolean;
  shoot: boolean;
}

export function npcAI(input: NpcInput, dt: number): void {
  input.aiSwitchTimer -= dt;
  if (input.aiSwitchTimer <= 0) {
    const r = Math.random();
    input.aiRotateDir = r < 0.4 ? -1 : r < 0.7 ? 1 : 0;
    input.aiSwitchTimer = 1 + Math.random() * 3;
  }
  input.rotateLeft = input.aiRotateDir === -1;
  input.rotateRight = input.aiRotateDir === 1;
  input.thrust = true;
  input.brake = false;
  input.shoot = true;
}
