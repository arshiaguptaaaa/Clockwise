// Original Bengaluru-inspired spot illustrations. Drawn for Clockwise (no third-party artwork):
// flat colour blocks, one ink outline weight, small squiggles, the same visual language as the
// character set, so the two sit together. Each scene is a self-contained rounded tile (260x204).
// They mark emotional moments in the product (arriving, delayed, waiting, converging, ready,
// empty). Real places, hotels and cafés always use real photography and provider data instead.
import type { ReactNode } from "react";

export type BengaluruScene = "vidhana" | "auto" | "coffee" | "rain" | "arrive" | "cafe" | "converge" | "waiting" | "saved" | "ready";

const INK = "#14181a";
const PINK = "#f08cb8";
const YELLOW = "#f4c430";
const BLUE = "#2f5fe0";
const ORANGE = "#f28a2e";
const GREEN = "#1d8a4f";
const DEEP = "#1e4b3a";
const CREAM = "#f6ecd6";
const RED = "#d9342b";
const SW = 3; // the one ink weight

const stroke = { stroke: INK, strokeWidth: SW, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const squig = (x: number, y: number, n = 3, w = 8, col = INK) => <path key={`${x}${y}`} d={`M${x} ${y} ${Array.from({ length: n }, (_, i) => `q${w / 2} ${i % 2 ? 5 : -5} ${w} 0`).join(" ")}`} fill="none" stroke={col} strokeWidth={2.2} strokeLinecap="round" />;
const spark = (x: number, y: number, s = 6, col = INK) => <path key={`s${x}${y}`} d={`M${x} ${y - s} v${s * 2} M${x - s} ${y} h${s * 2}`} stroke={col} strokeWidth={2.2} strokeLinecap="round" />;
const cloud = (x: number, y: number, s = 1) => <path key={`c${x}${y}`} d={`M${x} ${y} q${-6 * s} ${-2 * s} ${-3 * s} ${-9 * s} q${6 * s} ${-9 * s} ${16 * s} ${-3 * s} q${7 * s} ${-9 * s} ${17 * s} ${-1 * s} q${12 * s} ${-1 * s} ${8 * s} ${13 * s} z`} fill="#fff" {...stroke} strokeWidth={2.4} />;

const SCENES: Record<BengaluruScene, { bg: string; draw: () => ReactNode }> = {
  // Vidhana Soudha: the domed state legislature building, columns on a stepped portico.
  vidhana: {
    bg: YELLOW,
    draw: () => (
      <>
        {cloud(40, 52, 1.1)}
        {cloud(190, 40, 0.9)}
        {spark(218, 78, 5)}
        <rect x="0" y="168" width="260" height="36" fill={GREEN} />
        {/* wings */}
        <rect x="26" y="112" width="208" height="58" fill={CREAM} {...stroke} />
        {[44, 66, 88, 156, 178, 200].map((x) => (
          <rect key={x} x={x} y="126" width="12" height="22" rx="6" fill={DEEP} {...stroke} strokeWidth={2} />
        ))}
        {/* central block + pediment */}
        <rect x="92" y="94" width="76" height="76" fill={CREAM} {...stroke} />
        <path d="M86 94 L130 70 L174 94 Z" fill={ORANGE} {...stroke} />
        {/* columns */}
        {[100, 114, 128, 142, 156].map((x) => (
          <rect key={x} x={x} y="100" width="7" height="62" fill="#fff" {...stroke} strokeWidth={2} />
        ))}
        {/* dome */}
        <path d="M108 70 q22 -50 44 0 z" fill={PINK} {...stroke} />
        <rect x="124" y="30" width="12" height="14" fill={CREAM} {...stroke} strokeWidth={2} />
        <path d="M130 30 v-16" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M130 14 l16 5 l-16 5 z" fill={RED} {...stroke} strokeWidth={2} />
        {/* steps */}
        <rect x="84" y="170" width="92" height="8" fill="#fff" {...stroke} strokeWidth={2.4} />
        <rect x="74" y="178" width="112" height="8" fill="#fff" {...stroke} strokeWidth={2.4} />
        {squig(20, 196, 3, 8, DEEP)}
        {squig(214, 196, 3, 8, DEEP)}
      </>
    ),
  },
  // An auto-rickshaw, side on: one front wheel, a yellow canopy, open sides, a black body.
  auto: {
    bg: PINK,
    draw: () => (
      <>
        {squig(26, 56, 4, 8)}
        {spark(218, 48, 6)}
        <rect x="0" y="166" width="260" height="38" fill={INK} opacity="0.12" />
        {/* canopy */}
        <path d="M84 62 h92 q26 0 34 34 h-132 z" fill={YELLOW} {...stroke} />
        <path d="M84 62 l-14 38" {...stroke} />
        {/* roof posts */}
        <path d="M96 96 v36 M186 96 v36" {...stroke} strokeWidth={2.6} />
        {/* seat inside */}
        <rect x="108" y="104" width="70" height="26" rx="6" fill={RED} {...stroke} strokeWidth={2.4} />
        {/* windscreen */}
        <path d="M84 62 l-14 38 l-2 4 h30 z" fill="#cfe6ff" {...stroke} strokeWidth={2.4} />
        {/* black body */}
        <path d="M66 112 h128 q22 0 24 18 v10 h-168 v-6 q0 -16 16 -22 z" fill={INK} {...stroke} />
        {/* headlight and front wheel */}
        <circle cx="62" cy="122" r="6" fill={YELLOW} {...stroke} strokeWidth={2.4} />
        <path d="M60 140 q24 -22 48 0" fill={INK} {...stroke} />
        <circle cx="84" cy="150" r="17" fill="#fff" {...stroke} />
        <circle cx="84" cy="150" r="6" fill={INK} />
        {/* rear wheel */}
        <circle cx="190" cy="150" r="18" fill="#fff" {...stroke} />
        <circle cx="190" cy="150" r="6" fill={INK} />
        {squig(196, 184, 4, 9)}
      </>
    ),
  },
  // South Indian filter coffee: steel tumbler in a davara.
  coffee: {
    bg: ORANGE,
    draw: () => (
      <>
        {squig(100, 44, 2, 10)}
        {squig(128, 34, 2, 10)}
        {squig(156, 44, 2, 10)}
        {spark(52, 70, 6)}
        {spark(214, 78, 5)}
        {/* davara (saucer bowl) */}
        <path d="M54 134 q76 56 152 0 z" fill="#e9eef0" {...stroke} />
        <path d="M64 142 q66 26 132 0" fill="none" stroke={INK} strokeWidth={2} opacity="0.35" />
        {/* tumbler */}
        <path d="M92 74 h76 l-6 62 h-64 z" fill="#d8dee2" {...stroke} />
        <rect x="90" y="68" width="80" height="12" rx="6" fill="#f3f6f7" {...stroke} />
        <path d="M104 88 v36" stroke="#fff" strokeWidth={5} strokeLinecap="round" opacity="0.9" />
        {/* coffee foam */}
        <ellipse cx="130" cy="76" rx="28" ry="5" fill="#8a5a3a" />
        {/* beans */}
        <ellipse cx="46" cy="150" rx="9" ry="6" fill={INK} transform="rotate(-25 46 150)" />
        <path d="M38 152 q8 -4 16 -4" stroke={ORANGE} strokeWidth={2} fill="none" />
        <ellipse cx="216" cy="158" rx="9" ry="6" fill={INK} transform="rotate(20 216 158)" />
        <path d="M208 156 q8 4 16 0" stroke={ORANGE} strokeWidth={2} fill="none" />
      </>
    ),
  },
  // Bengaluru rain: umbrella, drops, a leaf.
  rain: {
    bg: BLUE,
    draw: () => (
      <>
        {[36, 70, 108, 148, 186, 222].map((x, i) => (
          <path key={x} d={`M${x} ${28 + (i % 2) * 14} l-6 16`} stroke="#fff" strokeWidth={3} strokeLinecap="round" />
        ))}
        {[54, 92, 130, 168, 204].map((x, i) => (
          <path key={x} d={`M${x} ${150 + (i % 2) * 10} l-5 12`} stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity="0.8" />
        ))}
        {/* umbrella */}
        <path d="M62 100 q68 -86 136 0 q-17 -12 -34 0 q-17 -12 -34 0 q-17 -12 -34 0 q-17 -12 -34 0 z" fill={PINK} {...stroke} />
        <path d="M130 56 q-24 12 -34 44 M130 56 q24 12 34 44" fill="none" stroke={INK} strokeWidth={2.4} />
        <path d="M96 100 q10 -26 34 -44 q-14 24 -2 44 z" fill={YELLOW} opacity="0.95" />
        <path d="M130 100 v52 q0 14 -14 14" fill="none" {...stroke} />
        {/* leaf */}
        <path d="M200 176 q22 -34 40 -6 q-22 14 -40 6 z" fill={GREEN} {...stroke} strokeWidth={2.4} />
        <ellipse cx="96" cy="184" rx="38" ry="7" fill="#fff" opacity="0.35" />
      </>
    ),
  },
  // Arriving: a plane, a dashed trail, luggage.
  arrive: {
    bg: GREEN,
    draw: () => (
      <>
        {cloud(54, 66, 1)}
        {spark(214, 44, 6, "#fff")}
        <path d="M30 150 q70 -110 170 -84" fill="none" stroke="#fff" strokeWidth={3} strokeDasharray="2 9" strokeLinecap="round" />
        {/* plane */}
        <g transform="translate(206 62) rotate(-18)">
          <path d="M-34 0 q0 -9 12 -9 h40 q16 0 22 9 q-6 9 -22 9 h-40 q-12 0 -12 -9 z" fill="#fff" {...stroke} />
          <path d="M-6 -9 l-14 -22 h12 l20 22 z" fill={PINK} {...stroke} strokeWidth={2.4} />
          <path d="M-6 9 l-14 22 h12 l20 -22 z" fill={PINK} {...stroke} strokeWidth={2.4} />
          <path d="M-34 -4 l-8 -14 h10 l8 14 z" fill={YELLOW} {...stroke} strokeWidth={2.4} />
          <circle cx="14" cy="-1" r="2.4" fill={INK} />
          <circle cx="4" cy="-1" r="2.4" fill={INK} />
        </g>
        {/* suitcase */}
        <rect x="70" y="124" width="84" height="56" rx="8" fill={YELLOW} {...stroke} />
        <path d="M96 124 v-12 q0 -6 6 -6 h24 q6 0 6 6 v12" fill="none" {...stroke} />
        <path d="M70 148 h84" stroke={INK} strokeWidth={2.4} />
        <rect x="104" y="142" width="16" height="12" rx="3" fill="#fff" {...stroke} strokeWidth={2.4} />
        <circle cx="84" cy="186" r="4" fill={INK} />
        <circle cx="140" cy="186" r="4" fill={INK} />
        {squig(176, 168, 4, 8, "#fff")}
      </>
    ),
  },
  // A café table: cup, croissant, plant.
  cafe: {
    bg: PINK,
    draw: () => (
      <>
        {squig(86, 54, 2, 10)}
        {squig(114, 44, 2, 10)}
        {spark(204, 58, 6)}
        <rect x="0" y="150" width="260" height="54" fill={YELLOW} />
        <path d="M0 150 h260" stroke={INK} strokeWidth={SW} />
        {/* cup */}
        <path d="M70 92 h74 v22 q0 30 -37 30 q-37 0 -37 -30 z" fill="#fff" {...stroke} />
        <path d="M144 100 q22 0 22 14 q0 14 -22 14" fill="none" {...stroke} />
        <ellipse cx="107" cy="92" rx="37" ry="7" fill="#8a5a3a" {...stroke} strokeWidth={2.4} />
        <ellipse cx="107" cy="150" rx="52" ry="8" fill={CREAM} {...stroke} strokeWidth={2.4} />
        {/* croissant */}
        <path d="M168 148 q-4 -38 38 -38 q40 0 34 38 q-12 -16 -34 -16 q-22 0 -38 16 z" fill={ORANGE} {...stroke} />
        <path d="M188 120 l6 26 M206 114 l0 22 M224 120 l-6 26" stroke={INK} strokeWidth={2} strokeLinecap="round" />
        {/* plant */}
        <path d="M30 150 v-28" stroke={INK} strokeWidth={3} />
        <path d="M30 128 q-18 -4 -18 -22 q18 2 18 22 z" fill={GREEN} {...stroke} strokeWidth={2.2} />
        <path d="M30 118 q18 -2 20 -20 q-20 2 -20 20 z" fill={GREEN} {...stroke} strokeWidth={2.2} />
      </>
    ),
  },
  // Everyone converging on one place from different directions.
  converge: {
    bg: CREAM,
    draw: () => (
      <>
        <path d="M44 48 Q96 70 124 118" fill="none" stroke={INK} strokeWidth={2.6} strokeDasharray="1 8" strokeLinecap="round" />
        <path d="M216 44 Q170 72 136 116" fill="none" stroke={INK} strokeWidth={2.6} strokeDasharray="1 8" strokeLinecap="round" />
        <path d="M44 166 Q92 150 118 134" fill="none" stroke={INK} strokeWidth={2.6} strokeDasharray="1 8" strokeLinecap="round" />
        <path d="M218 168 Q172 152 142 134" fill="none" stroke={INK} strokeWidth={2.6} strokeDasharray="1 8" strokeLinecap="round" />
        {/* four people as heads */}
        {[
          { x: 36, y: 40, c: PINK },
          { x: 224, y: 36, c: YELLOW },
          { x: 34, y: 168, c: BLUE },
          { x: 226, y: 170, c: ORANGE },
        ].map((p) => (
          <g key={p.x}>
            <circle cx={p.x} cy={p.y} r="16" fill={p.c} {...stroke} />
            <circle cx={p.x - 5} cy={p.y - 2} r="1.8" fill={INK} />
            <circle cx={p.x + 5} cy={p.y - 2} r="1.8" fill={INK} />
            <path d={`M${p.x - 5} ${p.y + 5} q5 4 10 0`} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
          </g>
        ))}
        {/* the stay */}
        <path d="M100 124 L130 100 L160 124 z" fill={ORANGE} {...stroke} />
        <rect x="106" y="124" width="48" height="34" fill="#fff" {...stroke} />
        <rect x="124" y="136" width="12" height="22" rx="2" fill={DEEP} {...stroke} strokeWidth={2.2} />
        <rect x="112" y="130" width="8" height="8" fill={YELLOW} {...stroke} strokeWidth={2} />
        <rect x="140" y="130" width="8" height="8" fill={YELLOW} {...stroke} strokeWidth={2} />
        {spark(130, 78, 6)}
      </>
    ),
  },
  // Waiting: a clock face with a patient expression.
  waiting: {
    bg: BLUE,
    draw: () => (
      <>
        {squig(30, 52, 3, 8, "#fff")}
        {spark(222, 48, 6, "#fff")}
        {spark(48, 164, 5, "#fff")}
        <circle cx="130" cy="104" r="62" fill="#fff" {...stroke} />
        <circle cx="130" cy="104" r="50" fill={CREAM} stroke={INK} strokeWidth={2} />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return <path key={i} d={`M${130 + Math.sin(a) * 44} ${104 - Math.cos(a) * 44} L${130 + Math.sin(a) * 50} ${104 - Math.cos(a) * 50}`} stroke={INK} strokeWidth={2.4} strokeLinecap="round" />;
        })}
        <path d="M130 104 L130 70" {...stroke} />
        <path d="M130 104 L152 116" {...stroke} />
        <circle cx="130" cy="104" r="4" fill={INK} />
        {/* eyes */}
        <circle cx="112" cy="94" r="3" fill={INK} />
        <circle cx="148" cy="94" r="3" fill={INK} />
        <path d="M118 126 q12 8 24 0" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
        {/* feet */}
        <path d="M92 162 l-8 22 M168 162 l8 22" {...stroke} />
        <path d="M30 184 h24 M206 184 h24" {...stroke} strokeWidth={2.4} />
      </>
    ),
  },
  // Empty saved: a heart waiting to be filled.
  saved: {
    bg: YELLOW,
    draw: () => (
      <>
        {spark(46, 56, 7)}
        {spark(220, 66, 6)}
        {squig(34, 160, 4, 8)}
        {squig(190, 172, 4, 8)}
        <path d="M130 170 C60 128 70 66 106 66 C122 66 130 78 130 78 C130 78 138 66 154 66 C190 66 200 128 130 170 Z" fill={PINK} {...stroke} />
        <path d="M104 84 q-8 4 -10 16" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" />
        <path d="M168 40 l10 -14 M188 54 l14 -8" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      </>
    ),
  },
  // Ready: a tick, confetti, a boarding-pass strip.
  ready: {
    bg: GREEN,
    draw: () => (
      <>
        {squig(30, 52, 3, 8, "#fff")}
        {squig(190, 40, 3, 8, YELLOW)}
        {spark(222, 92, 6, "#fff")}
        {spark(40, 150, 6, YELLOW)}
        <circle cx="130" cy="98" r="52" fill={YELLOW} {...stroke} />
        <path d="M104 100 l18 18 l36 -40" fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
        <rect x="64" y="162" width="132" height="24" rx="6" fill="#fff" {...stroke} />
        <path d="M150 162 v24" stroke={INK} strokeWidth={2} strokeDasharray="3 4" />
        <path d="M76 174 h56" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        <circle cx="172" cy="174" r="5" fill={PINK} {...stroke} strokeWidth={2} />
      </>
    ),
  },
};

export function BengaluruArt({ scene, className = "", rounded = true }: { scene: BengaluruScene; className?: string; rounded?: boolean }) {
  const s = SCENES[scene];
  return (
    <svg viewBox="0 0 260 204" role="img" aria-hidden="true" className={`block h-auto ${/(^|\s)w-/.test(className) ? "" : "w-full"} ${className}`} style={{ borderRadius: rounded ? 22 : 0 }}>
      <rect width="260" height="204" fill={s.bg} />
      {s.draw()}
    </svg>
  );
}
