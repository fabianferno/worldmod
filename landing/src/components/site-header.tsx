import Link from "next/link";
import { CONTRIBUTE_URL } from "@/lib/links";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/" className="flex items-center gap-2.5 rounded-full">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink">
          <span className="h-3 w-3 rounded-full bg-mint" aria-hidden />
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.02em]">World Mod</span>
      </Link>
      <nav className="flex items-center gap-1 text-[13px] font-medium text-muted">
        <a href="#how" className="rounded-full px-3 py-2 hover:text-foreground">
          How it works
        </a>
        <a href="#buyers" className="hidden rounded-full px-3 py-2 hover:text-foreground sm:block">
          For buyers
        </a>
        <a
          href={CONTRIBUTE_URL}
          className="interactive ml-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-on-ink"
        >
          Open the app
        </a>
      </nav>
    </header>
  );
}
