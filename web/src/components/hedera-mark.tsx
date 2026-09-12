/**
 * Hedera's mark — the "ħ" in a circle — as a monochrome inline glyph.
 *
 * Circle outline plus the actual ħ character (U+0127), both in `currentColor`
 * so it tints to its label and reads on any background in the app's flat
 * system, rather than importing the brand's exact colours. Using the real
 * glyph keeps the letterform accurate; the framing is approximate. Swap for
 * the official SVG if brand-exactness is required.
 */
export function HederaMark({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="12"
        y="16.4"
        textAnchor="middle"
        fill="currentColor"
        style={{ fontSize: "13px", fontWeight: 700, fontFamily: "inherit" }}
      >
        ħ
      </text>
    </svg>
  );
}
