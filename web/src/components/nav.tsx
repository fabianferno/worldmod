"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Top navigation.
 *
 * There was none: the contributor and buyer halves were reachable only by
 * typing a URL, and no page told you which one you were in.
 *
 * Top rather than a sidebar — the contributor view is a phone-width viewfinder
 * and a sidebar would eat the frame.
 */
const LINKS = [
  { href: "/c", label: "Capture" },
  { href: "/b/bounties", label: "Bounties" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-line" aria-label="Main">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-1 px-5 py-2.5">
        <Link
          href="/"
          className="interactive mr-2 text-sm font-semibold tracking-tight hover:text-accent"
        >
          World Mod
        </Link>

        {LINKS.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              // Without this a buyer approving payments has no idea where they are.
              aria-current={active ? "page" : undefined}
              className={`interactive rounded-lg px-2.5 py-1.5 text-sm ${
                active ? "bg-white/10 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          );
        })}

        <span className="ml-auto rounded-md border border-line px-2 py-0.5 text-[10px] font-medium tracking-wide text-subtle">
          testnet
        </span>
      </div>
    </nav>
  );
}
