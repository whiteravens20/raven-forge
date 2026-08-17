import type { CSSProperties, ReactElement } from 'react';
import { VoxelTerrain } from './voxel-terrain';

/**
 * The three Minecraft moods cycled by ForgeBackdrop: an overworld drone
 * flight, a Nether forge, and the End void. Each is a <g> painted into the
 * shared 1920×1080 backdrop SVG and starts with its own full-canvas wash,
 * so the scene owns the atmosphere while the shared aurora bleeds through
 * faintly. All gradient/def ids referenced here live in ForgeBackdrop's
 * <defs>; all motion classes live in global.css under `rf-bd-`.
 *
 * Everything is deterministic — hand-placed or seeded — so every boot and
 * every screenshot composes identically.
 */

const pts = (p: Array<[number, number]>) => p.map(([x, y]) => `${x},${y}`).join(' ');

/** Isometric prism: top diamond + two faces, sealed against AA seams. */
function column(
  key: string,
  x: number,
  yTop: number,
  hw: number,
  hh: number,
  depth: number,
  top: string,
  left: string,
  right: string,
): ReactElement {
  const seal = (fill: string) => ({
    fill,
    stroke: fill,
    strokeWidth: 0.75,
    strokeLinejoin: 'round' as const,
  });
  return (
    <g key={key}>
      <polygon
        points={pts([
          [x - hw, yTop],
          [x, yTop + hh],
          [x, yTop + hh + depth],
          [x - hw, yTop + depth],
        ])}
        {...seal(left)}
      />
      <polygon
        points={pts([
          [x, yTop + hh],
          [x + hw, yTop],
          [x + hw, yTop + depth],
          [x, yTop + hh + depth],
        ])}
        {...seal(right)}
      />
      <polygon
        points={pts([
          [x, yTop - hh],
          [x + hw, yTop],
          [x, yTop + hh],
          [x - hw, yTop],
        ])}
        {...seal(top)}
      />
    </g>
  );
}

/* ── Overworld: drone flight over the map ─────────────────── */

const CLOUDS: Array<{ x: number; y: number; w: number; cls: string }> = [
  { x: 150, y: 340, w: 300, cls: 'rf-bd-cloud-a' },
  { x: 760, y: 300, w: 220, cls: 'rf-bd-cloud-b' },
  { x: 1350, y: 370, w: 340, cls: 'rf-bd-cloud-c' },
  { x: 1700, y: 300, w: 190, cls: 'rf-bd-cloud-a' },
];

export function OverworldScene() {
  return (
    <g>
      {/* Blocky clouds between the sky and the map — far layer of the parallax. */}
      {CLOUDS.map((c, i) => (
        <g key={i} className={c.cls} fill="#dcd7f5" opacity="0.09">
          <rect x={c.x} y={c.y} width={c.w} height="26" rx="6" />
          <rect x={c.x + c.w * 0.18} y={c.y - 18} width={c.w * 0.5} height="20" rx="6" />
        </g>
      ))}

      {/* Elytra-like trails arcing across the sky. */}
      <g className="rf-bd-comet rf-bd-comet-a">
        <rect x="-78" y="-1.5" width="78" height="3" fill="url(#rfbd-comet-tail)" />
        <circle r="3.5" fill="#ede9fe" />
        <circle r="9" fill="url(#rfbd-comet-halo)" />
      </g>
      <g className="rf-bd-comet rf-bd-comet-b">
        <rect x="-64" y="-1.2" width="64" height="2.4" fill="url(#rfbd-comet-tail)" />
        <circle r="2.8" fill="#ede9fe" />
        <circle r="7" fill="url(#rfbd-comet-halo)" />
      </g>

      {/* The map materialises at the horizon line and flows toward the
          viewer; the mask is static while the terrain scrolls under it. */}
      <g mask="url(#rfbd-horizon)">
        <g className="rf-bd-sway">
          <g className="rf-bd-flight">
            <VoxelTerrain />
          </g>
        </g>
      </g>
    </g>
  );
}

