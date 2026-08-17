import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { OverworldScene, NetherScene, CaveScene, TechScene } from './backdrop-scenes';

/**
 * The launcher's hero backdrop: four animated Minecraft moods — a drone
 * flight over a voxel map, a Nether forge, a mine with an amethyst geode,
 * and a tech-mod workshop — crossfaded on a slow cycle inside one shared
 * atmosphere (aurora, engineering grid, ember field, film grain).
 *
 * It is inline SVG rather than bundled images on purpose: an SVG referenced
 * through `background-image` is an isolated document that can see neither
 * the theme's CSS variables nor `prefers-reduced-motion`. Inlined, the same
 * markup restyles itself across all three themes and stands still (on the
 * first scene) for users who ask for that. Layer intensities and all
 * keyframes live in `styles/global.css` under the `rf-bd-` prefix; scene
 * artwork lives in `backdrop-scenes.tsx` / `voxel-terrain.tsx`.
 *
 * Every animation touches only `transform`, `opacity` or a dash offset, so
 * the scenes stay cheap. Particle delays are negative so each scene is
 * fully populated from its first frame instead of visibly "starting up".
 */

const SCENES = [OverworldScene, NetherScene, CaveScene, TechScene];
const HOLD_MS = 45_000;
const FADE_MS = 2_200;

interface ForgeBackdropProps {
  /** Atmosphere only — aurora, grid, embers, grain — with no scene
      rotation. Used on quieter pages (About) where a full diorama would
      compete with the content. */
  ambient?: boolean;
}

