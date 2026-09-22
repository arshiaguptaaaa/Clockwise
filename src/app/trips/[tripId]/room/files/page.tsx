import { ComingSoon } from "@/components/ComingSoon";
import { FileText } from "lucide-react";

export default function RoomFilesPage() {
  return (
    <ComingSoon
      icon={FileText}
      title="Files"
      description="Shared documents and confirmations for the group will live here."
    />
  );
}
