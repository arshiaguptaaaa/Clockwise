-- Additive only. Remembers WHY Geoapify answered (Delhivery was asked first), so the label can say FALLBACK.
ALTER TABLE "TravellerJourney" ADD COLUMN "routeFellBackFrom" TEXT;
ALTER TABLE "TripClash" ADD COLUMN "routeFellBackFrom" TEXT;
-- A direct payment ("pay Ridhima ₹1,000") names who is being paid; the money is only called paid when Pine Labs says so.
ALTER TABLE "PaymentCollection" ADD COLUMN "payeeUserId" TEXT;
