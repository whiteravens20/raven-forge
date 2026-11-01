// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WORKSHOP_TRAIN,
  bodyRadius,
  loneGear,
  teethPath,
  tipRadius,
  toothOutline,
  type PlacedGear,
} from '../src/renderer/components/layout/gear-train';

type Point = [number, number];

const pairs = WORKSHOP_TRAIN.slice(1).map((wheel, i) => [WORKSHOP_TRAIN[i], wheel] as const);
const AN_HOUR = 3600;
const SECONDS_PER_TOOTH = WORKSHOP_TRAIN[0].turnSeconds / WORKSHOP_TRAIN[0].teeth;

function distance(a: PlacedGear, b: PlacedGear): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Every tooth of a wheel where it stands that many seconds after the turning began. */
function teethAt(wheel: PlacedGear, seconds: number): Point[][] {
  const turned = wheel.phase + ((wheel.reverse ? -1 : 1) * 360 * seconds) / wheel.turnSeconds;
  return Array.from({ length: wheel.teeth }, (_, i) => {
    const angle = ((turned + (360 * i) / wheel.teeth) * Math.PI) / 180;
    return toothOutline(wheel).map(([x, y]): Point => [
      wheel.x + x * Math.cos(angle) - y * Math.sin(angle),
      wheel.y + x * Math.sin(angle) + y * Math.cos(angle),
    ]);
  });
}

/** How far two convex outlines go into each other; 0 when a line can be drawn between them. */
function overlap(a: Point[], b: Point[]): number {
  let least = Infinity;
  for (const outline of [a, b]) {
    for (let i = 0; i < outline.length; i++) {
      const [x1, y1] = outline[i];
      const [x2, y2] = outline[(i + 1) % outline.length];
      const [nx, ny] = [y2 - y1, x1 - x2];
      const length = Math.hypot(nx, ny);
      const along = (points: Point[]) => points.map(([x, y]) => (x * nx + y * ny) / length);
      const [onA, onB] = [along(a), along(b)];
      const depth = Math.min(
        Math.max(...onA) - Math.min(...onB),
        Math.max(...onB) - Math.min(...onA),
      );
      if (depth <= 0) return 0;
      least = Math.min(least, depth);
    }
  }
  return least;
}

/** The deepest the teeth of two wheels go into each other over one tooth's passing. */
function worstOverlap(a: PlacedGear, b: PlacedGear, from = 0): number {
  let worst = 0;
  const period = a.turnSeconds / a.teeth;
  for (let step = 0; step < 120; step++) {
    const seconds = from + (period * step) / 120;
    for (const toothA of teethAt(a, seconds)) {
      for (const toothB of teethAt(b, seconds)) worst = Math.max(worst, overlap(toothA, toothB));
    }
  }
  return worst;
}

describe('the gear train in the workshop scene', () => {
  it('puts neighbours exactly the two pitch radii apart, so the wheels roll on each other', () => {
    for (const [a, b] of pairs) {
      expect(distance(a, b)).toBeCloseTo(a.pitchRadius + b.pitchRadius, 6);
    }
  });

  it('gives every wheel one size of tooth', () => {
    for (const wheel of WORKSHOP_TRAIN) {
      expect((2 * Math.PI * wheel.pitchRadius) / wheel.teeth).toBeCloseTo(wheel.pitch, 6);
      expect(wheel.pitch).toBe(WORKSHOP_TRAIN[0].pitch);
    }
  });

  it('turns every wheel at one speed at the rim', () => {
    for (const wheel of WORKSHOP_TRAIN) {
      expect(wheel.turnSeconds / wheel.teeth).toBeCloseTo(SECONDS_PER_TOOTH, 6);
    }
  });

  it('turns each wheel against the one before it', () => {
    for (const [a, b] of pairs) expect(b.reverse).toBe(!a.reverse);
  });

  it('never lets a tooth into a tooth of the next wheel', () => {
    for (const [a, b] of pairs) expect(worstOverlap(a, b)).toBe(0);
  });

  it('is as true after an hour as it was at the start', () => {
    for (const [a, b] of pairs) expect(worstOverlap(a, b, AN_HOUR)).toBe(0);
  });

  it('stops every tooth short of the disc it reaches towards', () => {
    for (const [a, b] of pairs) {
      expect(tipRadius(a) + bodyRadius(b)).toBeLessThan(distance(a, b));
      expect(tipRadius(b) + bodyRadius(a)).toBeLessThan(distance(a, b));
    }
  });

  it('keeps wheels that are not neighbours clear of each other', () => {
    WORKSHOP_TRAIN.forEach((a, i) => {
      for (const b of WORKSHOP_TRAIN.slice(i + 2)) {
        expect(tipRadius(a) + tipRadius(b)).toBeLessThan(distance(a, b));
      }
    });
  });
});

// The check above has to be able to fail, on the two faults the scene really had.
describe('what the check finds', () => {
  const [a, b] = pairs[0];

  it('a wheel half a tooth out', () => {
    const out = { ...b, phase: b.phase + 180 / b.teeth };
    expect(worstOverlap(a, out)).toBeGreaterThan(1);
  });

  it('wheels timed by their radius and not by their teeth, once they have drifted', () => {
    const byRadius = { ...b, turnSeconds: (a.turnSeconds * b.pitchRadius) / a.pitchRadius + 0.3 };
    let worst = 0;
    for (let from = 0; from < AN_HOUR / 10; from += 7) {
      worst = Math.max(worst, worstOverlap(a, byRadius, from));
    }
    expect(worst).toBeGreaterThan(1);
  });
});

describe('a wheel on its own', () => {
  it('takes a tooth to fit its size', () => {
    const wheel = loneGear(0, 0, 220, 12, 70);
    expect(wheel.pitchRadius).toBe(220);
    expect(wheel.turnSeconds).toBe(70);
    expect((wheel.teeth * wheel.pitch) / (2 * Math.PI)).toBeCloseTo(220, 6);
  });
});

describe('how a wheel is drawn', () => {
  it('draws every tooth', () => {
    for (const wheel of WORKSHOP_TRAIN) {
      expect(teethPath(wheel).match(/M/g)).toHaveLength(wheel.teeth);
    }
  });

  // The box of an odd-toothed wheel does not centre on its axle, so turning
  // about the box's centre makes the wheel wobble out of mesh.
  it('turns about the wheel’s own centre and not the centre of its box', () => {
    const css = readFileSync('src/renderer/styles/global.css', 'utf8');
    const rule = /\.rf-bd-spin\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('transform-origin: 0 0');
    expect(rule).not.toContain('transform-box');
  });
});
