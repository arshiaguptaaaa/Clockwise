"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { TripMapProps } from "./types";

// Leaflet touches `window` at import time, so it can only ever load in the
// browser. This is the one place that boundary is drawn — every consumer
// just renders <TripMapLoader/> like a normal component.
const TripMap = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-xl bg-surface-muted">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  ),
});

export function TripMapLoader({ heightClassName = "h-64", ...props }: TripMapProps) {
  return (
    <div className={`w-full ${heightClassName}`}>
      <TripMap heightClassName="h-full" {...props} />
    </div>
  );
}
