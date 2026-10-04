// The Trip Room is one surface: no tab row. (Files is reachable from the trip header.)
export default function RoomLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}
