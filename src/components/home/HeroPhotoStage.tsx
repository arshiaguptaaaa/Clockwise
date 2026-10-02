"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CURATED_PHOTOS } from "@/lib/destination-photos";

const CYCLE_MS = 6500;

// One irregular, floating photograph — an arch, tilted slightly — that
// drifts between real destinations. Not a background: it sits in the
// composition with white space around it.
export function HeroPhotoStage({ children }: { children?: React.ReactNode }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % CURATED_PHOTOS.length), CYCLE_MS);
    return () => clearInterval(t);
  }, []);

  const current = CURATED_PHOTOS[index];

  return (
    <figure className="relative mx-auto w-[78%] max-w-[360px] lg:ml-auto lg:mr-0 lg:w-full lg:max-w-[400px]">
      <div className="photo-in relative aspect-[4/5] -rotate-2 overflow-hidden rounded-t-[999px] rounded-b-[28px] bg-surface-muted shadow-[0_30px_60px_-30px_rgba(20,24,26,0.45)]" style={{ ["--tilt" as string]: "-2deg" }}>
        {CURATED_PHOTOS.map((p, i) => (
          <Image
            key={p.key}
            src={p.src}
            alt={p.alt}
            fill
            sizes="(min-width: 1024px) 400px, 80vw"
            priority={i === 0}
            className={`object-cover transition-opacity duration-1000 ${i === index ? "opacity-100" : "opacity-0"}`}
            style={{ objectPosition: p.objectPosition }}
          />
        ))}
      </div>

      {/* Intelligence layer: a Clockwise object resting on the photograph */}
      <div className="absolute -left-3 bottom-10 flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 shadow-md lg:-left-10">
        <span className="relative flex size-5 items-center justify-center rounded-full border-2 border-accent">
          <span className="absolute h-1.5 w-px origin-bottom -translate-y-[3px] bg-accent" />
          <span className="absolute h-1 w-px origin-bottom translate-x-[1.5px] -translate-y-px rotate-90 bg-accent" />
        </span>
        <span className="text-xs font-medium text-foreground">3 clocks · 1 plan</span>
      </div>

      {children}

      <figcaption className="mt-5 flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="font-display text-sm italic text-foreground">{current.label}</span>
        <span className="truncate text-right">Photo: {current.credit}</span>
      </figcaption>
    </figure>
  );
}
