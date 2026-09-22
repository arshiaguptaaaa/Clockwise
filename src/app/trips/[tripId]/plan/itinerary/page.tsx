import { ComingSoon } from "@/components/ComingSoon";
import { CalendarDays } from "lucide-react";

export default function PlanItineraryPage() {
  return (
    <ComingSoon
      icon={CalendarDays}
      title="Itinerary"
      description="A day-by-day breakdown of the trip will appear here once activities are decided in Trip Room."
    />
  );
}
