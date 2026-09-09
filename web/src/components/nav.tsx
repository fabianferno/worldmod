"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The dock.
 *
 * A phone held in one hand can only reach the bottom of its own screen, so
 * navigation lives there and the viewfinder keeps the rest. The one thing
 * anybody opened this app to do — record — is a raised disc straddling the
 * dock's edge, reachable without looking; the two destinations either side of
 * it are where you go afterwards, to check a verdict or pick a different task.
 *
 * The bar stays ink on every route. It is the seam between the contributor's
 * bone world and the buyer's dashboard, and a seam should read as one thing
 * from both sides. The bone strip behind it is what makes the disc look cut
 * out of the bar rather than stuck onto it.
 */

function LedgerIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]" aria-hidden>
      <rect
        x="3.75"
        y="4.75"
        width="16.5"
        height="14.5"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.7"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.18 : 0}
      />
      <path d="M7.75 9.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.75 14.5h8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function BountyIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]" aria-hidden>
      <rect
        x="3.75"
        y="7.25"
        width="16.5"
        height="12"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.7"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.18 : 0}
      />
      <path
        d="M8.75 7.25V6.1A1.85 1.85 0 0110.6 4.25h2.8A1.85 1.85 0 0115.25 6.1v1.15"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M3.75 12.25h16.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

/** The record disc's glyph: an aperture, not a camera body. */
function RecordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" aria-hidden>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    </svg>
  );
}

const SIDE_TABS = [
  { href: "/c/account", label: "Account", Icon: LedgerIcon, side: "left" },
  { href: "/b/bounties", label: "Bounties", Icon: BountyIcon, side: "right" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const capturing = pathname === "/c";

  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-40 bg-bone px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-7"
    >
      <div className="relative mx-auto w-full max-w-lg">
        {/* The disc breaks the bar's top edge; the bone ring is the cut-out. */}
        <Link
          href="/c"
          aria-label="Record an episode"
          aria-current={capturing ? "page" : undefined}
          /* Mint is reserved for the one control that starts a take. On /c that
             control is already on screen, so the disc stays ink and reads as
             "you are here" rather than competing with it. */
          className={`interactive absolute -top-6 left-1/2 z-10 flex h-[68px] w-[68px] -translate-x-1/2 items-center justify-center rounded-full border-[5px] border-bone bg-ink shadow-lift-high ${
            capturing ? "text-mint" : "text-on-ink"
          }`}
        >
          <RecordIcon />
        </Link>

        <ul className="on-ink flex items-stretch rounded-panel bg-ink pb-2 pt-2.5">
          {SIDE_TABS.map(({ href, label, Icon, side }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li
                key={href}
                className={`flex-1 ${side === "left" ? "pr-10" : "pl-10"}`}
              >
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`interactive flex flex-col items-center gap-1 rounded-inner py-1.5 text-[11px] font-medium ${
                    active ? "text-on-ink" : "text-on-ink-muted"
                  }`}
                >
                  <Icon active={active} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
