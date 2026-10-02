"use client";

import Image from "next/image";

export type StagePhoto = { key: string; src: string; label: string; credit: string; objectPosition?: string };

// The unused middle of the page, put to work. Before anything is typed it
// holds rotating inspiration; while typing, the highlighted place's photograph
// arrives; once places are chosen their photographs settle in and overlap —
// up to three, staggered — so the page looks progressively built by the
// traveller. One continuous white canvas: no split screen, no backdrop.
export function DestinationPhotoStage({
  preview,
  selected,
  idle,
  children,
}: {
  preview: StagePhoto | null;
  selected: StagePhoto[];
  // Rotating inspiration shown only while nothing is typed or chosen.
  idle?: StagePhoto | null;
  // The human moment (character + bubble) that rests on the composition.
  children?: React.ReactNode;
}) {
  const shown = selected.slice(-3);
  const hasSelection = shown.length > 0;
  const lead = shown[shown.length - 1];
  const shownPreview = preview ?? (!hasSelection ? (idle ?? null) : null);
  const previewing = shownPreview && !(hasSelection && shownPreview.key === lead?.key) ? shownPreview : null;
  const caption = previewing ?? lead ?? null;

  return (
    <div className="relative mx-auto flex w-full flex-col items-center py-4">
      <div className="relative h-[17rem] w-[13.5rem]">
        {shown.map((p, i) => {
          const fromFront = shown.length - 1 - i;
          const tilt = fromFront % 2 === 0 ? -3 : 4;
          return (
            <div
              key={p.key}
              className="photo-in absolute overflow-hidden rounded-t-[999px] rounded-b-2xl bg-surface-muted shadow-[0_18px_36px_-18px_rgba(20,24,26,0.5)] transition-all duration-700 ease-out"
              style={{
                width: `${100 - fromFront * 14}%`,
                height: `${100 - fromFront * 12}%`,
                right: `${fromFront * 20}%`,
                bottom: 0,
                zIndex: 10 - fromFront,
                ["--tilt" as string]: `${tilt}deg`,
                transform: `rotate(${tilt}deg)`,
              }}
            >
              <Image src={p.src} alt="" fill sizes="480px" className="object-cover" style={{ objectPosition: p.objectPosition ?? "50% 50%" }} />
            </div>
          );
        })}

        {previewing && (
          <div
            key={previewing.key}
            className="photo-in absolute inset-0 overflow-hidden rounded-t-[999px] rounded-b-2xl bg-surface-muted shadow-[0_18px_36px_-18px_rgba(20,24,26,0.5)]"
            style={{ ["--tilt" as string]: "3deg", transform: "rotate(3deg)", zIndex: 20 }}
          >
            <Image src={previewing.src} alt="" fill sizes="480px" className="object-cover" style={{ objectPosition: previewing.objectPosition ?? "50% 50%" }} />
          </div>
        )}

        {children}
      </div>

      <div className="mt-4 min-h-[2.75rem] text-center">
        {caption && (
          <>
            <p className="font-display text-xl italic leading-none text-foreground">{caption.label}</p>
            <p className="mt-1 text-[10px] leading-tight text-muted-foreground">Photo: {caption.credit}</p>
          </>
        )}
      </div>
    </div>
  );
}
