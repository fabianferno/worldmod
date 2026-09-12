/**
 * Chainlink's hexagon mark, as a monochrome inline glyph.
 *
 * Drawn to inherit `currentColor` so it tints to whatever label carries it
 * (the CRE chip's lilac, the result badge, etc.) and sits in the app's flat
 * design system rather than importing the brand's blue. Recognizable-but-
 * approximate: the hexagon silhouette with the inner cube hint, not the
 * pixel-exact official asset — swap for the official SVG if brand-exactness
 * is needed.
 */
export function ChainlinkMark({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 2.4l8.6 4.95v9.3L12 21.6 3.4 16.65v-9.3L12 2.4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 8.1l3.35 1.93v3.94L12 15.9l-3.35-1.93V10.03L12 8.1z"
        fill="currentColor"
      />
    </svg>
  );
}
