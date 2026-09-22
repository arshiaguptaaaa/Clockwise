"use client";

import Link from "next/link";
import type { ReactNode } from "react";

function fireBeacon(event: string) {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params.set("event", event);
  fetch(`/api/track?${params.toString()}`, {
    method: "POST",
    keepalive: true,
  }).catch(() => {
    // Analytics must never block or break navigation.
  });
}

export function TrackedLink({
  href,
  event,
  className,
  children,
}: {
  href: string;
  event: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} onClick={() => fireBeacon(event)} className={className}>
      {children}
    </Link>
  );
}
