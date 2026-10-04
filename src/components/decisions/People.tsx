"use client";

import { Face } from "@/components/art/CharacterScene";
import { faceIndexForId } from "@/lib/characters";

export const firstName = (name: string) => name.split(" ")[0];

// A traveller, as a face. Used wherever the product says who, not how many.
export function PersonFace({ userId, name, className = "size-6" }: { userId: string; name: string; className?: string }) {
  return <Face index={faceIndexForId(userId || name)} className={className} />;
}

// Overlapping faces with a "+N" tail, for headers.
export function FaceStack({ people, max = 4, className = "size-7" }: { people: { userId: string; name: string }[]; max?: number; className?: string }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <span key={p.userId} className={`${i === 0 ? "" : "-ml-2"} rounded-full ring-2 ring-surface`} title={p.name}>
          <PersonFace userId={p.userId} name={p.name} className={className} />
        </span>
      ))}
      {extra > 0 && <span className="ml-1.5 text-[12px] font-medium text-muted-foreground">+{extra}</span>}
    </span>
  );
}