/* ── Nether: the forge ────────────────────────────────────── */

const BASALT_TOP = '#3a2d40';
const BASALT_L = '#221826';
const BASALT_R = '#2e2232';

/** x, screen y of the column's top, prism half-width, body depth. */
const BASALT_COLUMNS: Array<[number, number, number, number]> = [
  [140, 560, 52, 520],
  [255, 680, 44, 420],
  [1560, 500, 56, 600],
  [1690, 640, 46, 460],
  [1800, 560, 52, 540],
  [960, 760, 40, 340],
  [620, 800, 34, 300],
];

const GLOWSTONE: Array<[number, number]> = [
  [380, 108],
  [1180, 88],
  [1520, 128],
];

const NETHER_EMBER_XS = [180, 420, 700, 1000, 1350, 1600, 1750, 880];

export function NetherScene() {
  return (
    <g>
      <rect width="1920" height="1080" fill="url(#rfbd-nether-air)" />

      {/* Far basalt silhouettes give the mid-band depth. */}
      {[
        [350, 620, 30, 460],
        [520, 700, 24, 380],
        [1240, 660, 28, 420],
        [1390, 730, 22, 350],
      ].map(([x, y, hw, d], i) => (
        <g key={i} opacity="0.6">
          {column(`far${i}`, x, y, hw, hw / 2, d, '#2c2130', '#1a1120', '#241a28')}
        </g>
      ))}

      {/* Distant bastion, its windows lit from inside. */}
      <polygon
        points="1050,930 1050,520 1120,520 1120,440 1210,440 1210,380 1330,380 1330,450 1400,450 1400,560 1460,560 1460,930"
        fill="#2e1822"
      />
      {[
        [1150, 490],
        [1255, 430],
        [1300, 530],
        [1180, 610],
        [1330, 660],
        [1120, 720],
      ].map(([x, y], i) => (
        <rect
          key={i}
          className={i % 2 === 0 ? 'rf-bd-glint' : undefined}
          x={x}
          y={y}
          width="10"
          height="16"
          fill="#f59e0b"
          opacity="0.7"
          style={i % 2 === 0 ? ({ animationDelay: `${i * 0.9}s` } as CSSProperties) : undefined}
        />
      ))}

      {/* Basalt columns rising from the lava sea. */}
      {BASALT_COLUMNS.map(([x, y, hw, d], i) =>
        column(`b${i}`, x, y, hw, hw / 2, d, BASALT_TOP, BASALT_L, BASALT_R),
      )}

      {/* Ceiling: the Nether has a roof — stepped blocks, stalactites and
          glowstone pockets. */}
      <polygon
        points="0,0 1920,0 1920,150 1620,120 1320,170 1040,110 700,160 380,120 0,170"
        fill="#221420"
      />
      {[
        [240, 130, 26, 90],
        [700, 150, 30, 130],
        [1120, 115, 24, 80],
        [1620, 125, 28, 110],
      ].map(([x, y, hw, len], i) => (
        <polygon
          key={i}
          points={pts([
            [x - hw, y],
            [x + hw, y],
            [x, y + len],
          ])}
          fill="#1a0f1b"
        />
      ))}
      {GLOWSTONE.map(([x, y], i) => (
        <g key={i} className="rf-bd-lava">
          <ellipse cx={x} cy={y} rx="80" ry="46" fill="url(#rfbd-lava-glow)" />
          <rect x={x - 26} y={y - 12} width="52" height="26" rx="4" fill="#fbbf24" opacity="0.85" />
          <rect x={x - 12} y={y + 12} width="26" height="14" rx="3" fill="#f59e0b" opacity="0.75" />
        </g>
      ))}

      {/* A single lava fall pouring from the ceiling into the sea — the
          flowing dash pattern is what sells the motion. */}
      <g>
        <line x1="520" y1="152" x2="520" y2="890" stroke="#f59e0b" strokeWidth="30" opacity="0.4" />
        <line
          className="rf-bd-flow"
          x1="520"
          y1="152"
          x2="520"
          y2="890"
          stroke="#fbbf24"
          strokeWidth="12"
          strokeDasharray="34 22"
        />
      </g>

      {/* The lava sea; the wider glow sits where the fall lands. */}
      <rect y="880" width="1920" height="200" fill="url(#rfbd-lava)" />
      <rect
        y="880"
        width="1920"
        height="200"
        fill="url(#rfbd-lava)"
        className="rf-bd-lava"
        opacity="0.5"
      />
      {[300, 520, 860, 1420, 1750].map((x, i) => (
        <ellipse
          key={i}
          className="rf-bd-lava"
          cx={x}
          cy="885"
          rx={x === 520 ? 240 : 190}
          ry="56"
          fill="url(#rfbd-lava-glow)"
        />
      ))}

      {/* Ember storm — denser and warmer than the ambient field. */}
      {NETHER_EMBER_XS.map((x, i) => (
        <g
          key={i}
          className="rf-bd-ember"
          style={
            {
              animationDuration: `${13 + (i % 5) * 3}s`,
              animationDelay: `${-i * 3.1}s`,
              '--rf-ember-peak': 0.85,
            } as CSSProperties
          }
        >
          <circle
            className="rf-bd-ember-dot"
            cx={x}
            cy={1010}
            r={5 + (i % 3)}
            fill="url(#rfbd-ember-warm)"
            style={{ animationDuration: `${5 + (i % 4)}s` }}
          />
        </g>
      ))}
    </g>
  );
}

