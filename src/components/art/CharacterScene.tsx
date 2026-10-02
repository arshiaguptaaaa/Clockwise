import Image from "next/image";
import { SCENES, faceSrc, type SceneKey } from "@/lib/characters";

// A character moment: the illustration set as a rounded, white-edged print
// resting on the page, with a very small float. Decorative — never part of
// any interaction.
export function CharacterScene({
  scene,
  className = "",
  tilt = 3,
  sizes = "160px",
  priority = false,
  eager = false,
}: {
  scene: SceneKey;
  className?: string;
  tilt?: number;
  sizes?: string;
  priority?: boolean;
  // Load immediately even when off-screen/hidden — for crossfaded stacks.
  eager?: boolean;
}) {
  const asset = SCENES[scene];
  return (
    <div className={`character-float ${className}`} style={{ rotate: `${tilt}deg` }} aria-hidden>
      <div className="overflow-hidden rounded-[22px] border-[3px] border-white bg-white shadow-[0_14px_30px_-12px_rgba(20,24,26,0.45)]">
        <Image src={asset.src} alt="" width={asset.width} height={asset.height} sizes={sizes} priority={priority} loading={eager || priority ? "eager" : "lazy"} className="block h-auto w-full" />
      </div>
    </div>
  );
}

// A round, cropped face from the portrait sheet. Stylised and non-realistic
// by design; chosen by index, never by name.
export function Face({ index, className = "size-12" }: { index: number; className?: string }) {
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-full border-2 border-white bg-surface-muted shadow-sm ${className}`}>
      <Image src={faceSrc(index)} alt="" fill sizes="64px" className="object-cover" />
    </span>
  );
}

// Occasional, hand-placed — a tiny line, not a chat UI. Fades and lifts in.
export function SpeechBubble({
  children,
  className = "",
  tail = "bottom-left",
}: {
  children: React.ReactNode;
  className?: string;
  tail?: "bottom-left" | "bottom-right" | "left" | "right" | "top-right";
}) {
  const tailPos = {
    "bottom-left": "-bottom-1.5 left-5",
    "bottom-right": "-bottom-1.5 right-5",
    left: "top-3 -left-1.5",
    right: "top-3 -right-1.5",
    "top-right": "-top-1.5 right-5",
  }[tail];
  return (
    <p
      className={`bubble-in ${className.includes("absolute") ? "" : "relative"} inline-block max-w-[11rem] rounded-2xl bg-white px-3 py-1.5 font-display text-[13px] italic leading-snug text-foreground shadow-[0_8px_20px_-8px_rgba(20,24,26,0.35)] ring-1 ring-border ${className}`}
    >
      {children}
      <span aria-hidden className={`absolute size-3 rotate-45 bg-white ring-1 ring-border ${tail === "top-right" ? "[clip-path:polygon(0_0,100%_0,0_100%)]" : "[clip-path:polygon(0_0,100%_100%,0_100%)]"} ${tailPos}`} />
    </p>
  );
}
