"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Bounty, Modality, MotionPolicy } from "@/lib/market/types";

const MODALITIES: Array<{ id: Modality; label: string; note?: string }> = [
  { id: "rgb", label: "Video" },
  { id: "imu", label: "Motion (IMU)" },
  { id: "audio", label: "Audio" },
  { id: "gps", label: "Coarse location", note: "rounded to ~10km" },
  { id: "orientation", label: "Orientation" },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block py-3">
      <span className="text-sm font-medium">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs text-subtle">{hint}</span> : null}
      <div className="mt-2">{children}</div>
    </label>
  );
}

const input =
  "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none " +
  "focus:border-white/40";

export function NewBountyForm() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [taskSpec, setTaskSpec] = useState("");
  const [modalities, setModalities] = useState<Modality[]>(["rgb", "imu"]);
  const [episodes, setEpisodes] = useState(100);
  const [perEpisode, setPerEpisode] = useState(0.6);
  const [utilityPool, setUtilityPool] = useState(30);
  const [validatorFee, setValidatorFee] = useState(5);
  const [treasuryFee, setTreasuryFee] = useState(5);
  const [minFraming, setMinFraming] = useState(70);
  const [minPlausibility, setMinPlausibility] = useState(70);
  const [motionPolicy, setMotionPolicy] = useState<MotionPolicy>("allow_static");
  const [durationMin, setDurationMin] = useState(8);
  const [durationMax, setDurationMax] = useState(30);
  const [days, setDays] = useState(30);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The budget is DERIVED, never typed.
   *
   * product-spec §7's example bounty allocates 110 USDC against a 100 USDC
   * budget once §13's validator and treasury fees are counted. Letting a buyer
   * enter a budget separately invites exactly that: an escrow that runs dry
   * while paying contributors who have already done the work.
   */
  const budget = useMemo(
    () => perEpisode * episodes + utilityPool + validatorFee + treasuryFee,
    [perEpisode, episodes, utilityPool, validatorFee, treasuryFee],
  );

  const toggle = (id: Modality) =>
    setModalities((current) =>
      current.includes(id) ? current.filter((m) => m !== id) : [...current, id],
    );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (modalities.length === 0) {
      setError("Pick at least one modality, or no asset can qualify.");
      return;
    }
    if (durationMin >= durationMax) {
      setError("The minimum duration must be below the maximum.");
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const bounty: Bounty = {
      bounty_id: `bounty_${crypto.randomUUID().slice(0, 8)}`,
      title: title.trim(),
      task_spec: taskSpec.trim(),
      task: title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      required_modalities: modalities,
      min_episodes: episodes,
      duration_range_s: [durationMin, durationMax],
      min_plausibility: minPlausibility / 100,
      motion_policy: motionPolicy,
      min_framing: minFraming / 100,
      min_trust_level: "heuristic",
      budget_usdc: Number(budget.toFixed(2)),
      per_episode_usdc: perEpisode,
      utility_pool_usdc: utilityPool,
      validator_fee_usdc: validatorFee,
      treasury_fee_usdc: treasuryFee,
      license: "commercial_ai_training",
      deadline: now + days * 86_400,
      created_at: now,
      status: "open",
    };

    setSubmitting(true);
    try {
      const response = await fetch("/api/bounties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bounty),
      });
      const data = (await response.json()) as { bounty?: Bounty; error?: string };

      if (!response.ok || !data.bounty) {
        setError(data.error ?? `Could not create the bounty (HTTP ${response.status}).`);
        return;
      }
      router.push(`/b/bounties/${data.bounty.bounty_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <section>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Task</h2>

        <Field label="Title">
          <input
            className={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Typing at a keyboard"
            required
          />
        </Field>

        <Field
          label="What should the contributor do?"
          hint="Written for someone wearing the phone. Say where the hands need to be."
        >
          <textarea
            className={`${input} min-h-24`}
            value={taskSpec}
            onChange={(e) => setTaskSpec(e.target.value)}
            placeholder="Sit at a desk with the phone head-mounted and type on a keyboard for the full episode. Keep both hands in view."
            required
          />
        </Field>

        <Field label="Required modalities" hint="Assets that cannot produce all of these will not qualify.">
          <div className="flex flex-wrap gap-2">
            {MODALITIES.map(({ id, label, note }) => (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className={`rounded-full border px-3 py-1.5 text-xs ${
                  modalities.includes(id)
                    ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                    : "border-white/15 text-muted"
                }`}
              >
                {label}
                {note ? <span className="ml-1 opacity-60">({note})</span> : null}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Min duration (s)">
            <input
              type="number"
              className={input}
              value={durationMin}
              min={1}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
          </Field>
          <Field label="Max duration (s)">
            <input
              type="number"
              className={input}
              value={durationMax}
              min={2}
              onChange={(e) => setDurationMax(Number(e.target.value))}
            />
          </Field>
        </div>
      </section>

      <section className="mt-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
          Quality bar
        </h2>

        <Field
          label={`Minimum framing: ${minFraming}%`}
          hint="Share of frames where hands must be usefully in view."
        >
          <input
            type="range"
            min={0}
            max={100}
            value={minFraming}
            onChange={(e) => setMinFraming(Number(e.target.value))}
            className="w-full"
          />
        </Field>

        <Field label="Motion evidence">
          <div className="space-y-2">
            {(
              [
                {
                  value: "require" as MotionPolicy,
                  label: "Require it",
                  note: "For tasks with real head movement. A still capture is rejected.",
                },
                {
                  value: "allow_static" as MotionPolicy,
                  label: "Allow static tasks",
                  note:
                    "Seated tasks barely rotate the head, so the gyroscope check has nothing to " +
                    "correlate. These episodes carry no motion evidence and are the easiest to fake.",
                },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMotionPolicy(option.value)}
                className={`block w-full rounded-lg border p-3 text-left ${
                  motionPolicy === option.value ? "border-white/40 bg-white/5" : "border-line"
                }`}
              >
                <span className="text-sm font-medium">{option.label}</span>
                <span className="mt-0.5 block text-xs text-subtle">{option.note}</span>
              </button>
            ))}
          </div>
        </Field>

        {motionPolicy === "require" ? (
          <Field label={`Minimum motion match: ${minPlausibility}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={minPlausibility}
              onChange={(e) => setMinPlausibility(Number(e.target.value))}
              className="w-full"
            />
          </Field>
        ) : null}
      </section>

      <section className="mt-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Budget</h2>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Episodes wanted">
            <input
              type="number"
              className={input}
              value={episodes}
              min={1}
              onChange={(e) => setEpisodes(Number(e.target.value))}
            />
          </Field>
          <Field label="Per episode (USDC)">
            <input
              type="number"
              step="0.01"
              className={input}
              value={perEpisode}
              min={0}
              onChange={(e) => setPerEpisode(Number(e.target.value))}
            />
          </Field>
          <Field label="Utility pool (USDC)" hint="Split by measured model contribution.">
            <input
              type="number"
              className={input}
              value={utilityPool}
              min={0}
              onChange={(e) => setUtilityPool(Number(e.target.value))}
            />
          </Field>
          <Field label="Validator fee (USDC)">
            <input
              type="number"
              className={input}
              value={validatorFee}
              min={0}
              onChange={(e) => setValidatorFee(Number(e.target.value))}
            />
          </Field>
          <Field label="Treasury fee (USDC)">
            <input
              type="number"
              className={input}
              value={treasuryFee}
              min={0}
              onChange={(e) => setTreasuryFee(Number(e.target.value))}
            />
          </Field>
          <Field label="Open for (days)">
            <input
              type="number"
              className={input}
              value={days}
              min={1}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="mt-2 rounded-xl border border-white/15 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Total to escrow</span>
            <span className="font-mono text-xl tabular-nums">${budget.toFixed(2)}</span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            Derived from the allocations above, not entered separately — a bounty that promises
            more than it holds would run dry while paying contributors who had already done the
            work.
          </p>
        </div>
      </section>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="interactive mt-5 w-full rounded-xl bg-white px-4 py-3.5 font-semibold text-neutral-950 disabled:opacity-40"
      >
        {submitting ? "Posting…" : `Post bounty and escrow $${budget.toFixed(2)}`}
      </button>

      <p className="mt-2 text-center text-xs text-subtle">
        Testnet. No mainnet value moves.
      </p>
    </form>
  );
}
