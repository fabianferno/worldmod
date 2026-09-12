# World Mod — End-to-End Demo Script

A step-by-step script for recording the demo video. It follows one narrative
arc — **a contributor earns, then the buyer/network side that pays them** —
and along the way shows each integration (**World**, **Chainlink CRE**,
**Hedera**) doing something real and on-chain.

Target length: **~4–5 minutes**. Every claim below is backed by something on
screen or on a block explorer — don't say more than the app shows.

---

## 0. Pre-flight (before you hit record)

**Running:**
- Dev server up: `cd web && npm run dev` → `http://localhost:3000`
- Public HTTPS tunnel (needed for the phone's camera/motion — a secure context
  is mandatory for `getUserMedia`/`DeviceMotionEvent`):
  `ngrok http 3000` → current URL: `https://occurrent-nahla-pertinaciously.ngrok-free.dev`
  (regenerate if it changed; free ngrok shows a one-tap "Visit Site" interstitial).

**Have ready:**
- A **phone** (for the contributor capture flow) opened to the tunnel URL, plus
  the **desktop** browser for the buyer/network pages.
- **World App** installed on the phone (for wallet sign-in + Selfie Check). The
  app falls back to a device key if World App isn't present, so the flow still
  works without it — just say which identity you're on.
- Testnet funds already in place (the deployer/relayer covers gas; contributors
  don't need ETH). Hedera testnet account configured (`HEDERA_ACCOUNT_ID` /
  `HEDERA_PRIVATE_KEY`) so the Bond lifecycle buttons appear.

**Two-window setup:** screen-record the **phone** for §2 (capture) and the
**desktop** for §3 (network). A picture-in-picture of the phone over the
desktop works well.

**Authoritative on-chain addresses:** see `contracts/deployments.json`. Key
ones you'll surface (Ethereum Sepolia unless noted):
- WMOD (ERC-20): `0x404C3F4cf93ad608449f222da1b6b0f824c64ed0`
- ValidatorBond: `0xe82c07EbA59EBa7De02cd84DC5c093cf257D0605`
- ChainlinkValidatorConsumer (CRE validation receiver): `0xe0ca68241159A635Bc383f79c7095dC09d9C3dde`
- ChainlinkUtilityOracleConsumer (CRE utility settlement): `0x47Ad260F6930392Df5109F3293500e8026b71f90`
- BountyEscrow: `0x0Be163d4795D77dC8CdB2cAedF08e213ADef27D6`
- USDC (Circle testnet): Sepolia `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`; Hedera HTS `0.0.429274`

> Prefer clicking the **in-app explorer links** over reading addresses aloud —
> it proves the state is live, not slides.

---

## 1. Open — the fork (~20s)

- **Screen:** `/` (home)
- **Do:** Land on the home page. Point out the two paths: *Contribute an
  episode* and *Post or browse bounties*.
- **Say:** "World Mod is a permissionless network for physical-world data. Two
  sides: people who strap on a phone and record real tasks to earn, and buyers
  who pay for that data. Let's follow the money through both."
- **Also show:** tap the **☰ menu** (top-right) once to reveal every screen —
  makes the scope legible in one shot — then close it.

---

## 2. Contributor: record and get paid (~2 min) — phone

