import { useMemo } from 'react';
import type { ReactElement, CSSProperties } from 'react';

/**
 * Procedural isometric voxel terrain for the home-page "drone flight".
 *
 * The map is deterministic and periodic, which is what makes the flight
 * loop seamless: cell appearance is a function of screen-diagonal
 * coordinates (u = i-j, v = i+j) looked up in fixed tables of size
 * U_PERIOD × V_PERIOD. One flight step shifts v by 2, so after
 * V_PERIOD/2 steps — V_PERIOD × HH pixels on screen — every cell lands
 * exactly where an identical one started, and the animation can snap
 * back with no visible cut. Randomising instead of seeding would break
 * this and also make screenshots unreproducible.
 *
 * Everything here renders once (useMemo) into a single <g>; the flight
 * itself is a CSS transform on that group, so the whole map stays one
 * composited GPU layer no matter how many polygons it holds.
 */

const HW = 64; // half block width on screen
const HH = 32; // half block height (2:1 isometric)
const VZ = 34; // screen rise per height unit

const U_PERIOD = 26; // horizontal repeat: 26 * HW = 1664px
const V_PERIOD = 20; // scroll repeat: 20 * HH = 640px

const X_CENTER = 960;
const U_MIN = -17;
const U_MAX = 17;
const V_MIN = -12;
const V_MAX = 57;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

function buildTables() {
  const rand = mulberry32(20260803);
  let height: number[][] = Array.from({ length: U_PERIOD }, () =>
    Array.from({ length: V_PERIOD }, () => rand() * 4.6),
  );
  // Two smoothing passes over the four isometric neighbours (u±1, v±1),
  // wrapping at the period so the seam smooths like everywhere else.
  for (let pass = 0; pass < 2; pass++) {
    const next = height.map((col) => col.slice());
    for (let u = 0; u < U_PERIOD; u++) {
      for (let v = 0; v < V_PERIOD; v++) {
        const n =
          height[mod(u - 1, U_PERIOD)][mod(v - 1, V_PERIOD)] +
          height[mod(u - 1, U_PERIOD)][mod(v + 1, V_PERIOD)] +
          height[mod(u + 1, U_PERIOD)][mod(v - 1, V_PERIOD)] +
          height[mod(u + 1, U_PERIOD)][mod(v + 1, V_PERIOD)];
        next[u][v] = (height[u][v] * 2 + n) / 6;
      }
    }
    height = next;
  }
  const deco: number[][] = Array.from({ length: U_PERIOD }, () =>
    Array.from({ length: V_PERIOD }, () => rand()),
  );
  return { height, deco };
}

const TABLES = buildTables();

/** Smoothing pulls values toward the mean, so thresholds sit around it. */
function quantize(v: number): number {
  if (v < 1.55) return 0; // water
  if (v < 2.35) return 1; // lowland
  if (v < 2.95) return 2; // highland
  if (v < 3.4) return 3; // stone
  return 4; // snow cap
}

interface Cell {
  h: number;
  deco: number;
  lava: boolean;
  house: boolean;
}

function cellAt(u: number, v: number): Cell {
  const uu = mod(u, U_PERIOD);
  const vv = mod(v, V_PERIOD);
  let h = quantize(TABLES.height[uu][vv]);
  const deco = TABLES.deco[uu][vv];
  const lava = deco < 0.015 && h >= 1 && h <= 2;
  if (lava) h = 1;
  const house = deco > 0.997 && h >= 2;
  return { h, deco, lava, house };
}

/* Night palette, lit from the upper right where the aurora sits — right
   faces catch the light, left faces fall into violet shadow. */
const GRASS_TOP = ['#3f8763', '#37795a', '#437e60'];
const GRASS_L = '#332a41';
const GRASS_R = '#463a51';
const STONE_TOP = ['#73738f', '#6a6a85'];
const STONE_L = '#3e3e56';
const STONE_R = '#535370';
const SNOW_TOP = '#c9c9e4';
const SNOW_L = '#8a8ab0';
const SNOW_R = '#a9a9cf';
const WATER_TOP = '#2b3f74';
const TRUNK = '#453126';
const LEAF_TOP = '#2c5f47';
const LEAF_L = '#204634';
const LEAF_R = '#28553f';
const WALL_L = '#3a2b20';
const WALL_R = '#55402d';
const ROOF_TOP = '#4a4468';
const ROOF_L = '#2a2440';
const ROOF_R = '#383254';
const DOOR = '#241a12';

