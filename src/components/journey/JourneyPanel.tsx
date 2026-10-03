"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { uploadAttachment } from "@/app/attachment-actions";
import { confirmJourneyAction, discardJourneyAction, addManualJourneyAction } from "@/app/traveller-actions";

type Pending = { id: string; mode: string; carrier: string | null; originName: string | null; destinationName: string | null; departLocal: string | null; arriveLocal: string | null };
const label = "text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground";
const input = "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent";
const MODES = [
  ["FLIGHT", "✈ Flight"],
  ["TRAIN", "🚆 Train"],
  ["BUS", "🚌 Bus"],
];

export function JourneyPanel({ tripId, pending, hasConfirmed }: { tripId: string; pending: Pending | null; hasConfirmed: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<string>("FLIGHT");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [edit, setEdit] = useState<Pending | null>(null);
  const [form, setForm] = useState({ origin: "", destination: "", depart: "", arrive: "", carrier: "" });
  const [busy, start] = useTransition();

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setMsg(null);
    setUploading(true);
    const fd = new FormData();
    fd.set("tripId", tripId);
    fd.set("channel", "PRIVATE");
    fd.set("file", file);
    const r = await uploadAttachment(fd);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) return setErr(r.error);
    setMsg("Reading your ticket privately…");
    // Extraction runs after the upload response; check back for the pending journey.
    for (let k = 0; k < 8; k++) {
      await new Promise((res) => setTimeout(res, 2500));
      router.refresh();
    }
    setMsg(null);
  }

  const confirm = (p: Pending, edits?: Partial<Pending>) =>
    start(async () => {
      const r = await confirmJourneyAction(tripId, p.id, edits ? { departLocal: edits.departLocal, arriveLocal: edits.arriveLocal, originName: edits.originName, destinationName: edits.destinationName, carrier: edits.carrier } : undefined);
      if (!r.ok) return setErr(r.error ?? "Couldn't save that.");
      setEdit(null);
      router.refresh();
    });

  return (
    <div className="space-y-5">
      {pending && (
        <div className="rounded-2xl border border-dashed border-accent p-4" data-pending-journey>
          <p className="font-display text-xl">CLOCKWISE FOUND THIS ✦</p>
          <p className="text-xs text-muted-foreground">Read from your ticket. It stays private until you confirm — then your arrival goes to the Plan.</p>
          {edit ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  ["From", "originName"],
                  ["To", "destinationName"],
                  ["Departs (YYYY-MM-DDTHH:mm)", "departLocal"],
                  ["Arrives (YYYY-MM-DDTHH:mm)", "arriveLocal"],
                ] as const
              ).map(([l, k]) => (
                <label key={k} className="text-xs text-muted-foreground">
                  {l}
                  <input className={`${input} mt-1`} value={(edit[k] as string | null) ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm">
              {pending.originName ?? "?"} → {pending.destinationName ?? "?"} · departs {pending.departLocal?.replace("T", " ") ?? "?"} · arrives {pending.arriveLocal?.replace("T", " ") ?? "?"}
              {pending.carrier ? ` · ${pending.carrier}` : ""}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button disabled={busy} onClick={() => confirm(pending, edit ?? undefined)} className="cursor-pointer rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground">
              {edit ? "Save & confirm" : "Yes, save journey"}
            </button>
            {!edit && (
              <button onClick={() => setEdit(pending)} className="cursor-pointer rounded-full border border-border px-4 py-2 text-xs font-semibold">
                Edit
              </button>
            )}
            <button disabled={busy} onClick={() => start(async () => { await discardJourneyAction(tripId, pending.id); router.refresh(); })} className="cursor-pointer px-2 text-xs text-muted-foreground">
              Not mine
            </button>
          </div>
        </div>
      )}

      <div>
        <p className={label}>{hasConfirmed ? "Replace my journey" : "My journey"}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {MODES.map(([m, l]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                fileRef.current?.click();
              }}
              className="cursor-pointer rounded-2xl border border-border bg-page px-2 py-3 text-xs font-semibold"
              data-upload-mode={m}
            >
              {uploading && mode === m ? <Loader2 className="mx-auto size-4 animate-spin" /> : `UPLOAD ${l.toUpperCase()}`}
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={pick} data-ticket-input />
        <button type="button" onClick={() => setManual((v) => !v)} className="mt-2 cursor-pointer text-xs font-semibold text-accent">
          {manual ? "Hide" : "Add details manually"}
        </button>
        {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      </div>

      {manual && (
        <div className="space-y-2 rounded-2xl border border-border p-4">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map(([m, l]) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`cursor-pointer rounded-xl border px-2 py-2 text-xs font-semibold ${mode === m ? "border-accent bg-accent-tint" : "border-border"}`}>
                {l}
              </button>
            ))}
          </div>
          {(
            [
              ["From", "origin", "Delhi"],
              ["To", "destination", "Udaipur"],
              ["Departs (YYYY-MM-DDTHH:mm)", "depart", "2026-12-12T17:20"],
              ["Arrives (YYYY-MM-DDTHH:mm)", "arrive", "2026-12-12T18:35"],
              ["Carrier (optional)", "carrier", "IndiGo"],
            ] as const
          ).map(([l, k, ph]) => (
            <label key={k} className="block text-xs text-muted-foreground">
              {l}
              <input className={`${input} mt-1`} value={form[k]} placeholder={ph} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          <button
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await addManualJourneyAction(tripId, { mode: mode as "FLIGHT", originName: form.origin, destinationName: form.destination, departLocal: form.depart || null, arriveLocal: form.arrive || null, carrier: form.carrier || null });
                if (!r.ok) return setErr(r.error ?? "Couldn't save.");
                setManual(false);
                router.refresh();
              })
            }
            className="w-full cursor-pointer rounded-full bg-accent py-2.5 text-sm font-semibold text-accent-foreground"
          >
            Save journey
          </button>
        </div>
      )}
    </div>
  );
}
