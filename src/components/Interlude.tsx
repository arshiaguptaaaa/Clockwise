// An editorial pause: a few big words and a quiet line, on an otherwise empty canvas. The
// whitespace around it is the point. Used sparingly, about once per major screen.
export function Interlude({ lines, small, className = "" }: { lines: string[]; small?: string; className?: string }) {
  return (
    <aside className={`section ${className}`} data-interlude>
      <p className="font-display text-[34px] font-normal uppercase leading-[1.0] tracking-[-0.01em] text-foreground sm:text-[40px]">
        {lines.map((l, i) => (
          <span key={i} className="block">{l}</span>
        ))}
      </p>
      {small && <p className="mt-4 text-[13px] text-muted-foreground">{small}</p>}
    </aside>
  );
}
