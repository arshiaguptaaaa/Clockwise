"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CURATED_PHOTOS } from "@/lib/destination-photos";
import { CharacterScene, SpeechBubble } from "@/components/art/CharacterScene";
import type { SceneKey } from "@/lib/characters";

// Homepage destination order: deliberately global, alternating regions.
const ORDER = ["jaipur", "prague", "greenland", "vienna", "udaipur", "tokyo", "salzburg", "reykjavik"];
const SEQUENCE = ORDER.map((k) => CURATED_PHOTOS.find((p) => p.key === k)!).filter(Boolean);
const CYCLE_MS = 3200;

// The small human moment that goes with each place.
const MOMENT: Record<string, { scene: SceneKey; bubble: string; tilt: number }> = {
  jaipur: { scene: "highfive", bubble: "Everyone ready?", tilt: 4 },
  prague: { scene: "map", bubble: "Prague? I could be convinced.", tilt: -3 },
  greenland: { scene: "bicycle", bubble: "Is there signal out there?", tilt: 3 },
  vienna: { scene: "photography", bubble: "Five minutes, I swear.", tilt: -4 },
  udaipur: { scene: "celebrating", bubble: "Golden hour. Go.", tilt: 3 },
  tokyo: { scene: "airplane", bubble: "Who has the tickets?", tilt: -3 },
  salzburg: { scene: "suitcase", bubble: "Is that our train?", tilt: 4 },
  reykjavik: { scene: "memories", bubble: "Pack a warm jacket.", tilt: -3 },
};

// One floating photograph at a time, never a carousel: no dots, arrows or
// thumbnails. Every few seconds the next place crossfades in with a slightly
// different tilt/lift/crop, and the caption and the small live-coordination
// annotations change with it. Only the current and next images are mounted,
// so the page doesn't pull eight photographs up front. With reduced motion it
// holds on the first destination.
export function HeroPhotoStage({ children }: { children?: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  const [mounted, setMounted] = useState<Set<number>>(new Set([0, 1]));

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % SEQUENCE.length;
        setMounted((m) => new Set(m).add(next).add((next + 1) % SEQUENCE.length));
        return next;
      });
    }, CYCLE_MS);
    return () => clearInterval(t);
  }, []);

  const current = SEQUENCE[index];
  const moment = MOMENT[current.key];

  return (
    <figure className="relative mx-auto w-[74%] max-w-[360px] lg:ml-auto lg:mr-0 lg:w-full lg:max-w-[400px]">
      <div className="relative">
      <div
        className="relative aspect-[4/5] overflow-hidden rounded-t-[999px] rounded-b-[28px] bg-surface-muted shadow-[0_30px_60px_-30px_rgba(20,24,26,0.45)] transition-transform duration-[1400ms] ease-in-out"
        style={{ transform: `translateY(${current.lift}px) rotate(${current.tilt}deg)` }}
      >
        {SEQUENCE.map((p, i) =>
          mounted.has(i) ? (
            <Image
              key={p.key}
              src={p.src}
              alt={i === index ? p.alt : ""}
              aria-hidden={i !== index}
              fill
              sizes="(min-width: 1024px) 400px, 75vw"
              priority={i === 0}
              className={`object-cover transition-opacity duration-[1400ms] ease-in-out ${i === index ? "opacity-100" : "opacity-0"}`}
              style={{ objectPosition: p.objectPosition }}
            />
          ) : null
        )}
      </div>

      {/* Intelligence layer: tiny editorial annotations resting on the photograph */}
      <div
        key={current.key}
        aria-hidden
        className="annotation-in absolute -left-2 bottom-10 flex items-start gap-2 rounded-2xl border border-border bg-white/95 px-3 py-2 shadow-md backdrop-blur lg:-left-10"
      >
        <span className="relative mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accent">
          <span className="absolute h-1 w-px origin-bottom -translate-y-[2px] bg-accent" />
          <span className="absolute h-[3px] w-px origin-bottom translate-x-[1px] rotate-90 bg-accent" />
        </span>
        <span className="text-[11px] leading-snug text-foreground">
          <span className="block font-medium">{current.signals[0]}</span>
          <span className="block text-muted-foreground">{current.signals[1]}</span>
        </span>
      </div>

      {/* The human layer: a small illustrated moment that changes with the place */}
      <div className="absolute -bottom-5 right-[-6%] z-10 w-[34%] max-w-[150px] lg:-right-8">
        {/* All eight prints are stacked and crossfaded, so none ever pops in blank */}
        <div className="grid">
          {SEQUENCE.map((p) => {
            const m = MOMENT[p.key];
            const active = p.key === current.key;
            return (
              <div key={p.key} className={`col-start-1 row-start-1 transition-opacity duration-700 ${active ? "opacity-100" : "opacity-0"}`}>
                <CharacterScene scene={m.scene} tilt={m.tilt} sizes="150px" eager />
              </div>
            );
          })}
        </div>
        <SpeechBubble key={`b-${current.key}`} className="absolute -top-[3.25rem] right-1 z-10 w-max" tail="bottom-right">
          {moment.bubble}
        </SpeechBubble>
      </div>

      {children}
      </div>

      <figcaption className="mt-5">
        <div key={current.key} className="annotation-in">
          <p className="font-display text-2xl leading-none tracking-tight text-foreground">{current.label}</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{current.country}</p>
          <p className="mt-2 font-display text-sm italic text-accent">{current.tagline}</p>
        </div>
        <p className="mt-3 text-[10px] leading-tight text-muted-foreground">
          Photo:{" "}
          <a href={current.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
            {current.credit}
          </a>
          , <a href={current.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{current.license}</a>
        </p>
      </figcaption>
    </figure>
  );
}