/* ── Cave: the mine ───────────────────────────────────────── */

/** Blocky ore tile: a rock block with pixel inclusions, glow behind it. */
function oreBlock(key: string, x: number, y: number, glow: string, dot: string) {
  const cells: Array<[number, number]> = [
    [8, 8],
    [27, 13],
    [11, 27],
    [28, 29],
  ];
  return (
    <g key={key}>
      <circle cx={x + 22} cy={y + 22} r="58" fill={glow} />
      <rect
        x={x}
        y={y}
        width="44"
        height="44"
        rx="3"
        fill="#16223a"
        stroke="#22304e"
        strokeWidth="2"
      />
      {cells.map(([dx, dy], i) => (
        <rect
          key={i}
          className={i < 2 ? 'rf-bd-glint' : undefined}
          x={x + dx}
          y={y + dy}
          width="9"
          height="9"
          fill={dot}
          style={
            i < 2 ? ({ animationDelay: `${-((x + i * 37) % 5)}s` } as CSSProperties) : undefined
          }
        />
      ))}
    </g>
  );
}

/** Stepped silhouette stack — a blocky stalactite. */
function blockStack(key: string, x: number, topY: number, w: number, fill: string) {
  return (
    <g key={key} fill={fill}>
      <rect x={x - w / 2} y={topY} width={w} height={w * 0.62} />
      <rect x={x - w * 0.34} y={topY + w * 0.62} width={w * 0.68} height={w * 0.56} />
      <rect x={x - w * 0.17} y={topY + w * 1.18} width={w * 0.34} height={w * 0.5} />
    </g>
  );
}

/** [x, block width] — drips hang off the three widest. */
const STALACTITES: Array<[number, number]> = [
  [170, 84],
  [420, 56],
  [650, 100],
  [980, 62],
  [1250, 92],
  [1580, 58],
  [1800, 88],
];

/** Stepped back-wall strata: one rect per column, Minecraft skyline logic. */
const STRATA_A = [332, 300, 348, 316, 360, 308, 340, 324];
const STRATA_B = [560, 528, 592, 544, 604, 536, 576, 552];
const FLOOR_STEPS = [864, 840, 876, 852, 884, 846, 868, 856, 872, 844, 880, 858];

