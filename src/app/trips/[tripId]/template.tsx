// A new template instance per navigation: each tab change eases in instead of snapping.
export default function TripTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-in flex min-h-0 flex-1 flex-col">{children}</div>;
}
