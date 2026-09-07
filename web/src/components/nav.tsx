"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Bottom tab bar.
 *
 * This was a row of text links across the top — a web page's navigation on a
 * phone-shaped screen. On a device held in one hand the top of the display is
 * the hardest place to reach and the least valuable real estate; the capture
 * screen needs that space for the viewfinder.
 *
 * Sits above the home indicator via safe-area insets, which a page-shaped
 * layout ignores and an app cannot.
 */

function CaptureIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <rect
        x="3"
        y="6"
        width="18"
        height="13"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.7"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.16 : 0}
      />
      <circle cx="12" cy="12.5" r="3.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 6l1.2-2h3.6L15 6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function BountyIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <rect
        x="3.5"
        y="7"
        width="17"
        height="13"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.7"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.16 : 0}
      />
      <path d="M8.5 7V5.6A1.6 1.6 0 0110.1 4h3.8A1.6 1.6 0 0115.5 5.6V7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 12.5h17" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

const TABS = [
  { href: "/c", label: "Capture", Icon: CaptureIcon },
  { href: "/b/bounties", label: "Bounties", Icon: BountyIcon },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-40 border-t border-line bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex w-full max-w-lg">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`interactive flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                  active ? "text-accent" : "text-subtle"
                }`}
              >
                <Icon active={active} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
