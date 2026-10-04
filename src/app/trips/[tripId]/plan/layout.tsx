// The Plan is one surface: a timeline. (Travellers and the route are linked from it.)
export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}
