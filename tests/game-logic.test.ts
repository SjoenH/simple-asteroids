import { describe, it, expect, vi } from "vitest";
import {
  npcAI, type NpcInput, BoidInfluence,
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

  it("steers left away from ship on the right", () => {
    const n = makeNpc();
    const pos: Vec3 = { x: 0, y: 0, z: 1000 };
    const fwd: Vec3 = { x: 0, y: 1, z: 0 };
    const nearby: BoidInfluence[] = [{ pos: { x: 30, y: 0, z: 1000 }, repel: true, range: 60, strength: 1 }];
    npcAI(n, 1 / 30, nearby, pos, fwd);
    expect(n.rotateLeft).toBe(true);
    expect(n.rotateRight).toBe(false);
  });

  it("steers right away from ship on the left", () => {
    const n = makeNpc();
    const pos: Vec3 = { x: 0, y: 0, z: 1000 };
    const fwd: Vec3 = { x: 0, y: 1, z: 0 };
    const nearby: BoidInfluence[] = [{ pos: { x: -30, y: 0, z: 1000 }, repel: true, range: 60, strength: 1 }];
    npcAI(n, 1 / 30, nearby, pos, fwd);
    expect(n.rotateRight).toBe(true);
    expect(n.rotateLeft).toBe(false);
  });

  it("does not rotate when no influences", () => {
    const n = makeNpc();
    npcAI(n, 1 / 30, [], ZERO, UP);
    expect(n.rotateLeft).toBe(false);
    expect(n.rotateRight).toBe(false);
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

import { setup, assign, interpret } from "xstate";

const testPlayerMachine = setup({
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

describe("playerMachine transitions", () => {
  it("starts alive with INITIAL_LIVES", () => {
    const actor = interpret(testPlayerMachine).start();
    expect(actor.getSnapshot().matches("alive")).toBe(true);
    expect(actor.getSnapshot().context.lives).toBe(INITIAL_LIVES);
  });

  it("HIT transitions to dead and decrements lives", () => {
    const actor = interpret(testPlayerMachine).start();
    actor.send({ type: "HIT" });
    expect(actor.getSnapshot().matches("dead")).toBe(true);
    expect(actor.getSnapshot().context.lives).toBe(INITIAL_LIVES - 1);
  });

  it("RESPAWN returns to alive when lives > 0", () => {
    const actor = interpret(testPlayerMachine).start();
    actor.send({ type: "HIT" });
    actor.send({ type: "RESPAWN" });
    expect(actor.getSnapshot().matches("alive")).toBe(true);
  });

  it("HIT at 1 life then GAME_OVER transitions to gameOver", () => {
    const actor = interpret(testPlayerMachine).start();
    // Burn through lives by hitting then respawning
    for (let i = 1; i < INITIAL_LIVES; i++) {
      actor.send({ type: "HIT" });
      expect(actor.getSnapshot().matches("dead")).toBe(true);
      actor.send({ type: "RESPAWN" });
      expect(actor.getSnapshot().matches("alive")).toBe(true);
    }
    // Last life
    actor.send({ type: "HIT" });
    expect(actor.getSnapshot().matches("dead")).toBe(true);
    expect(actor.getSnapshot().context.lives).toBe(0);
    actor.send({ type: "GAME_OVER" });
    expect(actor.getSnapshot().matches("gameOver")).toBe(true);
  });

  it("RESTART from gameOver resets lives and returns to alive", () => {
    const actor = interpret(testPlayerMachine).start();
    // reach gameOver
    for (let i = 0; i < INITIAL_LIVES; i++) {
      actor.send({ type: "HIT" });
    }
    actor.send({ type: "GAME_OVER" });
    expect(actor.getSnapshot().matches("gameOver")).toBe(true);

    actor.send({ type: "RESTART" });
    expect(actor.getSnapshot().matches("alive")).toBe(true);
    expect(actor.getSnapshot().context.lives).toBe(INITIAL_LIVES);
  });

  it("SURRENDER from alive goes directly to gameOver", () => {
    const actor = interpret(testPlayerMachine).start();
    actor.send({ type: "SURRENDER" });
    expect(actor.getSnapshot().matches("gameOver")).toBe(true);
  });

  it("COLLECT_LIFE increments lives up to 5", () => {
    const actor = interpret(testPlayerMachine).start();
    actor.send({ type: "COLLECT_LIFE" });
    expect(actor.getSnapshot().context.lives).toBe(INITIAL_LIVES + 1);
  });

  it("COLLECT_LIFE caps at 5", () => {
    const actor = interpret(testPlayerMachine).start();
    for (let i = 0; i < 5; i++) {
      actor.send({ type: "COLLECT_LIFE" });
    }
    expect(actor.getSnapshot().context.lives).toBe(5);
  });
});

const testGameMachine = setup({
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

describe("gameMachine transitions", () => {
  it("starts in lobby", () => {
    const actor = interpret(testGameMachine).start();
    expect(actor.getSnapshot().matches("lobby")).toBe(true);
  });

  it("START transitions to playing", () => {
    const actor = interpret(testGameMachine).start();
    actor.send({ type: "START" });
    expect(actor.getSnapshot().matches("playing")).toBe(true);
  });

  it("ROUND_OVER returns to lobby", () => {
    const actor = interpret(testGameMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "ROUND_OVER" });
    expect(actor.getSnapshot().matches("lobby")).toBe(true);
  });
});
