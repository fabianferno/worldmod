import { BUYER_URL, CONTRIBUTE_URL, REPO_URL } from "@/lib/links";
import { ArcHero } from "@/components/arc-hero";

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

/*
 * One field per idea, never a sprinkle: mint is the task you are paid for,
 * lilac is the model reading you, butter is something needing a hand, ink is
 * settled money. The landing page keeps that grammar so it reads as the same
 * product the app is.
 */
const STEPS = [
  {
    n: "01",
    field: "bg-mint text-mint-ink",
    title: "Pick a task that pays",
    body: "A buyer has posted a bounty and escrowed what it pays. The rate is quoted up front — you are weighing a number, not a pitch.",
  },
  {
    n: "02",
    field: "bg-lilac text-lilac-ink",
    title: "Record fifteen seconds",
    body: "Strap your phone to your head and do the thing. A model on your own device scores the take before anything leaves the phone.",
  },
  {
    n: "03",
    field: "bg-butter text-butter-ink",
    title: "Get told plainly",
    body: "Accepted, needs a hand, or rejected — with the reason. Scoring survives a reload; episodes queue offline and upload later.",
  },
  {
    n: "04",
    field: "bg-ink text-on-ink on-ink",
    title: "Pull the money",
    body: "Escrow credits a balance signed to your own key. Withdrawal is one press, in USDC, and nobody else can redirect it.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      {/* Hero */}
      <section className="grid gap-4 pt-6 sm:pt-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="settle settle-1 flex flex-col justify-between rounded-panel bg-paper px-6 py-8 shadow-lift sm:px-9 sm:py-11">
          <div>
            <div className="-mx-6 -mt-8 mb-2 sm:-mx-9 sm:-mt-11">
              <ArcHero />
            </div>
            <span className="tag">A permissionless network for physical-world data</span>
            <h1 className="mt-4 max-w-[14ch] text-[40px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[60px]">
              Get paid for what you already do.
            </h1>
            <p className="mt-5 max-w-[42ch] text-[16px] leading-relaxed text-muted sm:text-[17px]">
              Strap your phone to your head, record fifteen seconds of a real
              task, and collect USDC when it is accepted. No account, no crypto
              homework — a device key and a web page.
            </p>
          </div>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href={CONTRIBUTE_URL}
              className="interactive on-ink flex flex-1 items-center gap-3 rounded-full bg-ink p-1.5 text-on-ink"
            >
              <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-mint text-mint-ink">
                <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
                  <circle cx="12" cy="12" r="6.5" fill="currentColor" />
                </svg>
              </span>
              <span className="flex-1 whitespace-nowrap pr-[52px] text-center text-[15px] font-semibold">
                Contribute an episode
              </span>
            </a>
            <a
              href={BUYER_URL}
              className="interactive flex items-center gap-3 rounded-full bg-paper-sunk p-1.5 text-foreground sm:w-[220px]"
            >
              <span className="flex-1 pl-4 text-[15px] font-semibold">Post a bounty</span>
              <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-ink text-on-ink">
                <ArrowIcon />
              </span>
            </a>
          </div>
        </div>

        {/* The quoted figure — the one thing a contributor is actually weighing. */}
        <div className="settle settle-2 flex flex-col gap-4">
          <div className="flex flex-1 flex-col justify-between rounded-panel bg-mint px-6 py-7 text-mint-ink shadow-lift">
            <span className="tag !text-mint-ink/80">This take pays</span>
            <div className="mt-8">
              <div className="figure text-[64px] sm:text-[76px]">
                $1<span className="cents">.50</span>
                <span className="unit">USDC</span>
              </div>
              <p className="mt-3 text-[13px] font-medium opacity-80">
                for 15 seconds · rate quoted before you press record
              </p>
            </div>
          </div>
          <div className="on-ink rounded-panel bg-ink px-6 py-6 text-on-ink shadow-lift">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-on-ink-muted">Last episode</span>
              <span className="rounded-full bg-mint px-2.5 py-1 text-[11px] font-semibold text-mint-ink">
                Accepted
              </span>
            </div>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div>
                <div className="figure text-[34px]">
                  0.91<span className="unit">score</span>
                </div>
                <p className="mt-2 text-[12px] text-on-ink-muted">
                  Heuristic — plausible, not attested.
                </p>
              </div>
              <code className="shrink-0 font-mono text-[11px] text-on-ink-muted">0x7f3a…e21c</code>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-24 pt-14 sm:pt-20">
        <div className="flex items-end justify-between gap-6">
          <h2 className="text-[30px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[38px]">
            How an episode
            <br />
            moves through it.
          </h2>
          <p className="hidden max-w-[32ch] text-[14px] leading-relaxed text-muted sm:block">
            Payment is settled against evidence, not trust. Every episode carries
            a manifest hash anchored on-chain, signed by the contributor&apos;s own key.
          </p>
        </div>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li
              key={s.n}
              className={`settle settle-${i + 1} flex min-h-[260px] flex-col justify-between rounded-panel px-5 py-6 shadow-lift ${s.field}`}
            >
              <span className="figure text-[28px] opacity-70">{s.n}</span>
              <div>
                <h3 className="text-[19px] font-semibold leading-[1.25]">{s.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed opacity-85">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Honesty */}
      <section className="pt-14 sm:pt-20">
        <div className="grid gap-4 rounded-panel bg-paper p-6 shadow-lift sm:grid-cols-3 sm:p-9">
          <div className="sm:col-span-3">
            <span className="tag">Claims stay honest</span>
            <h2 className="mt-3 text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[32px]">
              Three things we say out loud instead of implying.
            </h2>
          </div>
          {[
            {
              k: "Heuristic",
              v: "Scoring measures whether a capture is plausible, not whether it is genuine. The product says so on every verdict.",
            },
            {
              k: "This phone only",
              v: "Your identity is a device key by default. Connect a World App wallet and it becomes recoverable — the copy never flattens the difference.",
            },
            {
              k: "Never lost",
              v: "Contributors go offline mid-task. Episodes queue on the device and upload later. Anchoring never blocks a result.",
            },
          ].map((c) => (
            <div key={c.k} className="rounded-card bg-paper-sunk px-5 py-5">
              <h3 className="text-[17px] font-semibold">{c.k}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">{c.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Buyers */}
      <section id="buyers" className="scroll-mt-24 pt-14 sm:pt-20">
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-panel bg-lilac px-6 py-8 text-lilac-ink shadow-lift sm:px-9 sm:py-10">
            <span className="tag !text-lilac-ink/80">For buyers</span>
            <h2 className="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[38px]">
              Post what you need. Escrow what it pays.
            </h2>
            <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed opacity-85">
              Describe the task, fund the bounty, and watch the model&apos;s scaling
              curve move as episodes land. Inspect any trace down to its manifest
              hash. The protocol is asset-agnostic: a factory sensor network
              registers the same way a phone does.
            </p>
            <a
              href={BUYER_URL}
              className="interactive on-ink mt-8 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[14px] font-semibold text-on-ink"
            >
              Open the buyer dashboard <ArrowIcon />
            </a>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { k: "Chainlink CRE", v: "Episode validation runs as a Confidential Workflow against a private threshold." },
              { k: "Hedera", v: "Registries and escrow on Hedera testnet; bond issuance via Asset Tokenization Studio." },
              { k: "World App", v: "MiniKit wallet auth and Selfie Check gate a contributor's first recording." },
              { k: "On-device model", v: "A world model scores the take on the phone before upload; federated rounds train it." },
            ].map((c) => (
              <div key={c.k} className="rounded-panel bg-paper px-5 py-6 shadow-lift">
                <h3 className="text-[17px] font-semibold">{c.k}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{c.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="pt-14 sm:pt-20">
        <div className="on-ink flex flex-col items-start justify-between gap-6 rounded-panel bg-ink px-6 py-8 text-on-ink shadow-lift-high sm:flex-row sm:items-center sm:px-9 sm:py-10">
          <div>
            <h2 className="text-[28px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[34px]">
              Fifteen seconds. One press to withdraw.
            </h2>
            <p className="mt-2 text-[14px] text-on-ink-muted">
              Open source. Read the spec, the contracts, and the trainer.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <a
              href={CONTRIBUTE_URL}
              className="interactive inline-flex items-center justify-center gap-2 rounded-full bg-mint px-5 py-3 text-[14px] font-semibold text-mint-ink"
            >
              Start recording <ArrowIcon />
            </a>
            <a
              href={REPO_URL}
              className="interactive inline-flex items-center justify-center rounded-full bg-ink-raised px-5 py-3 text-[14px] font-semibold text-on-ink"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
