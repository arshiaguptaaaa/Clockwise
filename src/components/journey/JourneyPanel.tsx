"use client";

import { DateTimeField } from "@/components/DatePicker";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { uploadAttachment } from "@/app/attachment-actions";
import { confirmJourneyAction, discardJourneyAction, addManualJourneyAction } from "@/app/traveller-actions";

type Pending = { id: string; mode: string; carrier: string | null; originName: string | null; destinationName: string | null; departLocal: string | null; arriveLocal: string | null };
const label = "eyebrow";
const input = "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent";
const MODES = [
  ["FLIGHT", "Flight"],
  ["TRAIN", "Train"],
  ["BUS", "Bus"],
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
        <div className="border-l-2 border-accent pl-4" data-pending-journey>
          <p className="headline headline-md">Clockwise found this ✦</p>
          <p className="text-xs text-muted-foreground">Read from your ticket. It stays private until you confirm — then your arrival goes to the Plan.</p>
          {edit ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["From", "originName"],
                    ["To", "destinationName"],
                  ] as const
                ).map(([l, k]) => (
                  <label key={k} className="text-xs text-muted-foreground">
                    {l}
                    <input className={`${input} mt-1 min-h-11`} value={(edit[k] as string | null) ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              <DateTimeField label="Departs" value={edit.departLocal ?? ""} onChange={(v) => setEdit({ ...edit, departLocal: v })} minDate="2000-01-01" />
              <DateTimeField label="Arrives" value={edit.arriveLocal ?? ""} onChange={(v) => setEdit({ ...edit, arriveLocal: v })} minDate="2000-01-01" />
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
        <p className={label}>{hasConfirmed ? "Changed plans? Upload a new ticket" : "Upload your ticket"}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {MODES.map(([m, l]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                fileRef.current?.click();
              }}
              className="btn btn-ghost !px-2 !text-[11px] !tracking-[0.08em]"
              data-upload-mode={m}
            >
              {uploading && mode === m ? <Loader2 className="mx-auto size-4 animate-spin" /> : l.toUpperCase()}
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
        <div className="space-y-2">
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
              ["To", "destination", "Bengaluru"],
            ] as const
          ).map(([l, k, ph]) => (
            <label key={k} className="block text-xs text-muted-foreground">
              {l}
              <input className={`${input} mt-1 min-h-11`} value={form[k]} placeholder={ph} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          <DateTimeField label="Departs" value={form.depart} onChange={(v) => setForm({ ...form, depart: v })} />
          <DateTimeField label="Arrives" value={form.arrive} onChange={(v) => setForm({ ...form, arrive: v })} />
          <label className="block text-xs text-muted-foreground">
            Carrier (optional)
            <input className={`${input} mt-1 min-h-11`} value={form.carrier} placeholder="IndiGo" onChange={(e) => setForm({ ...form, carrier: e.target.value })} />
          </label>
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
