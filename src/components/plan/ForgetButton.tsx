"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { forgetPointerAction } from "@/app/idea-actions";

export function ForgetButton({ pointerId }: { pointerId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Forget this"
      onClick={() =>
        start(async () => {
          await forgetPointerAction(pointerId);
          router.refresh();
        })
      }
      className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[15px] text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-40"
    >
      ✕
    </button>
  );
}
