# Demo script

Six scenes, per product-spec §14, with what actually works marked against each.
Read the honesty column before rehearsing — two scenes cannot be performed as
the spec describes, and finding that out on stage would be worse than adapting
now.

| # | Scene | State |
|---|---|---|
| 1 | Capture | **Works** |
| 2 | Verification | **Partly** — scores are real, nothing lands on-chain |
| 3 | The spoof | **Works, offline** — measured, not yet live |
| 4 | The market | **Partly** — acceptance and payment are real, USDC is not |
| 5 | The model | **Works, and the honest result is a negative one** |
| 6 | Federated | **Works as coordination; the learning does not improve** |

---

## 1 — Capture

Phone in a head strap, `/c` open. One tap, five-second countdown to mount it,
fifteen seconds recording, stops by itself.

Point at the live skeleton: the hand is tracked on-device while recording, and
the guide box turns amber with "tilt down" when hands leave frame. On a bounty
that needs motion, "move around more" appears if the head is too still.

**Say:** nothing is uploaded yet. The scoring you are watching happens on the
phone.

## 2 — Verification

The result screen: **Hands in view** and **Motion check**, then the frame that
was scored with the pivot points drawn on it.

Open **Technical details** — observed frame rate against nominal, IMU rate,
measured clock skew, analysis errors. Every number is measured on that device,
not asserted.

**Say honestly:** the manifest hash is real and the server recomputes it from
the uploaded bytes. It does **not** go on-chain — the contracts exist and are
tested but the app does not call them yet.

## 3 — The spoof

The spec's version — record a screen replay live — has never been performed.
Show the measured version instead, which is stronger evidence anyway:

```
GENUINE  video=24526d93 imu=24526d93   75.4%
SPOOFED  video=24526d93 imu=149d2df5   23.4%
SPOOFED  video=24526d93 imu=57cbf6bd    8.7%
```

Real footage paired with someone else's motion is what a screen replay looks
like to the validator. Run it live:

```sh
cd web && npx vitest run src/lib/validator/spoof --disable-console-intercept
```

**Say honestly:** mean genuine 59% against mean spoof 24%, and one genuine take
sits three points above the best spoof. That is evidence, not proof, at three
episodes.

## 4 — The market

`/b/bounties/new` — post a bounty. The budget is derived from the allocations,
never typed, so a bounty cannot promise more than it escrows. Try to break it:
set the utility pool to 40 and it refuses, naming the shortfall.

Then `/b/bounties/<id>` — every submission with its scores, the accept or reject
reason in plain language, the manifest hash, and a download for accepted
episodes only.

**Say honestly:** the acceptance decision and the payment amount are real. The
USDC is not — escrow is a JSON file. `BountyEscrow` is written and tested
against Circle's real USDC on a Base Sepolia fork, but nothing is deployed.

## 5 — The model

`/b/model`. The scaling curve falls from 4.95 to 0.85 as episodes go from one to
four, with the seed spread drawn as a band.

**Say honestly, and lead with it:** the model does **not** beat a "predict no
change" baseline. The page says so in those words. Adjacent video frames are
nearly identical, so that baseline is strong, and a model that cannot beat it has
learned only that video is smooth. Hidden sizes 32, 64 and 128 were all tried —
it is a data problem, not a capacity one, and the curve suggests it crosses
somewhere near 8–12 episodes.

This is the most credible thing in the demo. A clean curve at N=6 would be a lie.

## 6 — Federated

`/b/federated`. Two organizations, disjoint partitions, neither shares data.
Each sends a weight update; each update is hashed; the average is evaluated on a
held-out set both can see.

**Say honestly:** the coordination works — data never moves, every contribution
is a verifiable hash. The **learning does not improve across rounds**; error
rises from 0.68 to 0.73. With two episodes per organization the local models
overfit faster than averaging helps. Client drift was confirmed by sweeping
local epochs (5/10/20/40 → 0.682/0.690/0.719/0.744).

And the claim to make, exactly: this is federated **coordination**, not private
federated learning. Averaging updates provides no privacy on its own; gradient
inversion is a published attack and works best with few clients, as here.

---

## Closing

The one line worth ending on:

> Every number you saw was measured on a real phone. The ones that came out
> badly are on the screen too.

## What to have ready

- Phone in the strap, `adb reverse tcp:3000 tcp:3000` running, dev server up
- A lit room — low light halves the camera frame rate
- `web/.data` populated, or the demo has nothing to show
- Trainer already run, so `/b/model` and `/b/federated` have results
