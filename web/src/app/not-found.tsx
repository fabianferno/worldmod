import Link from "next/link";

export const metadata = { title: "Not found — World Mod" };

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4">
      <h1 className="text-[30px] font-semibold leading-[1.1]">
        That page does not exist
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The link may be stale, or the bounty may have been removed.
      </p>

      {/* Every dead end needs a way back. */}
      <div className="mt-7 flex flex-wrap gap-2.5">
        <Link
          href="/c"
          className="interactive rounded-full bg-ink px-5 py-3 text-sm font-semibold text-on-ink"
        >
          Record an episode
        </Link>
        <Link
          href="/b/bounties"
          className="interactive rounded-full bg-paper px-5 py-3 text-sm font-semibold shadow-lift"
        >
          Browse bounties
        </Link>
      </div>
    </main>
  );
}