const pts = (p: Array<[number, number]>) => p.map(([x, y]) => `${x},${y}`).join(' ');

/** Fill + same-colour stroke seals the antialiasing seams between faces. */
function face(key: string, points: Array<[number, number]>, fill: string, extra?: object) {
  return (
    <polygon
      key={key}
      points={pts(points)}
      fill={fill}
      stroke={fill}
      strokeWidth="0.75"
      strokeLinejoin="round"
      {...extra}
    />
  );
}

/**
 * Blocky cottage sitting on a cell top: plank walls, a two-step slab roof
 * with a chimney, a door on the lit face and a candle-lit window on the
 * shadow face. Drawn with the cells (not the overlays) so terrain in front
 * of it occludes it like any other prism.
 */
function houseAt(key: string, x: number, yTop: number, deco: number): ReactElement {
  const yW = yTop - 36; // wall top; walls drop 36px onto the block

  /** Flat roof slab, same construction as the tree canopy. */
  const slab = (k: string, hw: number, hh: number, d: number, yl: number) => [
    face(
      `${k}l`,
      [
        [x - hw, yl],
        [x, yl + hh],
        [x, yl + hh + d],
        [x - hw, yl + d],
      ],
      ROOF_L,
    ),
    face(
      `${k}r`,
      [
        [x, yl + hh],
        [x + hw, yl],
        [x + hw, yl + d],
        [x, yl + hh + d],
      ],
      ROOF_R,
    ),
    face(
      `${k}t`,
      [
        [x, yl - hh],
        [x + hw, yl],
        [x, yl + hh],
        [x - hw, yl],
      ],
      ROOF_TOP,
    ),
  ];

  return (
    <g key={key}>
      {face(
        `${key}wl`,
        [
          [x - 32, yW],
          [x, yW + 16],
          [x, yW + 52],
          [x - 32, yW + 36],
        ],
        WALL_L,
      )}
      {face(
        `${key}wr`,
        [
          [x, yW + 16],
          [x + 32, yW],
          [x + 32, yW + 36],
          [x, yW + 52],
        ],
        WALL_R,
      )}
      {/* Door and window are quads in their wall's plane, not screen rects. */}
      {face(
        `${key}dr`,
        [
          [x + 9.6, yW + 47.2],
          [x + 19.8, yW + 42.1],
          [x + 19.8, yW + 18.1],
          [x + 9.6, yW + 23.2],
        ],
        DOOR,
      )}
      {face(
        `${key}wi`,
        [
          [x - 23, yW + 14.5],
          [x - 12.8, yW + 19.6],
          [x - 12.8, yW + 33.6],
          [x - 23, yW + 28.5],
        ],
        '#fbbf24',
        {
          className: 'rf-bd-glint',
          style: { animationDelay: `${-deco * 20}s` } as CSSProperties,
        },
      )}
      {slab(`${key}r1`, 44, 22, 14, yW - 14)}
      {slab(`${key}r2`, 26, 13, 12, yW - 28)}
      <rect x={x + 14} y={yW - 50} width="10" height="36" fill="#3e3e56" />
      <rect x={x + 12} y={yW - 55} width="14" height="6" fill="#2c2c40" />
    </g>
  );
}

