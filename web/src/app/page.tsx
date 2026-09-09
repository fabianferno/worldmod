import Link from "next/link";
import { PredictiveArcHero } from "./_components/PredictiveArcHero";

export const metadata = {
  title: "World Mod",
  description: "A permissionless network for physical-world data.",
};

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M5.75 12h12.5m0 0l-4.75-4.75M18.25 12l-4.75 4.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The fork. Two people arrive here — someone who wants to earn and someone who
 * wants data — and the whole page is deciding which one you are. The rate is
 * quoted rather than described, because a number is the only part of this a
 * contributor is actually weighing.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center overflow-y-auto px-4 py-10">
      <div className="settle settle-1 mb-8">
        <PredictiveArcHero />
      </div>
      <h1 className="settle settle-1 text-[38px] font-semibold leading-[1.05] tracking-[-0.03em]">
        Get paid for
        <br />
        what you already do.
      </h1>
      <p className="settle settle-1 mt-4 max-w-[30ch] text-[15px] leading-relaxed text-muted">
        Strap your phone to your head, record fifteen seconds of a real task, and
        collect USDC when it is accepted.
      </p>

      <Link
        href="/c"
        className="interactive on-ink settle settle-2 mt-8 flex items-center gap-3 rounded-panel bg-ink p-1.5 text-on-ink"
      >
        <span className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full bg-mint text-mint-ink">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
            <circle cx="12" cy="12" r="6.5" fill="currentColor" />
          </svg>
        </span>
        <span className="flex-1 pr-[54px] text-center text-base font-semibold">
          Contribute an episode
        </span>
      </Link>

      <Link
        href="/b/bounties"
        className="interactive settle settle-3 mt-2.5 flex items-center justify-between gap-3 rounded-panel bg-paper py-4 pl-5 pr-4 shadow-lift"
      >
        <span className="text-base font-semibold">Post or browse bounties</span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-sunk text-foreground">
          <ArrowIcon />
        </span>
      </Link>

      <p className="settle settle-4 mt-8 rounded-card bg-lilac px-5 py-4 text-xs leading-relaxed text-lilac-ink">
        Episodes are scored on the device before upload and carry a{" "}
        <span className="font-semibold">heuristic</span> trust level: the checks
        measure whether a capture is plausible, not whether it is genuine. Nothing
        here is device-attested.
      </p>
    </main>
  );
}
