"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { CardStatus, CardType } from "@prisma/client";
import { Check, X } from "lucide-react";
import { CARD_VISUALS } from "./cardVisuals";
import { avatarColor } from "@/lib/avatar";

export type CardPerson = { id: string; name: string };

export type ActionButton = {
  label: string;
  pendingLabel?: string;
  run: () => Promise<void>;
};

export type ClockwiseActionCardProps = {
  type: CardType;
  title: string;
  context?: string;
  values?: { label: string; value: string }[];
  status: CardStatus;
  affectedTravellers?: CardPerson[];
  deadline?: string | null;
  primaryAction?: ActionButton;
  secondaryAction?: ActionButton;
  children?: ReactNode;
};

function useCountdown(deadline?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;
  const diffMs = new Date(deadline).getTime() - now;
  if (diffMs <= 0) return { expired: true, label: "Expired" };
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return { expired: false, label: `${minutes} min` };
  const hours = Math.round(minutes / 60);
  return { expired: false, label: `${hours} hr` };
}

export function ClockwiseActionCard({
  type,
  title,
  context,
  values,
  status,
  affectedTravellers,
  deadline,
  primaryAction,
  secondaryAction,
  children,
}: ClockwiseActionCardProps) {
  const visual = CARD_VISUALS[type];
  const Icon = visual.icon;
  const countdown = useCountdown(deadline);
  const [pending, startTransition] = useTransition();
  const [pendingWhich, setPendingWhich] = useState<"primary" | "secondary" | null>(null);

  const tintClasses =
    visual.tint === "accent"
      ? "bg-accent text-accent-foreground"
      : "bg-warning text-white";

  const showActions = status === "PENDING";

  function runAction(action: ActionButton, which: "primary" | "secondary") {
    setPendingWhich(which);
    startTransition(async () => {
      await action.run();
      setPendingWhich(null);
    });
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-surface px-4 py-3.5 sm:max-w-lg">
      <div className="flex items-start gap-3">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${tintClasses}`}>
          <Icon className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium text-accent-strong">Clockwise</span>
            <span className="text-[11px] text-muted-foreground">· {visual.label}</span>
            {status === "CONFIRMED" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-tint px-1.5 py-0.5 text-[10px] font-medium text-success">
                <Check className="size-2.5" /> Confirmed
              </span>
            )}
            {status === "DISMISSED" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <X className="size-2.5" /> Not now
              </span>
            )}
            {countdown && (
              <span
                className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  countdown.expired
                    ? "bg-danger-tint text-danger"
                    : "bg-warning-tint text-warning"
                }`}
              >
                {countdown.expired ? "Expired" : `Expires in ${countdown.label}`}
              </span>
            )}
          </div>

          <p className="mt-1 text-sm font-medium leading-snug text-foreground">
            {title}
          </p>
          {context && (
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
              {context}
            </p>
          )}

          {values && values.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {values.map((v) => (
                <div key={v.label} className="text-xs">
                  <span className="text-muted-foreground">{v.label}: </span>
                  <span className="font-medium text-foreground">{v.value}</span>
                </div>
              ))}
            </div>
          )}

          {affectedTravellers && affectedTravellers.length > 0 && (
            <div className="mt-2.5 flex -space-x-1.5">
              {affectedTravellers.map((p) => {
                const color = avatarColor(p.name);
                return (
                  <span
                    key={p.id}
                    title={p.name}
                    className="flex size-6 items-center justify-center rounded-full border-2 border-surface text-[10px] font-medium"
                    style={{ backgroundColor: color.bg, color: color.text }}
                  >
                    {p.name.slice(0, 1)}
                  </span>
                );
              })}
            </div>
          )}

          {children}

          {showActions && (primaryAction || secondaryAction) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {primaryAction && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => runAction(primaryAction, "primary")}
                  className="cursor-pointer rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingWhich === "primary" && pending
                    ? (primaryAction.pendingLabel ?? "Working…")
                    : primaryAction.label}
                </button>
              )}
              {secondaryAction && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => runAction(secondaryAction, "secondary")}
                  className="cursor-pointer rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingWhich === "secondary" && pending
                    ? (secondaryAction.pendingLabel ?? "Working…")
                    : secondaryAction.label}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
