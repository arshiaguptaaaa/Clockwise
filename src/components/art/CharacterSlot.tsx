import Image from "next/image";
import { CHARACTERS } from "@/lib/characters";

// Renders a registered, licensed character, or nothing. Never a stand-in.
export function CharacterSlot({ name, className }: { name: string; className?: string }) {
  const asset = CHARACTERS[name];
  if (!asset) return null;
  return <Image src={asset.src} alt={asset.alt} width={asset.width} height={asset.height} className={className} />;
}
