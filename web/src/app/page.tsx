import Link from "next/link";

export const metadata = {
  title: "World Mod",
  description: "A permissionless network for physical-world data.",
};

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">World Mod</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        A permissionless network for physical-world data. Record what you do, get it
        scored on your own device, get paid for what is useful.
      </p>

      <div className="mt-8 space-y-3">
        <Link
          href="/c"
          className="interactive block rounded-xl bg-white px-4 py-3.5 text-center font-semibold text-neutral-950"
        >
          Contribute an episode
        </Link>

        <Link
          href="/b/bounties"
          className="interactive block rounded-xl border border-white/20 px-4 py-3.5 text-center font-semibold"
        >
          Post or browse bounties
        </Link>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-subtle">
        Episodes are scored on the device before upload and carry a{" "}
        <span className="text-muted">heuristic</span> trust level: the checks measure
        whether a capture is plausible, not whether it is genuine. Nothing here is
        device-attested.
      </p>
    </main>
  );
}
