import { ComingSoon } from "@/components/ComingSoon";
import { ListTodo } from "lucide-react";

export default function PlanTasksPage() {
  return (
    <ComingSoon
      icon={ListTodo}
      title="Tasks"
      description="Flights, documents, hotels, and transport still to sort will be tracked here once Clockwise starts extracting decisions from Trip Room."
    />
  );
}
