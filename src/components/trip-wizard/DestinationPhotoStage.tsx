"use client";

import Image from "next/image";

export type StagePhoto = { key: string; src: string; label: string; credit: string; objectPosition?: string };

// Photography that arrives as you type and then stays as part of the page.
// Preview (typing): one small tilted arch drifts in beside the heading.
// Selected: the chosen places' photos grow, overlap and settle — up to three,
// staggered — with the place name set in the display face. It lives inside
// the single centred column; it is never a split screen or a backdrop.
export function DestinationPhotoStage({
  preview,
  selected,
}: {
  preview: StagePhoto | null;
  selected: StagePhoto[];
}) {
  const shown = selected.slice(-3);
  const hasSelection = shown.length > 0;
  const lead = shown[shown.length - 1];
  const previewing = preview && !(hasSelection && preview.key === lead?.key);

  return (
    <div className="relative shrink-0" aria-hidden={!hasSelection && !previewing}>
      <div className={`relative transition-all duration-500 ease-out ${hasSelection ? "h-56 w-40" : "h-36 w-28"}`}>
        {shown.map((p, i) => {
          const fromFront = shown.length - 1 - i;
          return (
            <div
              key={p.key}
              className="photo-in absolute overflow-hidden rounded-t-[999px] rounded-b-2xl bg-surface-muted shadow-[0_18px_36px_-18px_rgba(20,24,26,0.5)] transition-all duration-500"
              style={{
                width: `${100 - fromFront * 14}%`,
                height: `${100 - fromFront * 12}%`,
                right: `${fromFront * 22}%`,
                bottom: 0,
                zIndex: 10 - fromFront,
                ["--tilt" as string]: `${fromFront % 2 === 0 ? -3 : 4}deg`,
                transform: `rotate(${fromFront % 2 === 0 ? -3 : 4}deg)`,
              }}
            >
              <Image src={p.src} alt="" fill sizes="320px" className="object-cover" style={{ objectPosition: p.objectPosition ?? "50% 50%" }} />
            </div>
          );
        })}

        {previewing && (
          <div
            key={preview.key}
            className="photo-in absolute inset-0 overflow-hidden rounded-t-[999px] rounded-b-2xl bg-surface-muted shadow-[0_18px_36px_-18px_rgba(20,24,26,0.5)]"
            style={{ ["--tilt" as string]: "3deg", transform: "rotate(3deg)", zIndex: 20, opacity: hasSelection ? 0.95 : 1 }}
          >
            <Image src={preview.src} alt="" fill sizes="320px" className="object-cover" style={{ objectPosition: preview.objectPosition ?? "50% 50%" }} />
          </div>
        )}
      </div>

      {(previewing || hasSelection) && (
        <p className="mt-2 w-40 text-right text-[10px] leading-tight text-muted-foreground">
          <span className="font-display text-xs italic text-foreground">{(previewing ? preview : lead)?.label}</span>
          <br />
          Photo: {(previewing ? preview : lead)?.credit}
        </p>
      )}
    </div>
  );
}
