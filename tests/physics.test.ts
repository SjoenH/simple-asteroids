import { describe, it, expect } from "vitest";
import {
  vAdd, vSub, vScale, vDot, vCross, vLen, vNorm, vLenSq,
  tangentOf, randomPos, randomPosAwayFrom, sphereAdvance, rotateForward, initialTangent,
  RADIUS, type Vec3,
} from "../party/physics";

function approxEq(a: Vec3, b: Vec3, eps = 1e-10): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
}

function closeTo(a: number, b: number, eps = 1e-10): boolean {
  return Math.abs(a - b) < eps;
}

describe("Vec3 arithmetic", () => {
  it("vAdd adds component-wise", () => {
    const r = vAdd({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    expect(r).toEqual({ x: 5, y: 7, z: 9 });
  });

  it("vSub subtracts component-wise", () => {
    const r = vSub({ x: 5, y: 7, z: 9 }, { x: 1, y: 2, z: 3 });
    expect(r).toEqual({ x: 4, y: 5, z: 6 });
  });

  it("vScale multiplies all components", () => {
    const r = vScale({ x: 2, y: 3, z: 4 }, 0.5);
    expect(r).toEqual({ x: 1, y: 1.5, z: 2 });
  });

  it("vDot computes dot product", () => {
    const r = vDot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(r).toBe(0);
  });

  it("vDot of parallel vectors is product of lengths", () => {
    const r = vDot({ x: 3, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    expect(r).toBe(6);
  });

  it("vCross of orthogonal axes", () => {
    const r = vCross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(r).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("vCross is anti-commutative", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: 4, y: 5, z: 6 };
    expect(vCross(a, b)).toEqual(vScale(vCross(b, a), -1));
  });

  it("vLen computes length", () => {
    expect(closeTo(vLen({ x: 3, y: 4, z: 0 }), 5)).toBe(true);
  });

  it("vLen of zero vector is 0", () => {
    expect(vLen({ x: 0, y: 0, z: 0 })).toBe(0);
  });

  it("vNorm returns unit vector", () => {
    const n = vNorm({ x: 0, y: 4, z: 0 });
    expect(n).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("vNorm of non-axis vector is unit", () => {
    const v = { x: 3, y: 4, z: 12 };
    const n = vNorm(v);
    expect(closeTo(vLen(n), 1)).toBe(true);
    expect(approxEq(vScale(n, 13), v)).toBe(true);
  });

  it("vNorm of zero vector defaults to Z", () => {
    expect(vNorm({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe("tangentOf", () => {
  it("removes normal component", () => {
    const v = { x: 2, y: 3, z: 1 };
    const n = { x: 0, y: 0, z: 1 };
    const t = tangentOf(v, n);
    expect(closeTo(vDot(t, n), 0)).toBe(true);
    expect(t).toEqual({ x: 2, y: 3, z: 0 });
  });

  it("returns zero for parallel vector", () => {
    const t = tangentOf({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 1 });
    expect(approxEq(t, { x: 0, y: 0, z: 0 }, 1e-14)).toBe(true);
  });
});

describe("randomPos", () => {
  it("returns a point on the sphere surface", () => {
    for (let i = 0; i < 100; i++) {
      const p = randomPos();
      expect(closeTo(vLen(p), RADIUS, 1e-10)).toBe(true);
    }
  });
});

describe("randomPosAwayFrom", () => {
  it("returns a position at least minDist from all existing", () => {
    const existing: Vec3[] = [
      { x: RADIUS, y: 0, z: 0 },
      { x: -RADIUS, y: 0, z: 0 },
    ];
    for (let i = 0; i < 50; i++) {
      const p = randomPosAwayFrom(existing, 300);
      expect(closeTo(vLen(p), RADIUS, 1e-10)).toBe(true);
      for (const e of existing) {
        expect(vLenSq(vSub(p, e))).toBeGreaterThanOrEqual(300 * 300);
      }
    }
  });

  it("falls back to randomPos when no spot found within maxTries", () => {
    const dense: Vec3[] = [];
    for (let i = 0; i < 5000; i++) dense.push(randomPos());
    const p = randomPosAwayFrom(dense, 500, 3);
    expect(closeTo(vLen(p), RADIUS, 1e-10)).toBe(true);
  });
});

describe("sphereAdvance", () => {
  it("keeps position on sphere surface", () => {
    const pos = { x: RADIUS, y: 0, z: 0 };
    const vel = { x: 0, y: 50, z: 0 };
    const { pos: newPos } = sphereAdvance(pos, vel, 0.1);
    expect(closeTo(vLen(newPos), RADIUS, 1e-8)).toBe(true);
  });

  it("keeps velocity tangent to new position", () => {
    const pos = { x: RADIUS, y: 0, z: 0 };
    const vel = { x: 0, y: 50, z: 10 };
    const { pos: newPos, vel: newVel } = sphereAdvance(pos, vel, 0.1);
    expect(closeTo(vDot(newVel, newPos), 0, 1e-8)).toBe(true);
  });

  it("advances in correct direction", () => {
    const pos = { x: RADIUS, y: 0, z: 0 };
    const vel = { x: 0, y: 100, z: 0 };
    const { pos: newPos } = sphereAdvance(pos, vel, 0.1);
    expect(newPos.y).toBeGreaterThan(0);
    expect(newPos.x).toBeGreaterThan(0);
  });
});

describe("rotateForward", () => {
  it("returns a unit vector", () => {
    const pos = { x: RADIUS, y: 0, z: 0 };
    const fwd = { x: 0, y: 1, z: 0 };
    const r = rotateForward(fwd, pos, 1);
    expect(closeTo(vLen(r), 1)).toBe(true);
  });

  it("is tangent to the sphere", () => {
    const pos = { x: RADIUS, y: 0, z: 0 };
    const fwd = { x: 0, y: 1, z: 0 };
    const r = rotateForward(fwd, pos, 1);
    expect(closeTo(vDot(r, pos), 0, 1e-8)).toBe(true);
  });

  it("zero angle returns same forward", () => {
    const pos = { x: RADIUS, y: 0, z: 0 };
    const fwd = { x: 0, y: 1, z: 0.5 };
    const r = rotateForward(fwd, pos, 0);
    expect(approxEq(vNorm(r), vNorm(fwd))).toBe(true);
  });

  it("pi/2 rotation is perpendicular", () => {
    const pos = { x: 0, y: 0, z: RADIUS };
    const fwd = { x: 1, y: 0, z: 0 };
    const r = rotateForward(fwd, pos, Math.PI / 2);
    expect(closeTo(Math.abs(vDot(r, fwd)), 0, 1e-8)).toBe(true);
  });
});

describe("initialTangent", () => {
  it("returns a unit vector", () => {
    const pos = { x: RADIUS, y: 0, z: 0 };
    const t = initialTangent(pos);
    expect(closeTo(vLen(t), 1)).toBe(true);
  });

  it("is perpendicular to position", () => {
    for (let i = 0; i < 20; i++) {
      const pos = randomPos();
      const t = initialTangent(pos);
      expect(closeTo(vDot(t, pos), 0, 1e-8)).toBe(true);
    }
  });

  it("does not fail at poles", () => {
    const tNorth = initialTangent({ x: 0, y: 0, z: RADIUS });
    expect(closeTo(vLen(tNorth), 1)).toBe(true);
    expect(closeTo(vDot(tNorth, { x: 0, y: 0, z: 1 } as Vec3), 0, 1e-8)).toBe(true);

    const tSouth = initialTangent({ x: 0, y: 0, z: -RADIUS });
    expect(closeTo(vLen(tSouth), 1)).toBe(true);
    expect(closeTo(vDot(tSouth, { x: 0, y: 0, z: -1 } as Vec3), 0, 1e-8)).toBe(true);
  });
});
