import {
  Car,
  CreditCard,
  BedDouble,
  BellRing,
  Navigation,
  FileText,
  CheckCircle2,
  RefreshCw,
  MapPin,
  Route,
  CloudSun,
  type LucideIcon,
} from "lucide-react";
import type { CardType } from "@prisma/client";

export const CARD_VISUALS: Record<
  CardType,
  { icon: LucideIcon; tint: "accent" | "warning"; label: string }
> = {
  TRANSPORT: { icon: Car, tint: "accent", label: "Transport" },
  PAYMENT: { icon: CreditCard, tint: "accent", label: "Payment" },
  BOOKING: { icon: BedDouble, tint: "accent", label: "Booking" },
  REMINDER: { icon: BellRing, tint: "warning", label: "Reminder" },
  ETA_CHANGE: { icon: Navigation, tint: "warning", label: "ETA update" },
  DOCUMENT: { icon: FileText, tint: "warning", label: "Document" },
  DECISION: { icon: CheckCircle2, tint: "accent", label: "Decision" },
  RECOVERY: { icon: RefreshCw, tint: "warning", label: "Recovery" },
  PLACES: { icon: MapPin, tint: "accent", label: "Places" },
  ROUTE: { icon: Route, tint: "accent", label: "Route" },
  WEATHER: { icon: CloudSun, tint: "accent", label: "Weather" },
};
