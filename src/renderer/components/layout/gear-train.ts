// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * A train of gears that mesh, worked out from their teeth and where they lead.
 *
 * Gears only look right when four things hold at once, and set by eye they do
 * not: the wheels of the workshop scene used to drift half a tooth apart within
 * half a minute and then ran through each other.
 *
 * - One size of tooth, so a wheel's pitch radius follows from its tooth count.
 * - Centres exactly two pitch radii apart, so the pitch circles roll on each other.
 * - One speed at the rim, so a turn takes a time per tooth and not per pixel of
 *   radius. It is what keeps a mesh in step for as long as the scene is up.
 * - A tooth of one wheel opposite a gap of the next, so they start in step.
 */

/** Rim distance from one tooth to the next, in the scene's units. */
export const TOOTH_PITCH = 40;

/**
 * The tooth, as parts of the pitch. Its sides lean in: a square tooth this
 * chunky cannot leave a gap without its corners going through the other wheel.
 * With these, measured over every pair in the scene, nothing overlaps.
 */
const ADDENDUM = 0.225;
const DEDENDUM = 0.275;
const ROOT_WIDTH = 0.5;
const TIP_WIDTH = 0.25;

const SECONDS_PER_TOOTH = 1.4;

export interface PlacedGear {
  x: number;
  y: number;
  teeth: number;
  /** Rim distance between teeth; {@link TOOTH_PITCH} for every wheel of a train. */
  pitch: number;
  /** The radius at which it rolls on its neighbours. */
  pitchRadius: number;
  /** Degrees, clockwise on screen: where its first tooth stands when the turning starts. */
  phase: number;
  turnSeconds: number;
  /** Turns anticlockwise, against the wheel before it. */
  reverse: boolean;
}

export function pitchRadius(teeth: number, pitch = TOOTH_PITCH): number {
  return (teeth * pitch) / (2 * Math.PI);
}

/** The radius of the disc under the teeth: the mate's tips stop just short of it. */
export function bodyRadius(gear: Pick<PlacedGear, 'pitch' | 'pitchRadius'>): number {
  return gear.pitchRadius - DEDENDUM * gear.pitch;
}

export function tipRadius(gear: Pick<PlacedGear, 'pitch' | 'pitchRadius'>): number {
  return gear.pitchRadius + ADDENDUM * gear.pitch;
}

/** One tooth standing on the +x axis, as `[x, y]` corners around the wheel's centre. */
export function toothOutline(gear: Pick<PlacedGear, 'pitch' | 'pitchRadius'>): [number, number][] {
  const root = bodyRadius(gear);
  const tip = tipRadius(gear);
  const rootHalf = (ROOT_WIDTH * gear.pitch) / 2;
  const tipHalf = (TIP_WIDTH * gear.pitch) / 2;
  // The foot goes on under the disc: the disc's edge curves away from a flat
  // foot, and would leave a sliver of background at each corner.
  const foot = root - DEDENDUM * gear.pitch;
  return [
    [foot, -rootHalf],
    [root, -rootHalf],
    [tip, -tipHalf],
    [tip, tipHalf],
    [root, rootHalf],
    [foot, rootHalf],
  ];
}

/** Every tooth of a wheel as one path, so a wheel costs the scene one element for them. */
export function teethPath(gear: Pick<PlacedGear, 'teeth' | 'pitch' | 'pitchRadius'>): string {
  const outline = toothOutline(gear);
  let path = '';
  for (let i = 0; i < gear.teeth; i++) {
    const angle = (2 * Math.PI * i) / gear.teeth;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const corners = outline.map(
      ([x, y]) => `${(x * cos - y * sin).toFixed(2)} ${(x * sin + y * cos).toFixed(2)}`,
    );
    path += `M${corners.join('L')}Z`;
  }
  return path;
}

/**
 * A wheel that turns alone, for a scene's background: no neighbour to keep step
 * with, so it takes its own size of tooth and its own time.
 */
export function loneGear(
  x: number,
  y: number,
  radius: number,
  teeth: number,
  turnSeconds: number,
): PlacedGear {
  return {
    x,
    y,
    teeth,
    pitch: (2 * Math.PI * radius) / teeth,
    pitchRadius: radius,
    phase: 0,
    turnSeconds,
    reverse: false,
  };
}

/**
 * Lay a train out from its first wheel. `towards` is the direction from a wheel
 * to the one after it, in degrees, clockwise on screen from +x.
 */
export function gearTrain(
  first: { x: number; y: number; teeth: number },
  next: { teeth: number; towards: number }[],
): PlacedGear[] {
  const wheel = (
    x: number,
    y: number,
    teeth: number,
    phase: number,
    index: number,
  ): PlacedGear => ({
    x,
    y,
    teeth,
    pitch: TOOTH_PITCH,
    pitchRadius: pitchRadius(teeth),
    phase,
    turnSeconds: teeth * SECONDS_PER_TOOTH,
    reverse: index % 2 === 1,
  });

  const train = [wheel(first.x, first.y, first.teeth, 0, 0)];
  next.forEach(({ teeth, towards }, i) => {
    const before = train[i];
    const distance = before.pitchRadius + pitchRadius(teeth);
    const line = (towards * Math.PI) / 180;
    train.push(
      wheel(
        before.x + distance * Math.cos(line),
        before.y + distance * Math.sin(line),
        teeth,
        phaseAgainst(before, teeth, towards),
        i + 1,
      ),
    );
  });
  return train;
}

/**
 * Where a wheel's first tooth stands for the wheel before it to mesh with it.
 *
 * Count, on each wheel, how many teeth stand between its first tooth and the
 * point where the two touch. The wheels turn opposite ways at one rim speed, so
 * one count falls as fast as the other rises and their sum never changes. A
 * tooth of one is opposite a gap of the other when that sum is a half.
 */
function phaseAgainst(before: PlacedGear, teeth: number, towards: number): number {
  const beforeCount = ((towards - before.phase) * before.teeth) / 360;
  const thisCount = 0.5 - beforeCount;
  return towards + 180 - (thisCount * 360) / teeth;
}

/** The train down the workshop's left wall. The directions are all that is chosen by hand. */
export const WORKSHOP_TRAIN = gearTrain({ x: 398, y: 484, teeth: 8 }, [
  { teeth: 13, towards: 52 },
  { teeth: 9, towards: -18 },
  { teeth: 10, towards: 49 },
  { teeth: 7, towards: -25 },
]);
