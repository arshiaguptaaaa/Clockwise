import { InstallCard } from "@/components/more/InstallCard";
import { FeedbackForm } from "@/components/more/FeedbackForm";

export default async function MorePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
      <h1 className="font-display text-[26px] leading-tight">App &amp; feedback</h1>
      <InstallCard tripId={tripId} />
      <FeedbackForm tripId={tripId} />
    </div>
  );
}
