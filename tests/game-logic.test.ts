import { describe, it, expect, vi } from "vitest";
import {
  npcAI, type NpcInput,
  vSub, vLen,
  PLAYER_RADII, ASTEROID_RADII,
  PLAYER_KILL_SCORE, INITIAL_LIVES,
  NPC_COUNT, NPC_NAMES,
  type Vec3,
} from "../party/physics";

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const UP: Vec3 = { x: 0, y: 0, z: 1 };

describe("npcAI", () => {
  function makeNpc(): NpcInput {
    return {
      aiRotateDir: 0,
      aiSwitchTimer: 2,
      aiThrustTimer: 2,
      rotateLeft: false,
      rotateRight: false,
      thrust: false,
      brake: false,
      shoot: false,
    };
  }

  it("sets shoot to true every tick and brake false", () => {
    const n = makeNpc();
    npcAI(n, 1 / 30, [], ZERO, UP);
    expect(n.shoot).toBe(true);
    expect(n.brake).toBe(false);
  });

  it("decrements aiSwitchTimer when not steering", () => {
    const n = makeNpc();
    n.aiSwitchTimer = 5;
    npcAI(n, 1 / 30, [], ZERO, UP);
    expect(n.aiSwitchTimer).toBeLessThan(5);
    expect(n.aiSwitchTimer).toBeGreaterThan(4.9);
  });

  it("picks new wander rotation when timer expires", () => {
    const n = makeNpc();
    n.aiSwitchTimer = 0.01;
    const rand = vi.spyOn(Math, "random");
    rand.mockReturnValue(0.2);
    npcAI(n, 0.02, [], ZERO, UP);
    expect(n.aiRotateDir).toBe(-1);
    expect(n.rotateLeft).toBe(true);
    expect(n.rotateRight).toBe(false);
    expect(n.aiSwitchTimer).toBeGreaterThan(1);
    rand.mockRestore();
  });

  it("sets rotateRight when wander random >= 0.3 and < 0.6", () => {
    const n = makeNpc();
    n.aiSwitchTimer = 0.01;
    const rand = vi.spyOn(Math, "random");
    rand.mockReturnValue(0.5);
    npcAI(n, 0.02, [], ZERO, UP);
    expect(n.aiRotateDir).toBe(1);
    expect(n.rotateRight).toBe(true);
    expect(n.rotateLeft).toBe(false);
    rand.mockRestore();
  });

  it("steers left away from ship on the right", () => {
    const n = makeNpc();
    const pos: Vec3 = { x: 0, y: 0, z: 1000 };
    const fwd: Vec3 = { x: 0, y: 1, z: 0 };
    const nearby = [{ x: 30, y: 0, z: 1000 }];
    npcAI(n, 1 / 30, nearby, pos, fwd);
    expect(n.rotateLeft).toBe(true);
    expect(n.rotateRight).toBe(false);
  });

  it("steers right away from ship on the left", () => {
    const n = makeNpc();
    const pos: Vec3 = { x: 0, y: 0, z: 1000 };
    const fwd: Vec3 = { x: 0, y: 1, z: 0 };
    const nearby = [{ x: -30, y: 0, z: 1000 }];
    npcAI(n, 1 / 30, nearby, pos, fwd);
    expect(n.rotateRight).toBe(true);
    expect(n.rotateLeft).toBe(false);
  });

  it("does not rotate when no nearby ships and timer not expired", () => {
    const n = makeNpc();
    n.aiRotateDir = 1;
    n.aiSwitchTimer = 5;
    npcAI(n, 1 / 30, [], ZERO, UP);
    expect(n.aiRotateDir).toBe(1);
    expect(n.rotateRight).toBe(true);
  });

  it("toggles thrust to true on burst timer", () => {
    const n = makeNpc();
    n.aiThrustTimer = 0.01;
    n.thrust = false;
    const rand = vi.spyOn(Math, "random");
    rand.mockReturnValue(0.5);
    npcAI(n, 0.02, [], ZERO, UP);
    expect(n.thrust).toBe(true);
    expect(n.aiThrustTimer).toBeGreaterThan(0);
    rand.mockRestore();
  });

  it("toggles thrust to false on burst timer", () => {
    const n = makeNpc();
    n.aiThrustTimer = 0.01;
    n.thrust = true;
    const rand = vi.spyOn(Math, "random");
    rand.mockReturnValue(0.9);
    npcAI(n, 0.02, [], ZERO, UP);
    expect(n.thrust).toBe(false);
    expect(n.aiThrustTimer).toBeGreaterThan(0);
    rand.mockRestore();
  });
});

describe("collision detection", () => {
  it("player collides with size-1 asteroid at 30 units", () => {
    const dist = vLen(vSub({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }));
    expect(dist).toBeLessThan(PLAYER_RADII[1]);
    expect(dist).toBeGreaterThan(PLAYER_RADII[3]);
  });

  it("bullet hits size-1 asteroid at 35 units", () => {
    const dist = vLen(vSub({ x: 0, y: 0, z: 0 }, { x: 35, y: 0, z: 0 }));
    expect(dist).toBeLessThan(ASTEROID_RADII[1]);
    expect(dist).toBeGreaterThan(ASTEROID_RADII[3]);
  });

  it("bullet hits player within 15 units", () => {
    expect(vLen(vSub({ x: 0, y: 0, z: 0 }, { x: 14, y: 0, z: 0 }))).toBeLessThan(15);
  });

  it("bullet does not hit player at 16 units", () => {
    expect(vLen(vSub({ x: 0, y: 0, z: 0 }, { x: 16, y: 0, z: 0 }))).toBeGreaterThanOrEqual(15);
  });

  it("scoring and radius constants", () => {
    expect(PLAYER_KILL_SCORE).toBe(10);
    expect(ASTEROID_RADII[1]).toBe(40);
    expect(PLAYER_RADII[1]).toBe(35);
  });
});

describe("NPC constants", () => {
  it("NPC_COUNT is 3", () => {
    expect(NPC_COUNT).toBe(3);
  });

  it("NPC_NAMES has enough entries", () => {
    expect(NPC_NAMES.length).toBeGreaterThanOrEqual(NPC_COUNT);
  });
});

describe("playerMachine", () => {
  it("starts with INITIAL_LIVES", () => {
    expect(INITIAL_LIVES).toBe(3);
  });
});
