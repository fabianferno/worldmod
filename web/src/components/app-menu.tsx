"use client";

/**
 * The one place to reach every screen.
 *
 * The bottom dock only carries the three things a contributor does most
 * (record, account, bounties); the buyer/network pages — datasets, the world
 * model, contributors, federated rounds — had no link pointing at them at all
 * and could only be reached by typing the URL. This is that missing index: a
 * fixed top-right button that opens a full sheet listing all of it, grouped by
 * the app's two worlds.
 *
 * Dismisses on backdrop, Escape, or picking a destination (and on any route
 * change, so it never lingers over the page it just sent you to). The trigger
 * itself toggles — ☰ to open, ✕ to close — and sits above the sheet.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Destination {
  href: string;
  label: string;
  hint: string;
}

const GROUPS: { title: string; items: Destination[] }[] = [
  {
    title: "Contribute",
    items: [
      { href: "/", label: "Home", hint: "The fork — earn or get data" },
      { href: "/c", label: "Record an episode", hint: "Capture 15 seconds, get paid" },
      { href: "/c/account", label: "Your account", hint: "Earnings, identity, withdraw" },
    ],
  },
  {
    title: "The network",
    items: [
      { href: "/b/bounties", label: "Bounties", hint: "Open tasks and their rates" },
      { href: "/b/datasets", label: "Datasets", hint: "Minted on-chain, tokenizable as Bonds" },
      { href: "/b/model", label: "World model", hint: "What the episodes are worth to a model" },
      { href: "/b/contributors", label: "Contributors", hint: "Derived reputation across the network" },
      { href: "/b/federated", label: "Federated rounds", hint: "Training without sharing data" },
      { href: "/b/validator", label: "Validator bond", hint: "WMOD staked, slashable for bad validation" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Escape closes; lock body scroll while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="interactive fixed right-4 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex h-11 w-11 items-center justify-center rounded-full bg-paper text-foreground shadow-lift"
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path
              d="M6.5 6.5l11 11m0-11l-11 11"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path
              d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="All pages"
          className="fixed inset-0 z-[55] overflow-y-auto bg-bone/95 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          {/* Stop clicks inside the panel from closing via the backdrop. */}
          <div
            className="mx-auto w-full max-w-md px-5 pb-16 pt-[max(4.5rem,calc(env(safe-area-inset-top)+3.75rem))]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="tag mb-4">All pages</p>

            <nav aria-label="All pages" className="space-y-6">
              {GROUPS.map((group) => (
                <div key={group.title}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                    {group.title}
                  </h2>
                  <ul className="space-y-2">
                    {group.items.map((item) => {
                      const active = isActive(pathname, item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            // Close on select — navigation is client-side, so the
                            // sheet must not linger over the page it opens.
                            onClick={() => setOpen(false)}
                            className={`interactive flex items-center justify-between gap-3 rounded-card px-4 py-3.5 shadow-lift ${
                              active ? "bg-mint text-mint-ink" : "bg-paper text-foreground"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold">{item.label}</span>
                              <span
                                className={`block truncate text-xs ${
                                  active ? "text-mint-ink/70" : "text-subtle"
                                }`}
                              >
                                {item.hint}
                              </span>
                            </span>
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              className="h-5 w-5 shrink-0 opacity-40"
                              aria-hidden
                            >
                              <path
                                d="M9.5 6.5L15 12l-5.5 5.5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
