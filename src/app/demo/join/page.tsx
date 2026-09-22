import { ArrowRight } from "lucide-react";
import { getDemoTrip } from "@/lib/trip";
import { joinAsUser } from "@/app/actions";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";

export default async function JoinPickerPage() {
  const trip = await getDemoTrip();

  return (
    <main className="flex min-h-screen flex-col bg-page px-6 py-12">
      <div className="mx-auto w-full max-w-sm flex-1">
        <div className="mb-8 text-center">
          <ClockwiseWordmark className="justify-center text-foreground" />
          <p className="mt-3 text-lg font-medium text-foreground">
            Who are you?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This is a prototype — join as any traveller to see their view.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {trip.members.map((member) => (
            <form key={member.userId} action={joinAsUser.bind(null, trip.id, member.userId)}>
              <button
                type="submit"
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent-tint"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-tint text-sm font-medium text-accent-strong">
                  {member.user.name.slice(0, 1)}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {member.user.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {member.role === "ORGANIZER" ? "Organiser" : "Traveller"}
                  </span>
                </span>
                <ArrowRight className="size-4 text-accent" />
              </button>
            </form>
          ))}
        </div>
      </div>
    </main>
  );
}
