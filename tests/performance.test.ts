import { describe, it, expect } from "vitest";
import {
  vAdd, vSub, vScale, vLen, vLenSq, vNorm, tangentOf, sphereAdvance, rotateForward,
  RADIUS, type Vec3,
} from "../party/physics";

/**
 * Performance Baseline Tests
 * 
 * These tests measure performance of critical hot-path operations
 * to establish a baseline before optimizations.
 * 
 * Run with: npm test -- performance.test.ts
 */

describe("Performance Baseline - Vector Operations", () => {
  const iterations = 100000;

  it(`vLen performance (${iterations.toLocaleString()} iterations)`, () => {
    const vectors = Array.from({ length: 100 }, () => ({
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      z: Math.random() * 1000,
    }));

    const start = performance.now();
    let sum = 0;
    for (let i = 0; i < iterations; i++) {
      const v = vectors[i % 100];
      sum += vLen(v);
    }
    const duration = performance.now() - start;

    console.log(`  vLen: ${duration.toFixed(2)}ms for ${iterations.toLocaleString()} calls`);
    console.log(`  Average: ${(duration / iterations * 1000000).toFixed(3)} ns/call`);
    console.log(`  Ops/sec: ${(iterations / (duration / 1000)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    
    expect(sum).toBeGreaterThan(0); // Prevent optimization
    expect(duration).toBeLessThan(5000); // Should complete in reasonable time
  });

  it(`vLenSq performance (${iterations.toLocaleString()} iterations) [NEW OPTIMIZATION]`, () => {
    const vectors = Array.from({ length: 100 }, () => ({
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      z: Math.random() * 1000,
    }));

    const start = performance.now();
    let sum = 0;
    for (let i = 0; i < iterations; i++) {
      const v = vectors[i % 100];
      sum += vLenSq(v);
    }
    const duration = performance.now() - start;

    console.log(`  vLenSq: ${duration.toFixed(2)}ms for ${iterations.toLocaleString()} calls`);
    console.log(`  Average: ${(duration / iterations * 1000000).toFixed(3)} ns/call`);
    console.log(`  Ops/sec: ${(iterations / (duration / 1000)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    
    expect(sum).toBeGreaterThan(0); // Prevent optimization
    expect(duration).toBeLessThan(5000); // Should complete in reasonable time
  });

  it(`vNorm performance (${iterations.toLocaleString()} iterations)`, () => {
    const vectors = Array.from({ length: 100 }, () => ({
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      z: Math.random() * 1000,
    }));

    const start = performance.now();
    let result: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < iterations; i++) {
      const v = vectors[i % 100];
      result = vNorm(v);
    }
    const duration = performance.now() - start;

    console.log(`  vNorm: ${duration.toFixed(2)}ms for ${iterations.toLocaleString()} calls`);
    console.log(`  Average: ${(duration / iterations * 1000000).toFixed(3)} ns/call`);
    console.log(`  Ops/sec: ${(iterations / (duration / 1000)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    
    expect(result).toBeDefined();
    expect(duration).toBeLessThan(5000);
  });

  it(`Distance check simulation (collision detection pattern)`, () => {
    // Simulate collision detection: checking if two objects are within range
    const positions1 = Array.from({ length: 20 }, () => ({
      x: Math.random() * 2000 - 1000,
      y: Math.random() * 2000 - 1000,
      z: Math.random() * 2000 - 1000,
    }));
    
    const positions2 = Array.from({ length: 20 }, () => ({
      x: Math.random() * 2000 - 1000,
      y: Math.random() * 2000 - 1000,
      z: Math.random() * 2000 - 1000,
    }));

    const checks = 10000;
    const collisionRadius = 50;
    
    const start = performance.now();
    let collisionCount = 0;
    
    for (let iter = 0; iter < checks; iter++) {
      // O(n²) collision detection
      for (let i = 0; i < positions1.length; i++) {
        for (let j = 0; j < positions2.length; j++) {
          const diff = vSub(positions1[i], positions2[j]);
          const distance = vLen(diff); // Using sqrt - expensive!
          if (distance < collisionRadius) {
            collisionCount++;
          }
        }
      }
    }
    
    const duration = performance.now() - start;
    const totalChecks = checks * positions1.length * positions2.length;

    console.log(`  Collision checks (OLD): ${duration.toFixed(2)}ms for ${totalChecks.toLocaleString()} checks`);
    console.log(`  Average: ${(duration / totalChecks * 1000000).toFixed(3)} ns/check`);
    console.log(`  Checks/sec: ${(totalChecks / (duration / 1000)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`  Collisions found: ${collisionCount}`);
    
    expect(duration).toBeGreaterThan(0);
  });

  it(`Distance check with vLenSq (OPTIMIZED collision detection)`, () => {
    // Same simulation but using vLenSq instead of vLen
    const positions1 = Array.from({ length: 20 }, () => ({
      x: Math.random() * 2000 - 1000,
      y: Math.random() * 2000 - 1000,
      z: Math.random() * 2000 - 1000,
    }));
    
    const positions2 = Array.from({ length: 20 }, () => ({
      x: Math.random() * 2000 - 1000,
      y: Math.random() * 2000 - 1000,
      z: Math.random() * 2000 - 1000,
    }));

    const checks = 10000;
    const collisionRadius = 50;
    const collisionRadiusSq = collisionRadius * collisionRadius;
    
    const start = performance.now();
    let collisionCount = 0;
    
    for (let iter = 0; iter < checks; iter++) {
      // O(n²) collision detection with vLenSq - no sqrt!
      for (let i = 0; i < positions1.length; i++) {
        for (let j = 0; j < positions2.length; j++) {
          const diff = vSub(positions1[i], positions2[j]);
          const distanceSq = vLenSq(diff); // No sqrt!
          if (distanceSq < collisionRadiusSq) {
            collisionCount++;
          }
        }
      }
    }
    
    const duration = performance.now() - start;
    const totalChecks = checks * positions1.length * positions2.length;

    console.log(`  Collision checks (NEW): ${duration.toFixed(2)}ms for ${totalChecks.toLocaleString()} checks`);
    console.log(`  Average: ${(duration / totalChecks * 1000000).toFixed(3)} ns/check`);
    console.log(`  Checks/sec: ${(totalChecks / (duration / 1000)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`  Collisions found: ${collisionCount}`);
    
    expect(duration).toBeGreaterThan(0);
  });
});

describe("Performance Baseline - Physics Operations", () => {
  const iterations = 10000;

  it(`sphereAdvance performance (${iterations.toLocaleString()} iterations)`, () => {
    const positions = Array.from({ length: 100 }, () => ({
      x: Math.random() * RADIUS * 2 - RADIUS,
      y: Math.random() * RADIUS * 2 - RADIUS,
      z: Math.random() * RADIUS * 2 - RADIUS,
    }));
    
    const velocities = Array.from({ length: 100 }, () => ({
      x: Math.random() * 200 - 100,
      y: Math.random() * 200 - 100,
      z: Math.random() * 200 - 100,
    }));

    const start = performance.now();
    let result: { pos: Vec3; vel: Vec3 } = { 
      pos: { x: 0, y: 0, z: 0 }, 
      vel: { x: 0, y: 0, z: 0 } 
    };
    
    for (let i = 0; i < iterations; i++) {
      const pos = positions[i % 100];
      const vel = velocities[i % 100];
      result = sphereAdvance(pos, vel, 1/30); // 30 ticks/sec
    }
    
    const duration = performance.now() - start;

    console.log(`  sphereAdvance: ${duration.toFixed(2)}ms for ${iterations.toLocaleString()} calls`);
    console.log(`  Average: ${(duration / iterations * 1000000).toFixed(3)} ns/call`);
    console.log(`  Ops/sec: ${(iterations / (duration / 1000)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    
    expect(result).toBeDefined();
    expect(duration).toBeLessThan(5000);
  });

  it(`rotateForward performance (${iterations.toLocaleString()} iterations)`, () => {
    const positions = Array.from({ length: 100 }, () => {
      const p = {
        x: Math.random() * RADIUS * 2 - RADIUS,
        y: Math.random() * RADIUS * 2 - RADIUS,
        z: Math.random() * RADIUS * 2 - RADIUS,
      };
      return vScale(vNorm(p), RADIUS);
    });
    
    const forwards = Array.from({ length: 100 }, () => {
      const f = {
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 2 - 1,
      };
      return vNorm(f);
    });

    const start = performance.now();
    let result: Vec3 = { x: 0, y: 0, z: 0 };
    
    for (let i = 0; i < iterations; i++) {
      const pos = positions[i % 100];
      const fwd = forwards[i % 100];
      result = rotateForward(fwd, pos, 0.1); // Rotation input
    }
    
    const duration = performance.now() - start;

    console.log(`  rotateForward: ${duration.toFixed(2)}ms for ${iterations.toLocaleString()} calls`);
    console.log(`  Average: ${(duration / iterations * 1000000).toFixed(3)} ns/call`);
    console.log(`  Ops/sec: ${(iterations / (duration / 1000)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    
    expect(result).toBeDefined();
    expect(duration).toBeLessThan(5000);
  });

  it(`tangentOf performance (${iterations.toLocaleString()} iterations)`, () => {
    const vectors = Array.from({ length: 100 }, () => ({
      x: Math.random() * 200 - 100,
      y: Math.random() * 200 - 100,
      z: Math.random() * 200 - 100,
    }));
    
    const normals = Array.from({ length: 100 }, () => {
      const n = {
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 2 - 1,
      };
      return vNorm(n);
    });

    const start = performance.now();
    let result: Vec3 = { x: 0, y: 0, z: 0 };
    
    for (let i = 0; i < iterations; i++) {
      const v = vectors[i % 100];
      const n = normals[i % 100];
      result = tangentOf(v, n);
    }
    
    const duration = performance.now() - start;

    console.log(`  tangentOf: ${duration.toFixed(2)}ms for ${iterations.toLocaleString()} calls`);
    console.log(`  Average: ${(duration / iterations * 1000000).toFixed(3)} ns/call`);
    console.log(`  Ops/sec: ${(iterations / (duration / 1000)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    
    expect(result).toBeDefined();
    expect(duration).toBeLessThan(5000);
  });
});

describe("Performance Baseline - Game Simulation", () => {
  it("Simulated game tick with 4 players + 6 asteroids + 10 bullets", () => {
    // Simulate a realistic game state
    const players = Array.from({ length: 4 }, (_, i) => ({
      id: `player${i}`,
      pos: vScale(vNorm({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 2 - 1,
      }), RADIUS),
      vel: {
        x: Math.random() * 100 - 50,
        y: Math.random() * 100 - 50,
        z: Math.random() * 100 - 50,
      },
      forward: vNorm({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 2 - 1,
      }),
    }));

    const asteroids = Array.from({ length: 6 }, (_, i) => ({
      id: `asteroid${i}`,
      pos: vScale(vNorm({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 2 - 1,
      }), RADIUS),
      vel: {
        x: Math.random() * 60 - 30,
        y: Math.random() * 60 - 30,
        z: Math.random() * 60 - 30,
      },
      size: Math.floor(Math.random() * 3) as 0 | 1 | 2,
    }));

    const bullets = Array.from({ length: 10 }, (_, i) => ({
      id: `bullet${i}`,
      pos: vScale(vNorm({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 2 - 1,
      }), RADIUS),
      vel: {
        x: Math.random() * 400 - 200,
        y: Math.random() * 400 - 200,
        z: Math.random() * 400 - 200,
      },
    }));

    const ASTEROID_RADII = [40, 25, 15];
    const PLAYER_RADIUS = 15;
    const dt = 1 / 30; // 30 ticks per second
    const ticks = 1000; // Simulate 1000 ticks

    const start = performance.now();

    for (let tick = 0; tick < ticks; tick++) {
      // Update player positions
      for (const p of players) {
        const advanced = sphereAdvance(p.pos, p.vel, dt);
        p.pos = advanced.pos;
        p.vel = advanced.vel;
      }

      // Update asteroid positions
      for (const a of asteroids) {
        const advanced = sphereAdvance(a.pos, a.vel, dt);
        a.pos = advanced.pos;
        a.vel = advanced.vel;
      }

      // Update bullet positions
      for (const b of bullets) {
        const advanced = sphereAdvance(b.pos, b.vel, dt);
        b.pos = advanced.pos;
        b.vel = advanced.vel;
      }

      // Collision detection: bullets vs asteroids
      let bulletAsteroidChecks = 0;
      for (const b of bullets) {
        for (const a of asteroids) {
          bulletAsteroidChecks++;
          const distSq = vLenSq(vSub(b.pos, a.pos));
          const radiusSq = ASTEROID_RADII[a.size] * ASTEROID_RADII[a.size];
          if (distSq < radiusSq) {
            // Collision (but don't actually remove for benchmark consistency)
          }
        }
      }

      // Collision detection: bullets vs players
      let bulletPlayerChecks = 0;
      for (const b of bullets) {
        for (const p of players) {
          bulletPlayerChecks++;
          const distSq = vLenSq(vSub(b.pos, p.pos));
          if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
            // Collision
          }
        }
      }

      // Collision detection: players vs asteroids
      let playerAsteroidChecks = 0;
      for (const p of players) {
        for (const a of asteroids) {
          playerAsteroidChecks++;
          const distSq = vLenSq(vSub(p.pos, a.pos));
          const radiusSq = (PLAYER_RADIUS + ASTEROID_RADII[a.size]) * (PLAYER_RADIUS + ASTEROID_RADII[a.size]);
          if (distSq < radiusSq) {
            // Collision
          }
        }
      }

      // NPC AI simulation (2 of 4 players are NPCs)
      for (let i = 0; i < 2; i++) {
        const npc = players[i];
        
        // Check against all other players (for avoidance)
        for (const other of players) {
          if (other === npc) continue;
          const distSq = vLenSq(vSub(npc.pos, other.pos));
          if (distSq < 60 * 60) {
            // Influence calculation
            const diff = vSub(npc.pos, other.pos);
            const tangent = tangentOf(diff, npc.pos);
            // Simplified boids logic
          }
        }

        // Check against bullets (for avoidance)
        for (const b of bullets) {
          const distSq = vLenSq(vSub(npc.pos, b.pos));
          if (distSq < 60 * 60) {
            // Avoidance
          }
        }

        // Check against asteroids (for targeting/avoidance)
        for (const a of asteroids) {
          const distSq = vLenSq(vSub(npc.pos, a.pos));
          if (distSq < 200 * 200) {
            // Targeting or avoidance
          }
        }
      }
    }

    const duration = performance.now() - start;
    const ticksPerSecond = ticks / (duration / 1000);
    const msPerTick = duration / ticks;

    console.log(`  Game simulation: ${duration.toFixed(2)}ms for ${ticks} ticks`);
    console.log(`  Entities: ${players.length} players, ${asteroids.length} asteroids, ${bullets.length} bullets`);
    console.log(`  Avg tick time: ${msPerTick.toFixed(3)}ms`);
    console.log(`  Ticks/sec: ${ticksPerSecond.toFixed(1)}`);
    console.log(`  Target: 30 ticks/sec = ${(1000/30).toFixed(2)}ms per tick`);
    
    if (msPerTick < (1000/30)) {
      console.log(`  ✓ PASS: Can maintain 30 ticks/sec (${((1000/30) / msPerTick).toFixed(1)}× headroom)`);
    } else {
      console.log(`  ✗ FAIL: Cannot maintain 30 ticks/sec (${(msPerTick / (1000/30)).toFixed(1)}× too slow)`);
    }

    expect(duration).toBeGreaterThan(0);
    // Should be able to process at least 10 ticks per second even with overhead
    expect(ticksPerSecond).toBeGreaterThan(10);
  });
});

describe("Performance Baseline - Array Operations", () => {
  it("Array splice vs swap-and-pop comparison", () => {
    const size = 1000;
    const removals = 500;

    // Test splice (current implementation)
    let arr1 = Array.from({ length: size }, (_, i) => i);
    const startSplice = performance.now();
    for (let i = 0; i < removals; i++) {
      const idx = Math.floor(Math.random() * arr1.length);
      arr1.splice(idx, 1);
    }
    const spliceDuration = performance.now() - startSplice;

    // Test swap-and-pop (optimized)
    let arr2 = Array.from({ length: size }, (_, i) => i);
    const startSwap = performance.now();
    for (let i = 0; i < removals; i++) {
      const idx = Math.floor(Math.random() * arr2.length);
      arr2[idx] = arr2[arr2.length - 1];
      arr2.pop();
    }
    const swapDuration = performance.now() - startSwap;

    console.log(`  Array splice: ${spliceDuration.toFixed(2)}ms for ${removals} removals from ${size} items`);
    console.log(`  Swap-and-pop: ${swapDuration.toFixed(2)}ms for ${removals} removals from ${size} items`);
    console.log(`  Speedup: ${(spliceDuration / swapDuration).toFixed(2)}×`);

    expect(swapDuration).toBeLessThan(spliceDuration * 2); // Swap should be faster
  });

  it("Array.includes vs Set.has comparison", () => {
    const size = 100;
    const checks = 10000;
    const items = Array.from({ length: size }, (_, i) => `item${i}`);

    // Test Array.includes (current implementation)
    const arr = items.slice();
    const startIncludes = performance.now();
    let foundCount1 = 0;
    for (let i = 0; i < checks; i++) {
      const item = `item${Math.floor(Math.random() * size)}`;
      if (arr.includes(item)) foundCount1++;
    }
    const includesDuration = performance.now() - startIncludes;

    // Test Set.has (optimized)
    const set = new Set(items);
    const startHas = performance.now();
    let foundCount2 = 0;
    for (let i = 0; i < checks; i++) {
      const item = `item${Math.floor(Math.random() * size)}`;
      if (set.has(item)) foundCount2++;
    }
    const hasDuration = performance.now() - startHas;

    console.log(`  Array.includes: ${includesDuration.toFixed(2)}ms for ${checks.toLocaleString()} checks`);
    console.log(`  Set.has: ${hasDuration.toFixed(2)}ms for ${checks.toLocaleString()} checks`);
    console.log(`  Speedup: ${(includesDuration / hasDuration).toFixed(2)}×`);

    expect(foundCount1).toBe(foundCount2); // Both should find same items
    expect(hasDuration).toBeLessThan(includesDuration); // Set should be faster
  });
});