export function CaveScene() {
  return (
    <g>
      <rect width="1920" height="1080" fill="url(#rfbd-cave-air)" />

      {/* Back-wall strata, stepped like distant block columns. */}
      {STRATA_A.map((y, i) => (
        <rect
          key={`a${i}`}
          x={i * 240}
          y={y}
          width="240"
          height={1080 - y}
          fill="#0e1526"
          opacity="0.7"
        />
      ))}
      {STRATA_B.map((y, i) => (
        <rect
          key={`b${i}`}
          x={i * 240}
          y={y}
          width="240"
          height={1080 - y}
          fill="#101a2e"
          opacity="0.8"
        />
      ))}

      {/* Ceiling and blocky stalactites. */}
      <polygon points="0,0 1920,0 1920,120 1560,90 1180,140 820,85 460,130 0,95" fill="#0b101f" />
      {STALACTITES.map(([x, w], i) => blockStack(`st${i}`, x, 88, w, '#0b101f'))}

      {/* Water drips off the widest stalactites. */}
      {(
        [
          [650, 100],
          [1250, 92],
          [1800, 88],
        ] as const
      ).map(([x, w], i) => (
        <line
          key={i}
          className="rf-bd-drip"
          x1={x}
          y1={88 + w * 1.68 + 8}
          x2={x}
          y2={88 + w * 1.68 + 22}
          stroke="#7dd3fc"
          strokeWidth="2.5"
          style={{ animationDelay: `${-i * 1.1}s` } as CSSProperties}
        />
      ))}

      {/* Blocky floor line behind the rails. */}
      {FLOOR_STEPS.map((y, i) => (
        <rect key={`f${i}`} x={i * 160} y={y} width="160" height={1080 - y} fill="#0b1120" />
      ))}

      {/* Amethyst geode — the cave's brand moment, in a stepped pocket. */}
      <g>
        <rect x="1370" y="620" width="300" height="170" fill="#0a0e1c" />
        <rect x="1410" y="588" width="220" height="34" fill="#0a0e1c" />
        <rect x="1410" y="788" width="220" height="34" fill="#0a0e1c" />
        <circle cx="1520" cy="700" r="130" fill="url(#rfbd-crystal-halo)" />
        <g className="rf-bd-crystal">
          {[
            [1450, 740, 26, 64, -18],
            [1502, 752, 30, 84, 0],
            [1562, 744, 24, 58, 14],
            [1478, 700, 18, 44, -30],
            [1544, 690, 20, 48, 26],
          ].map(([cx, cy, w, h, rot], i) => (
            <polygon
              key={i}
              points={pts([
                [cx, cy - h],
                [cx + w / 2, cy - h / 3],
                [cx + w / 3, cy],
                [cx - w / 3, cy],
                [cx - w / 2, cy - h / 3],
              ])}
              fill="url(#rfbd-crystal)"
              transform={`rotate(${rot} ${cx} ${cy})`}
            />
          ))}
        </g>
      </g>

      {/* Ore blocks: diamond and gold veins (paired blocks), amethyst stray. */}
      {oreBlock('d1', 358, 738, 'url(#rfbd-cyan-glow)', '#67e8f9')}
      {oreBlock('d1b', 402, 762, 'url(#rfbd-cyan-glow)', '#67e8f9')}
      {oreBlock('d2', 760, 500, 'url(#rfbd-cyan-glow)', '#67e8f9')}
      {oreBlock('g1', 1018, 778, 'url(#rfbd-lava-glow)', '#fbbf24')}
      {oreBlock('g1b', 1062, 754, 'url(#rfbd-lava-glow)', '#fbbf24')}
      {oreBlock('g2', 200, 458, 'url(#rfbd-lava-glow)', '#fbbf24')}
      {oreBlock('a1', 1728, 478, 'url(#rfbd-crystal-halo)', '#d8b4fe')}

      {/* Lantern blocks left behind by the miners. */}
      {[
        [560, 660],
        [1280, 640],
      ].map(([x, y], i) => (
        <g key={i} className="rf-bd-lava">
          <circle cx={x} cy={y} r="70" fill="url(#rfbd-lava-glow)" />
          <rect x={x - 12} y={y - 14} width="24" height="28" rx="2" fill="#78350f" />
          <rect x={x - 8} y={y - 10} width="16" height="20" fill="#fbbf24" opacity="0.95" />
          <rect x={x - 4} y={y - 20} width="8" height="6" fill="#78350f" />
        </g>
      ))}

      {/* The rail line, slightly downhill, with a loaded cart rolling out.
          It sits above the news strip's cover line so the cart stays visible. */}
      <g transform="rotate(-3.5 960 780)">
        <rect x="-60" y="798" width="2100" height="10" fill="#0a0e1a" />
        {Array.from({ length: 24 }, (_, i) => (
          <rect key={i} x={-40 + i * 90} y="788" width="14" height="30" rx="2" fill="#1e2a44" />
        ))}
        <rect x="-60" y="780" width="2100" height="5" fill="#334b73" />
        <rect x="-60" y="812" width="2100" height="5" fill="#2a3d5e" />
        <g className="rf-bd-cart">
          <rect
            x="-10"
            y="736"
            width="86"
            height="44"
            rx="5"
            fill="#1b2438"
            stroke="#31456b"
            strokeWidth="2"
          />
          <circle cx="12" cy="786" r="11" fill="#31456b" />
          <circle cx="54" cy="786" r="11" fill="#31456b" />
          <circle className="rf-bd-glint" cx="18" cy="734" r="6" fill="#67e8f9" />
          <circle
            className="rf-bd-glint"
            cx="38"
            cy="728"
            r="7"
            fill="#d8b4fe"
            style={{ animationDelay: '-1.2s' } as CSSProperties}
          />
          <circle
            className="rf-bd-glint"
            cx="58"
            cy="734"
            r="6"
            fill="#fbbf24"
            style={{ animationDelay: '-2.1s' } as CSSProperties}
          />
        </g>
      </g>

      {/* Square dust motes hanging in the torchlight. */}
      {[300, 700, 900, 1150, 1450, 1650].map((x, i) => (
        <rect
          key={i}
          className="rf-bd-glint"
          x={x}
          y={340 + ((i * 137) % 260)}
          width="4"
          height="4"
          fill="#93a5cf"
          style={{ animationDelay: `${-i * 0.9}s` } as CSSProperties}
        />
      ))}
    </g>
  );
}

