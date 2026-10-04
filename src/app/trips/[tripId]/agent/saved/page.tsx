import Link from "next/link";
import { getTripById } from "@/lib/trip";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { savedOverlaps } from "@/lib/travel/saved-overlap";
import { countWordTitle } from "@/lib/travel/around-categories";
import { ProposeSaved } from "@/components/around/ProposeSaved";
import { FitCheck } from "@/components/around/FitCheck";
import { anchorsFor } from "@/lib/travel/around";
import { BengaluruArt } from "@/components/art/BengaluruArt";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { CAFE: "Coffee", RESTAURANT: "Food", ATTRACTION: "Things to do", PARK: "Parks", SHOPPING: "Shopping", NIGHTLIFE: "Nightlife", MUSEUM: "Museums", STAY: "Stay" };

export default async function SavedPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const trip = await getTripById(tripId);
  const place = (trip.destinations[0]?.city ?? trip.destinations[0]?.name ?? "the city").split(",")[0];
  const [rows, overlaps, anchors] = await Promise.all([prisma.savedPlace.findMany({ where: { tripId, userId }, orderBy: { createdAt: "desc" } }), savedOverlaps(tripId, userId), anchorsFor(tripId, userId)]);
  // Measured from the hotel when there is one, else from the destination.
  const fitAnchor = anchors.stay ? ("stay" as const) : anchors.destination ? ("destination" as const) : null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-6">
      <header>
        <p className="eyebrow">Saved</p>
        <h1 className="headline headline-xl mt-2">♡ Yours only.</h1>
        <p className="lede mt-2 max-w-[19rem]">Private. Saving never tells the group or changes the Plan.</p>
      </header>

      {overlaps.map((o) => (
        <section key={o.providerPlaceId} className="section" data-overlap={o.name}>
          <p className="eyebrow text-accent">◷ Wait.</p>
          <h2 className="headline headline-lg mt-2">
            {countWordTitle(o.count)} of you saved this.
          </h2>
          <p className="mt-3 font-display text-[22px] leading-tight tracking-[-0.01em]">{o.name}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Nobody is told who saved what.</p>
          {(() => {
            const r = rows.find((x) => x.providerPlaceId === o.providerPlaceId);
            return r && r.latitude != null && r.longitude != null ? (
              <ProposeSaved tripId={tripId} kind={r.kind} place={{ provider: r.provider, providerPlaceId: r.providerPlaceId, name: r.name, address: r.address, lat: r.latitude, lng: r.longitude, categories: [], distanceMeters: null, walkMinutes: null, openingHours: null, website: null, phone: null, retrievedAt: (r.retrievedAt ?? r.createdAt).toISOString() }} />
            ) : null;
          })()}
        </section>
      ))}

      {rows.length === 0 ? (
        <section className="section text-center">
          <BengaluruArt scene="saved" className="mx-auto w-56 -rotate-2 shadow-[0_14px_30px_-16px_rgba(20,24,26,0.5)]" />
          <p className="t-display mt-6 text-[30px]">Nothing saved yet.</p>
          <p className="t-voice mx-auto mt-2 max-w-[17rem] text-[16px]">Find somewhere worth arguing about.</p>
          <Link href={`/trips/${tripId}/agent/around`} className="btn btn-primary mt-5">
            Explore {place}
          </Link>
          <p className="mx-auto mt-3 max-w-[17rem] text-[12px] text-muted-foreground">Saves are private. Only you see them.</p>
        </section>
      ) : (
        <section className="section">
          <p className="eyebrow">Your list · {rows.length}</p>
          <ul className="row-rule mt-2">
            {rows.map((r) => (
              <li key={r.id} className="py-3.5" data-saved={r.name}>
                <p className="font-display text-[19px] leading-tight tracking-[-0.01em]">{r.name}</p>
                <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                  <span className="mr-2 uppercase tracking-[0.14em] text-[10.5px] text-foreground/70">{KIND_LABEL[r.kind] ?? r.kind.toLowerCase()}</span>
                  {r.address ?? ""}
                </p>
                {fitAnchor && r.latitude != null && r.longitude != null && <FitCheck tripId={tripId} place={{ name: r.name, lat: r.latitude, lng: r.longitude }} kind={r.kind} anchor={fitAnchor} saved />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
