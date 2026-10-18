// Shown by the service worker when a page navigation fails because the device is offline. Static: no data, no DB.
import Link from "next/link";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-[34px]" aria-hidden>◷</p>
      <h1 className="font-display text-[26px] leading-tight">You&apos;re offline.</h1>
      <p className="text-[14px] text-muted-foreground">Clockwise needs a connection to show live trip changes. Your trip and votes are safe on the server. Reconnect and this page will pick up where you left off.</p>
      <Link href="/" className="btn btn-primary mt-2">Try again</Link>
    </main>
  );
}