/* ── Tech: the workshop ───────────────────────────────────── */

/** Create-style cogwheel: chunky square teeth, thick ring, square hub. */
function gear(
  key: string,
  cx: number,
  cy: number,
  r: number,
  teeth: number,
  durS: number,
  body: string,
  rim: string,
  reverse = false,
) {
  const rects: ReactElement[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (360 / teeth) * i;
    rects.push(
      <rect
        key={i}
        x={cx - r * 0.12}
        y={cy - r - r * 0.24}
        width={r * 0.24}
        height={r * 0.3}
        rx={r * 0.03}
        fill={rim}
        transform={`rotate(${a} ${cx} ${cy})`}
      />,
    );
  }
  return (
    <g
      key={key}
      className="rf-bd-spin"
      style={
        {
          animationDuration: `${durS}s`,
          animationDirection: reverse ? 'reverse' : 'normal',
        } as CSSProperties
      }
    >
      {rects}
      <circle cx={cx} cy={cy} r={r} fill={body} />
      <circle cx={cx} cy={cy} r={r * 0.76} fill="none" stroke={rim} strokeWidth={r * 0.12} />
      <rect
        x={cx - r * 0.18}
        y={cy - r * 0.18}
        width={r * 0.36}
        height={r * 0.36}
        rx={r * 0.04}
        fill="#0e0c18"
      />
    </g>
  );
}

/** Ore palette for the conveyor cargo: top / left / right face colours. */
const ORE_FACES = {
  gold: ['#fde68a', '#d97706', '#f59e0b'],
  amethyst: ['#c4b5fd', '#7c5ce0', '#a78bfa'],
  diamond: ['#a5f3fc', '#0e7490', '#22d3ee'],
  redstone: ['#fca5a5', '#b91c1c', '#ef4444'],
  iron: ['#e5e7eb', '#6b7280', '#9ca3af'],
  emerald: ['#86efac', '#15803d', '#22c55e'],
} as const;

