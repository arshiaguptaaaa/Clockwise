// The Clockwise identity: a slightly hand-drawn round clock face. One mark,
// used wherever Clockwise "noticed something, needs something, or can help".
// Reads at 20px; colour comes from currentColor so it works in green, pink or
// black. `working` sweeps the hands (used only inside the Ask Clockwise sheet).
export function ClockwiseMark({ size = 24, working = false, className = "" }: { size?: number; working?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Clockwise"
      className={`${working ? "cw-working" : ""} ${className}`}
    >
      {/* face: deliberately a touch off-round */}
      <path d="M12 2.6c5.3-.2 9.5 3.9 9.4 9.2-.1 5.3-4.2 9.7-9.6 9.6C6.6 21.3 2.5 17 2.6 11.9 2.7 6.9 6.7 2.8 12 2.6Z" />
      <path className="cw-hand cw-hand-hr" d="M12 12V7.6" />
      <path className="cw-hand cw-hand-min" d="M12 12l3.9 2.3" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}
