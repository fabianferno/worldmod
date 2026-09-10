/**
 * A plain wireframe globe for the "Sign in" button.
 *
 * Deliberately NOT the World mark: World's mini-app design guidelines forbid
 * using the World logo or any modified version of it, so this is a generic
 * globe — meridian and latitudes — that reads as "reachable anywhere, like
 * your World App wallet" without borrowing the trademark. Line weight and
 * round caps match the nav icons so it sits in the same family.
 */
export function WorldGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.7" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.25" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.9 12h16.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5.4 8.4h13.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5.4 15.6h13.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