function buildScene() {
  const cells: ReactElement[] = [];
  const overlays: ReactElement[] = [];

  for (let v = V_MIN; v <= V_MAX; v++) {
    for (let u = U_MIN; u <= U_MAX; u++) {
      // Isometric cells exist only where u and v share parity.
      if (mod(u + v, 2) !== 0) continue;
      const { h, deco, lava, house } = cellAt(u, v);
      const x = X_CENTER + u * HW;
      const yBase = v * HH;
      const key = `${u}:${v}`;

      if (h === 0 && !lava) {
        // Water sits sunken below the land line.
        const y = yBase + 9;
        cells.push(
          face(
            `${key}w`,
            [
              [x, y - HH],
              [x + HW, y],
              [x, y + HH],
              [x - HW, y],
            ],
            WATER_TOP,
            {
              opacity: 0.94,
            },
          ),
        );
        if (deco > 0.55 && deco < 0.62) {
          overlays.push(
            <circle
              key={`${key}sp`}
              className="rf-bd-glint"
              cx={x + (deco - 0.585) * 900}
              cy={y}
              r="2.2"
              fill="#aab8e8"
              style={{ animationDelay: `${deco * 40}s` } as CSSProperties}
            />,
          );
        }
        continue;
      }

      const yTop = yBase - h * VZ;
      const depth = h * VZ + HH + 10;
      const N: [number, number] = [x, yTop - HH];
      const E: [number, number] = [x + HW, yTop];
      const S: [number, number] = [x, yTop + HH];
      const W: [number, number] = [x - HW, yTop];

      const snow = h >= 4;
      const stone = h === 3;
      const topFill = lava
        ? 'url(#rfbd-lava)'
        : snow
          ? SNOW_TOP
          : stone
            ? STONE_TOP[mod(u * 7 + v * 13, STONE_TOP.length)]
            : GRASS_TOP[mod(u * 7 + v * 13, GRASS_TOP.length)];
      const leftFill = snow ? SNOW_L : stone ? STONE_L : GRASS_L;
      const rightFill = snow ? SNOW_R : stone ? STONE_R : GRASS_R;

      cells.push(
        face(`${key}l`, [W, S, [S[0], S[1] + depth], [W[0], W[1] + depth]], leftFill),
        face(`${key}r`, [S, E, [E[0], E[1] + depth], [S[0], S[1] + depth]], rightFill),
        face(`${key}t`, [N, E, S, W], topFill),
      );

      if (lava) {
        overlays.push(
          <ellipse
            key={`${key}lg`}
            className="rf-bd-lava"
            cx={x}
            cy={yTop}
            rx="120"
            ry="60"
            fill="url(#rfbd-lava-glow)"
          />,
        );
      }

      if (house) {
        cells.push(houseAt(`${key}h`, x, yTop, deco));
        // Warm spill from the window, over everything like the lava glows.
        overlays.push(
          <ellipse
            key={`${key}hg`}
            className="rf-bd-lava"
            cx={x - 18}
            cy={yTop - 12}
            rx="56"
            ry="36"
            fill="url(#rfbd-lava-glow)"
          />,
        );
      }

      // Blocky tree on lowland grass.
      if (!lava && !house && (h === 1 || h === 2) && deco > 0.02 && deco < 0.095) {
        const yl = yTop - 42;
        const lw = 26;
        const lh = 13;
        const ld = 24;
        cells.push(
          <rect key={`${key}tr`} x={x - 4.5} y={yTop - 22} width="9" height="24" fill={TRUNK} />,
          face(
            `${key}ll`,
            [
              [x - lw, yl],
              [x, yl + lh],
              [x, yl + lh + ld],
              [x - lw, yl + ld],
            ],
            LEAF_L,
          ),
          face(
            `${key}lr`,
            [
              [x, yl + lh],
              [x + lw, yl],
              [x + lw, yl + ld],
              [x, yl + lh + ld],
            ],
            LEAF_R,
          ),
          face(
            `${key}lt`,
            [
              [x, yl - lh],
              [x + lw, yl],
              [x, yl + lh],
              [x - lw, yl],
            ],
            LEAF_TOP,
          ),
        );
      }

      // Amber ore glint on exposed stone.
      if (stone && deco > 0.1 && deco < 0.16) {
        overlays.push(
          <circle
            key={`${key}ore`}
            className="rf-bd-glint"
            cx={x + HW * 0.42}
            cy={yTop + HH + depth * 0.3}
            r="3"
            fill="#fbbf24"
            style={{ animationDelay: `${deco * 30}s` } as CSSProperties}
          />,
        );
      }
    }
  }

  return { cells, overlays };
}

export function VoxelTerrain() {
  const scene = useMemo(buildScene, []);
  return (
    <g>
      {scene.cells}
      {scene.overlays}
    </g>
  );
}
