import { ComingSoon } from "@/components/ComingSoon";
import { ListTodo } from "lucide-react";

export default function RoomTasksPage() {
  return (
    <ComingSoon
      icon={ListTodo}
      title="Tasks"
      description="Action items Clockwise identifies from the conversation — like booking flights or confirming a hotel — will show up here."
    />
  );
}
