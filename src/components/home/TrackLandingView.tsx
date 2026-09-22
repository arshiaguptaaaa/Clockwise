"use client";

import { useEffect } from "react";

// Fires once per real page load — reads location.search directly rather
// than the useSearchParams() hook, so this needs no Suspense boundary and
// doesn't opt the otherwise-static homepage out of prerendering.
export function TrackLandingView() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("event", "landing_view");
    fetch(`/api/track?${params.toString()}`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }, []);

  return null;
}
