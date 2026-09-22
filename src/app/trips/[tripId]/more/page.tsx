import { ComingSoon } from "@/components/ComingSoon";
import { Settings } from "lucide-react";

export default function MorePage() {
  return (
    <ComingSoon
      icon={Settings}
      title="More"
      description="Permissions, travel documents, and rooming preferences will be reachable from here."
    />
  );
}