### 2a. First-run onboarding
- **Screen:** `/c`
- **Do:** On first visit the **guided tour** auto-starts. Step through it
  (Earned → this take's rate → the recording action → the Account tab). Skip is
  always available.
- **Say:** "First time in, a quick tour points out what you earn and where."

### 2b. Sign in with World App  — **[World]**
- **Screen:** `/c/account` (or the account bar on `/c`)
- **Do:** Tap **Sign in** (globe glyph). Approve the World App wallet prompt.
- **Say:** "Signing in with World App makes your earnings recoverable on another
  phone. Without it you still earn — a device key signs — but this ties you to a
  World account."
- **Shows:** World App wallet auth (MiniKit).

### 2c. Selfie Check — Sybil resistance  — **[World]**
- **Screen:** `/c/account` → **Selfie Check** card (or the gate on `/c` before
  the first recording).
- **Do:** Read the prompt on camera, then tap **Verify** and complete World
  App's Selfie Check.
- **Say:** "Before your first recording, a one-time World personhood check —
  the network's Sybil step — so incentives go to real, distinct people, not one
  person farming with many accounts."
- **Shows:** World ID / IDKit Selfie Check bound to your earning address.

### 2d. Record a 15-second episode
- **Screen:** `/c`
- **Do:** Tap **Start recording**. Show the countdown, then record ~15s of a
  real task (e.g. folding clothes / typing) with hands in view. It stops on its
  own; answer the "Did you finish the task?" prompt.
- **Say:** "Fifteen seconds, scored on the device before it ever uploads.
  Nothing is recorded until I start."

### 2e. Confidential validation  — **[Chainlink CRE]**
- **Screen:** `/c` processing overlay
- **Do:** Let the **"Validating confidentially"** screen show — point at the
  **Chainlink CRE · confidential** chip.
- **Say:** "The public framing/motion scores are measured on the server, but
  whether they clear this bounty's *private* bar is decided inside a **Chainlink
  CRE confidential enclave**, and the verdict is written on-chain by a
  DON-signed report. The threshold itself is never exposed."
- **Shows:** Chainlink CRE confidential compute; `ChainlinkValidatorConsumer`
  on-chain.

### 2f. Result + payout
- **Screen:** result view
- **Do:** Show the verdict (accepted → `+$X USDC`), the **"Confidentially
  validated · Chainlink CRE"** badge, the on-chain rows, then tap **Withdraw**.
- **Say:** "Accepted. Real USDC, credited to my key, signed by my device — the
  relayer only paid the gas. One tap to withdraw."
- **Proof:** open the on-chain tx link.

---

## 3. Buyer / network side (~2 min) — desktop

Reach these from the **☰ menu → The network**.

### 3a. Bounties
- **Screen:** `/b/bounties`
- **Say:** "Buyers post bounties with a rate and an escrowed budget. The one we
  just recorded against is here."

### 3b. Datasets → Hedera Bond lifecycle  — **[Hedera]**
- **Screen:** `/b/datasets`
- **Do:** Point at a dataset minted on-chain from validated episodes. Click
  **ħ Issue as Hedera Bond**, then walk the lifecycle buttons:
  **Mint licence seats → Set coupon → Distribute coupon (USDC)**.
- **Say:** "A dataset can be tokenized as a **Hedera Bond** — a licence
  instrument, not a copy of the data. We mint licence seats to the creator (the
  identity bridge), set a coupon, and pay it out to holders in **real testnet
  USDC** over HTS."
- **Shows:** Hedera ATS Bond + HTS USDC coupon distribution; each step links to
  the Hedera mirror-node record.
- **Proof:** click a transfer's mirror-node link (native `0.0.x@…` tx id).

### 3c. Validator bond → the token is real  — **[Token / Chainlink]**
- **Screen:** `/b/validator`
- **Say:** "**WMOD** is the network token, and this is its one live function: a
  validator stakes WMOD to take part and can be **slashed** for bad validation —
  slashed stake is **burned**, never paid to the slasher."
- **Show:** the live reads — bonded amount, minimum, total, supply — and the
  contract links.
- **Proof:** WMOD `0x404C…4ed0`, ValidatorBond `0xe82c…0605` on Sepolia.

### 3d. World model
- **Screen:** `/b/model`
- **Say:** "What the collected episodes are worth to a forward-dynamics model,
  shown honestly — the scaling curve, and whether it beats the no-change
  baseline yet."

### 3e. Federated rounds — privacy  — **[Chainlink CRE utility oracle nearby]**
- **Screen:** `/b/federated`
- **Say:** "Two orgs train on data neither shares — only weight updates move,
  each hashed. Per round we show the **client-count threshold**, and when
  differential privacy is enabled the trainer emits a real **per-round (ε, δ)**
  that surfaces here."
- **Note:** the shipped default runs **DP-off** (at this scale DP collapses
  utility) — run `python run.py --dp-epsilon 3 --dp-clip 1.0` to light up the
  DP badge on demand if you want to show it.

### 3f. Contributors
- **Screen:** `/b/contributors`
- **Say:** "Reputation derived from what was actually submitted — acceptance
  rate, framing, motion, duplicates. Computed, displayed, not gated on."

---

## 4. Integration cheat-sheet (say the credit clearly)

| Integration | Where in the demo | What's real / on-chain |
|---|---|---|
| **World** | Sign-in (§2b), Selfie Check (§2c) | World App wallet auth + World ID Selfie Check personhood, bound to the earning address |
| **Chainlink CRE** | Confidential validation (§2e); utility settlement | Confidential-enclave verdict via `ChainlinkValidatorConsumer`; `settleUtility` moved to the DON-attested `ChainlinkUtilityOracleConsumer` |
| **Hedera** | Bond lifecycle (§3b) | ATS Bond issuance, licence-seat mint, coupon set + **real HTS USDC** payout (`0.0.429274`) |
| **WMOD token** | Validator bond (§3c) | ERC-20 + `ValidatorBond` stake/slash-to-burn, wired to the EpisodeRegistry |

---

## 5. Keep it honest (what NOT to overclaim)

Say these as strengths, not weaknesses — the honesty is part of the pitch:

- **Trust level is `heuristic`.** The checks measure whether a capture is
  *plausible*, not device-attested. `attested` / `hardware` are **[ROADMAP]** —
  a PWA can't do App Attest / Play Integrity.
- **Federated = coordination + optional DP.** Real DP is implemented and opt-in;
  **secure aggregation** is not claimed.
- **Selfie Check is a personhood check.** It's the Sybil-resistance step;
  active one-account-per-person *enforcement* (nullifier gating) is not yet
  wired — don't claim duplicates are hard-blocked.
- **Native-token utility** beyond validator bonding (governance, M2M
  settlement) is **[ROADMAP]**.

---

## 6. Fallbacks (if something's flaky on the day)

- **No World App / camera:** the device-key path records fine over the tunnel;
  narrate that you're on the device key. Camera needs the **HTTPS tunnel**, not
  `localhost`, on a phone.
- **Hedera not configured:** the "Issue as Hedera Bond" buttons hide themselves;
  show the pre-recorded lifecycle or the mirror-node tx links from a prior run
  (`hedera/README.md` T9/T10).
- **CRE processing screen too fast/slow:** it's a real ~1-minute server pass;
  pre-record 2e if you need a tight cut.

---

## 7. Close (~15s)

- **Screen:** back to `/` or the result screen with USDC withdrawn.
- **Say:** "End to end: a real 15-second capture, validated confidentially by
  Chainlink CRE, paid in real USDC, with the dataset tokenizable as a Hedera
  Bond and the validator bonded in WMOD — all on testnet, all verifiable
  on-chain."