/** One marquee period of the belt — equal to the clip width, so when the
    animation snaps back by exactly this much, the wrap is invisible even
    though the cargo is irregularly spaced. */
const BELT_PERIOD = 1184;

/** [pattern offset, ore, half-width, depth] — clustered and gapped by hand
    (pairs, stragglers, empty stretches) instead of an even parade. */
const BELT_ITEMS: Array<[number, keyof typeof ORE_FACES, number, number]> = [
  [12, 'gold', 18, 12],
  [76, 'diamond', 14, 10],
  [128, 'amethyst', 20, 14],
  [330, 'iron', 16, 12],
  [402, 'redstone', 14, 11],
  [620, 'gold', 22, 15],
  [700, 'emerald', 15, 10],
  [748, 'diamond', 18, 13],
  [952, 'amethyst', 16, 11],
  [1060, 'redstone', 20, 14],
];

export function TechScene() {
  return (
    <g>
      <rect width="1920" height="1080" fill="url(#rfbd-tech-air)" />

      {/* Blocky factory skyline with a working smokestack. */}
      <polygon
        points="0,520 0,380 180,380 180,300 260,300 260,430 520,430 520,340 640,340 640,470 900,470 900,520 900,932 0,932"
        fill="#1e1836"
        opacity="0.9"
      />
      <rect x="700" y="180" width="70" height="290" fill="#1e1836" opacity="0.9" />
      <rect x="692" y="168" width="86" height="18" fill="#282050" opacity="0.9" />
      {/* Puffs sit centred on the stack with their bottoms at the mouth;
          rf-bd-steam scales from bottom-centre, so they grow out of the
          chimney instead of popping in mid-air. */}
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          className="rf-bd-steam"
          x={735 - (26 + i * 8) / 2}
          y={170 - (26 + i * 8)}
          width={26 + i * 8}
          height={26 + i * 8}
          rx="4"
          fill="#aab4d4"
          style={
            {
              animationDuration: `${6 + i * 1.4}s`,
              animationDelay: `${-i * 2.3}s`,
            } as CSSProperties
          }
        />
      ))}

      {/* The great flywheel, half sunk behind the machines. */}
      {gear('fly', 1560, 460, 220, 12, 70, '#191430', '#3d3663')}
      {/* Five-gear train down the left wall. Meshing is geometry, not luck:
          centres sit ≈1.09·(r₁+r₂) apart so teeth interleave without the
          bodies touching, tooth counts keep the pitch near 2πr/n ≈ 40 for
          every wheel, spin period scales with radius (0.217·r) so rim speeds
          match, and direction alternates down the chain. */}
      {gear('g1', 398, 484, 54, 8, 11.7, '#1c1633', '#494077')}
      {gear('g2', 492, 604, 86, 13, 18.7, '#1c1633', '#494077', true)}
      {gear('g3', 641, 556, 58, 9, 12.6, '#1c1633', '#494077')}
      {gear('g4', 728, 656, 64, 10, 13.9, '#1c1633', '#494077', true)}
      {gear('g5', 835, 606, 44, 7, 9.5, '#1c1633', '#494077')}

      {/* Machine blocks, with vents and status lights on their faces. */}
      {column('m1', 300, 700, 90, 45, 260, '#241d3f', '#151027', '#1c1633')}
      {column('m2', 1150, 740, 70, 35, 220, '#241d3f', '#151027', '#1c1633')}
      {column('m3', 1750, 690, 84, 42, 270, '#241d3f', '#151027', '#1c1633')}
      {(
        [
          [316, 796],
          [1164, 830],
          [1768, 790],
        ] as const
      ).map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="34" height="7" fill="#332c56" />
          <rect x={x} y={y + 14} width="34" height="7" fill="#332c56" />
          <rect
            className="rf-bd-glint"
            x={x + 44}
            y={y + 2}
            width="8"
            height="8"
            fill={i === 1 ? '#67e8f9' : '#fbbf24'}
            style={{ animationDelay: `${-i * 1.4}s` } as CSSProperties}
          />
        </g>
      ))}
      {/* Energy cells glowing on two of them. */}
      {(
        [
          [300, 682, '#67e8f9', 'url(#rfbd-cyan-glow)'],
          [1750, 672, '#fbbf24', 'url(#rfbd-lava-glow)'],
        ] as const
      ).map(([x, y, dot, glow], i) => (
        <g key={i} className="rf-bd-lava">
          <circle cx={x} cy={y} r="54" fill={glow} />
          <rect x={x - 16} y={y - 10} width="32" height="20" rx="3" fill={dot} opacity="0.85" />
        </g>
      ))}

      {/* The conveyor — one horizontal belt hauling raw ore across the hall. */}
      <g>
        <rect x="390" y="816" width="16" height="116" fill="#1a1530" />
        <rect x="1520" y="816" width="16" height="116" fill="#1a1530" />
        <rect x="360" y="790" width="1200" height="26" rx="6" fill="#1a1530" />
        <line
          className="rf-bd-flow"
          x1="368"
          y1="816"
          x2="1552"
          y2="816"
          stroke="#494077"
          strokeWidth="5"
          strokeDasharray="20 20"
        />
        <clipPath id="rfbd-belt-clip">
          <rect x="368" y="726" width={BELT_PERIOD} height="66" />
        </clipPath>
        <g clipPath="url(#rfbd-belt-clip)">
          {BELT_ITEMS.map(([off, ore, hw, depth], i) => {
            const [top, left, right] = ORE_FACES[ore];
            // Bottoms pinned to the belt surface regardless of block size.
            const yTop = 800 - hw / 2 - depth;
            return (
              <g key={i} className="rf-bd-belt-item">
                {column(`ore${i}a`, 368 + off, yTop, hw, hw / 2, depth, top, left, right)}
                {column(
                  `ore${i}b`,
                  368 + off - BELT_PERIOD,
                  yTop,
                  hw,
                  hw / 2,
                  depth,
                  top,
                  left,
                  right,
                )}
              </g>
            );
          })}
        </g>
      </g>

      {/* A piston keeping the rhythm, venting square steam on the stroke. */}
      <g>
        <rect
          x="1380"
          y="744"
          width="76"
          height="196"
          rx="4"
          fill="#241d3f"
          stroke="#332c56"
          strokeWidth="2"
        />
        <g className="rf-bd-piston">
          <rect x="1370" y="694" width="96" height="22" rx="3" fill="#57497f" />
          {[1376, 1452].map((bx) => (
            <rect key={bx} x={bx - 2} y="698" width="6" height="6" fill="#8b7fc0" />
          ))}
          <rect x="1408" y="716" width="20" height="48" fill="#332c56" />
        </g>
        {[0, 1].map((i) => (
          <rect
            key={i}
            className="rf-bd-steam"
            x={1352 - i * 12}
            y={724}
            width={20 + i * 8}
            height={20 + i * 8}
            rx="3"
            fill="#aab4d4"
            style={
              {
                animationDuration: `${5 + i * 1.7}s`,
                animationDelay: `${-i * 2.6}s`,
              } as CSSProperties
            }
          />
        ))}
      </g>

      {/* Tiled floor. */}
      <rect y="932" width="1920" height="148" fill="#120e20" />
      <line x1="0" y1="932" x2="1920" y2="932" stroke="#2b2350" strokeWidth="3" />
      {[160, 320, 480, 640, 800, 960, 1120, 1280, 1440, 1600, 1760].map((x) => (
        <line key={x} x1={x} y1="936" x2={x} y2="1080" stroke="#1c1631" strokeWidth="2" />
      ))}
    </g>
  );
}