export function ForgeBackdrop({ ambient = false }: ForgeBackdropProps) {
  const [frontIdx, setFrontIdx] = useState(0);
  const [backIdx, setBackIdx] = useState<number | null>(null);
  const frontRef = useRef(0);
  frontRef.current = frontIdx;

  // With reduced motion the first scene simply stays; CSS already freezes
  // every animation, and a scene swap is itself motion.
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Stop animating when nothing can be seen. The default launch behaviour
  // minimises this window, so its normal state during a play session is
  // off-screen — and a full-viewport animated SVG that keeps compositing there
  // is spending the GPU on nobody, while the game it just started wants it.
  const [idle, setIdle] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setIdle(document.hidden || !document.hasFocus());
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  }, []);

  useEffect(() => {
    if (reduced || ambient || idle) return;
    const t = setInterval(
      () => setBackIdx((b) => b ?? (frontRef.current + 1) % SCENES.length),
      HOLD_MS,
    );
    return () => clearInterval(t);
  }, [reduced, ambient, idle]);

  useEffect(() => {
    if (backIdx === null) return;
    const t = setTimeout(() => {
      setFrontIdx(backIdx);
      setBackIdx(null);
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [backIdx]);

  const Front = SCENES[frontIdx];
  const Back = backIdx === null ? null : SCENES[backIdx];

  return (
    <div
      className="rf-backdrop pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      data-idle={idle}
      aria-hidden
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* Soft light sources; pure falloff here, intensity on the shapes. */}
          <radialGradient id="rfbd-aurora">
            <stop offset="0%" style={{ stopColor: 'var(--rf-accent)' }} stopOpacity="1" />
            <stop offset="45%" style={{ stopColor: 'var(--rf-accent)' }} stopOpacity="0.35" />
            <stop offset="100%" style={{ stopColor: 'var(--rf-accent)' }} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rfbd-aurora-indigo">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity="1" />
            <stop offset="45%" stopColor="#4f46e5" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rfbd-aurora-cyan">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="1" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
          </radialGradient>

          {/* Soft particle dots — gradient fills instead of blur filters,
              which would force a repaint per animated frame. */}
          <radialGradient id="rfbd-ember">
            <stop offset="0%" stopColor="#c4b5fd" />
            <stop offset="35%" style={{ stopColor: 'var(--rf-accent)' }} stopOpacity="0.9" />
            <stop offset="100%" style={{ stopColor: 'var(--rf-accent)' }} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rfbd-ember-warm">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="35%" stopColor="#f59e0b" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>

          {/* Engineering grid: fine cells with a heavier line each fifth. */}
          <pattern id="rfbd-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 H 0 V 48"
              fill="none"
              style={{ stroke: 'var(--rf-text-muted)' }}
              strokeWidth="1"
            />
          </pattern>
          <pattern id="rfbd-grid-major" width="240" height="240" patternUnits="userSpaceOnUse">
            <path
              d="M 240 0 H 0 V 240"
              fill="none"
              style={{ stroke: 'var(--rf-text-muted)' }}
              strokeWidth="1.5"
            />
          </pattern>
          {/* The grid lives along the top edge, above the scene horizon. */}
          <linearGradient id="rfbd-grid-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="30%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="55%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="rfbd-grid-mask">
            <rect width="1920" height="1080" fill="url(#rfbd-grid-fade)" />
          </mask>

          {/* Overworld terrain materialises along this horizon line. */}
          <linearGradient
            id="rfbd-horizon-fade"
            x1="0"
            y1="400"
            x2="0"
            y2="545"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          <mask id="rfbd-horizon">
            <rect width="1920" height="1080" fill="url(#rfbd-horizon-fade)" />
          </mask>

          {/* Lava, crystals, comets. */}
          <linearGradient id="rfbd-lava" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
          <radialGradient id="rfbd-lava-glow">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="rfbd-comet-tail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0" />
            <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.8" />
          </linearGradient>
          <radialGradient id="rfbd-comet-halo">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rfbd-crystal">
            <stop offset="0%" stopColor="#f0abfc" />
            <stop offset="100%" stopColor="#a855f7" />
          </radialGradient>
          <radialGradient id="rfbd-crystal-halo">
            <stop offset="0%" stopColor="#d946ef" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#d946ef" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rfbd-cyan-glow">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>

          {/* Scene atmospheres — slightly translucent so the aurora and the
              theme's base colour still breathe through. */}
          <linearGradient id="rfbd-nether-air" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#170d17" stopOpacity="0.92" />
            <stop offset="55%" stopColor="#2b1218" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#451c10" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="rfbd-cave-air" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0b101f" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#111a2e" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0a0f1c" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="rfbd-tech-air" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#141021" stopOpacity="0.93" />
            <stop offset="60%" stopColor="#1a1429" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0e0c18" stopOpacity="0.94" />
          </linearGradient>

          {/* Film grain: static, rendered once. Kills gradient banding, which
              is what makes big soft gradients read as "cheap". */}
          <filter id="rfbd-noise" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.8"
              numOctaves="2"
              stitchTiles="stitch"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.6  0 0 0 0.6 0"
            />
          </filter>

          <linearGradient id="rfbd-scrim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--rf-bg)' }} stopOpacity="0" />
            <stop offset="55%" style={{ stopColor: 'var(--rf-bg)' }} stopOpacity="0.25" />
            <stop offset="100%" style={{ stopColor: 'var(--rf-bg)' }} stopOpacity="0.88" />
          </linearGradient>
          <radialGradient id="rfbd-vignette" cx="0.5" cy="0.42" r="0.85">
            <stop offset="0%" style={{ stopColor: 'var(--rf-bg)' }} stopOpacity="0" />
            <stop offset="70%" style={{ stopColor: 'var(--rf-bg)' }} stopOpacity="0" />
            <stop offset="100%" style={{ stopColor: 'var(--rf-bg)' }} stopOpacity="0.5" />
          </radialGradient>
        </defs>

        <rect width="1920" height="1080" style={{ fill: 'var(--rf-bg)' }} />

        {/* Aurora field — three overlapping drifts on different clocks, so
            the sky never visibly repeats. */}
        <ellipse
          className="rf-bd-aurora-a"
          cx="1520"
          cy="-40"
          rx="980"
          ry="620"
          fill="url(#rfbd-aurora)"
          style={{ opacity: 'var(--bd-aurora-a)' }}
        />
        <ellipse
          className="rf-bd-aurora-b"
          cx="180"
          cy="1040"
          rx="900"
          ry="560"
          fill="url(#rfbd-aurora-indigo)"
          style={{ opacity: 'var(--bd-aurora-b)' }}
        />
        <ellipse
          className="rf-bd-aurora-c"
          cx="360"
          cy="60"
          rx="640"
          ry="420"
          fill="url(#rfbd-aurora-cyan)"
          style={{ opacity: 'var(--bd-aurora-c)' }}
        />

        <g mask="url(#rfbd-grid-mask)" style={{ opacity: 'var(--bd-grid)' }}>
          <rect width="1920" height="1080" fill="url(#rfbd-grid)" />
          <rect width="1920" height="1080" fill="url(#rfbd-grid-major)" opacity="0.8" />
        </g>

        {/* Scene double-buffer: the next scene fades in over the current
            one, then takes over the front slot with no visual change. */}
        {!ambient && (
          <g key={`f${frontIdx}`}>
            <Front />
          </g>
        )}
        {!ambient && Back && (
          <g key={`b${backIdx}`} className="rf-bd-scene-in">
            <Back />
          </g>
        )}

        {/* Every scene is painted in its own materials — basalt, deepslate,
            steel — and three of the four are dark whatever theme is running.
            In the light theme that put the launcher's own dark text on a dark
            picture: the line under the play button measured 1.3:1 over the
            Nether forge, and the announcement banner 1.7:1. This is the wash
            that keeps a light theme light; it is zero in the dark themes,
            where the scenes are already the right end of the scale. */}
        <rect
          width="1920"
          height="1080"
          style={{ fill: 'var(--rf-bg)', opacity: 'var(--bd-scene-wash)' }}
        />

        {/* Ambient ember field, over every scene. */}
        <g style={{ opacity: 'var(--bd-ember)' }}>
          {EMBERS.map((e, i) => (
            <g
              key={i}
              className="rf-bd-ember"
              style={
                {
                  animationDuration: `${e.dur}s`,
                  animationDelay: `${e.delay}s`,
                  '--rf-ember-peak': e.peak,
                } as CSSProperties
              }
            >
              <circle
                className="rf-bd-ember-dot"
                cx={e.x}
                cy={1110}
                r={e.r * 2.4}
                fill={e.warm ? 'url(#rfbd-ember-warm)' : 'url(#rfbd-ember)'}
                style={{ animationDuration: `${e.sway}s`, animationDelay: `${e.delay / 2}s` }}
              />
            </g>
          ))}
        </g>

        <rect
          width="1920"
          height="1080"
          filter="url(#rfbd-noise)"
          style={{ opacity: 'var(--bd-noise)', mixBlendMode: 'overlay' }}
        />
        <rect width="1920" height="1080" fill="url(#rfbd-vignette)" />
        <rect width="1920" height="1080" fill="url(#rfbd-scrim)" />
      </svg>
    </div>
  );
}

interface Ember {
  x: number;
  r: number;
  /** Rise duration in seconds; negative delay staggers the field. */
  dur: number;
  delay: number;
  /** Horizontal sway period in seconds. */
  sway: number;
  /** Peak opacity mid-flight. */
  peak: number;
  warm?: boolean;
}

/**
 * Hand-placed rather than randomised so every boot (and every screenshot)
 * composes the same way: denser toward the edges, sparse over the launch
 * column in the middle.
 */
const EMBERS: Ember[] = [
  { x: 1690, r: 4.5, dur: 18, delay: -3, sway: 6.5, peak: 0.9, warm: true },
  { x: 1560, r: 3, dur: 23, delay: -14, sway: 7.5, peak: 0.7 },
  { x: 1770, r: 2.5, dur: 26, delay: -9, sway: 5.5, peak: 0.6 },
  { x: 1470, r: 4, dur: 20, delay: -18, sway: 8, peak: 0.8, warm: true },
  { x: 1630, r: 2, dur: 28, delay: -22, sway: 6, peak: 0.5 },
  { x: 1840, r: 3.5, dur: 21, delay: -6, sway: 7, peak: 0.75 },
  { x: 1385, r: 2.5, dur: 25, delay: -11, sway: 6.8, peak: 0.55 },
  { x: 1210, r: 2, dur: 30, delay: -19, sway: 7.2, peak: 0.4 },
  { x: 240, r: 3, dur: 24, delay: -8, sway: 7, peak: 0.6 },
  { x: 120, r: 2, dur: 29, delay: -16, sway: 6.2, peak: 0.45 },
  { x: 390, r: 2.5, dur: 27, delay: -24, sway: 8.2, peak: 0.5, warm: true },
  { x: 520, r: 2, dur: 31, delay: -5, sway: 6.6, peak: 0.35 },
  { x: 760, r: 2, dur: 33, delay: -13, sway: 7.8, peak: 0.3 },
  { x: 1060, r: 2, dur: 32, delay: -27, sway: 6.4, peak: 0.3 },
];
