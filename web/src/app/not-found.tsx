import Link from "next/link";

export const metadata = { title: "Not found — World Mod" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6">
      <p className="font-mono text-sm text-subtle">404</p>
      <h1 className="mt-2 text-xl font-semibold">That page does not exist</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The link may be stale, or the bounty may have been removed.
      </p>

      {/* Every dead end needs a way back. */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/b/bounties"
          className="interactive rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:border-white/25"
        >
          Browse bounties
        </Link>
        <Link
          href="/c"
          className="interactive rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:border-white/25"
        >
          Record an episode
        </Link>
      </div>
    </main>
  );
}
