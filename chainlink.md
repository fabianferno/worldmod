Here’s the Chainlink eligibility work as task descriptions, mapped to `worldmod` today (no CRE/Chainlink code in the repo yet; utility scoring is still a centralized trainer; TEE validators are roadmap in the spec).

---

## Task pack: Make World Mod eligible for Chainlink prizes (ETHOnline)

### Context
World Mod’s honest weak spot is the **centralized UtilityOracle / validator**: secrets, scoring criteria, and model eval live off-chain with no TEE story. Chainlink CRE Confidential Workflows are the cleanest upgrade — they match what the product-spec already promised (“TEE validators”, “utility oracle attestation”) without faking privacy.

**Primary target:** Best Confidential Workflow ($2,000 pool)  
**Secondary (only if Continuity Track):** Best Chainlink-Powered Upgrade ($500) — same CRE work can cover both if Continuity applies  
**Optional / separate:** Automated Liquidation Protection Challenge ($500) — **not a natural World Mod fit**; treat as a side contest, not the product narrative

---

# A. Best Confidential Workflow — $2,000  
*(up to 2 teams × $1,000)*

### Recommended product angle
**Confidential Utility + Validation Workflow**  
A CRE Confidential Workflow that:
1. Pulls secrets (validator API keys, model credentials) **inside the TEE**
2. Runs **plausibility scoring and/or leave-one-contributor-out utility** on private episode metadata / intermediate scores inside the enclave
3. Emits only the **public settlement outputs** (accept/reject, utility shares, hashes) for DON consensus / on-chain `recordValidation` or `settleUtility`

This is core product, not a hello-world handler — it replaces the trusted operator for the payment loop.

### Must-ship (qualification bar)

| # | Requirement | World Mod action |
|---|-------------|------------------|
| 1 | CRE Workflow using **Confidential Workflows** | New `cre/` (or `workflows/`) package with a real workflow |
| 2 | Register a confidential TEE handler (`handlerInTee` / `cre.HandlerInTee`) | Implement the scoring / utility path in that handler |
| 3 | Process ≥1 sensitive thing **inside** the enclave | Secret (API key), private threshold, episode features, model response, or intermediate utility matrix |
| 4 | Meaningfully integrated into core app | Triggers on episode submit or bounty settle; result drives accept/pay on-chain or in the app’s settlement path |
| 5 | Prove successful run | CRE CLI **simulation** *or* live CRE deployment + demo video / logs / terminal output in submission |

### Build tasks

| ID | Task | Done when |
|----|------|-----------|
| C1 | Complete CRE setup + Hello Confidential Workflow template; prove `handlerInTee` simulation works | Terminal log of successful TEE handler sim |
| C2 | Design World Mod confidential surface: which inputs stay in TEE vs what leaves for consensus | Short threat model in README (secrets, scores, thresholds private; episode hash + final score public) |
| C3 | Port a **meaningful** slice of validator/utility into the TEE handler (start with: private `min_plausibility` / bounty policy + secret-backed call to scoring API, or in-enclave score aggregation) | Sensitive value never logged outside enclave; only final score/decision egresses |
| C4 | Wire workflow into core loop: episode reaches `scoring` → CRE workflow runs → result feeds acceptance / `BountyEscrow` settle (or posts a signed oracle update the contracts consume) | One happy-path demo: upload → confidential score → pay |
| C5 | Capture evidence: CLI sim (or deployment) + ≤2 min clip of the confidential path | Artifacts ready for submission form |
| C6 | README section: architecture diagram, what is confidential vs public, how to reproduce the sim | Judge-reproducible |

### Explicitly do **not** ship for this prize
- A placeholder `handlerInTee` that echoes “hello”
- Displaying Chainlink Price Feeds only in the UI
- Using deprecated Chainlink Functions / Automation (docs say use **CRE**)

### One-liner for submission
> World Mod runs episode validation and utility scoring inside a Chainlink CRE Confidential Workflow so API credentials, private thresholds, and intermediate model scores never leave the TEE — only the settlement decision hits the chain.

---

# B. Best Chainlink-Powered Upgrade — $500  
*(Continuity Track participants only)*

### When this applies
Only if World Mod is entered under the **Continuity Track** (existing project upgrade). If you’re not Continuity, skip this prize.

### Must-ship
1. Integrate ≥1 Chainlink service in **smart contract logic or on-chain workflows** (CRE Confidential Workflow counts)
2. Integration must cause a **state change on a blockchain** (not frontend-only)
3. Clearly show how the upgrade improves the existing project

### Build tasks (can reuse A)

| ID | Task | Done when |
|----|------|-----------|
| U1 | Confirm Continuity Track eligibility | Yes/no before investing |
| U2 | CRE confidential result → on-chain state change (e.g. `EpisodeRegistry.recordValidation` or `BountyEscrow.acceptEpisode` / `settleUtility` on Sepolia) | Tx hash showing post-CRE state change |
| U3 | Submission narrative: “before = trusted JSON/oracle operator; after = TEE-attested CRE workflow drives escrow” | Written + demo |

**Eligible Chainlink tech (pick CRE first):** CRE / Confidential Workflows, Price Feeds, Data Streams, PoR, VRF. For World Mod, **CRE Confidential** is the real upgrade; Price Feeds are a weak fit unless you price bounties off ETH/USD.

---

# C. Automated Liquidation Protection Challenge — $500  
*(separate mini-contest)*

### Fit with World Mod
**Poor product fit.** This is a virtual ETH-collateral / USDC-debt liquidation game on Sepolia with fixed challenge contracts. It does **not** advance World Mod’s data network story.

### Only pursue if
You have spare capacity and want a second Chainlink shot with a dedicated Confidential Workflow for the challenge rules.

### Must-ship (if you enter)

| ID | Task | Done when |
|----|------|-----------|
| L1 | Fork/use https://github.com/solangegueiros/cf-liquidation-protection-challenge | Repo runs locally |
| L2 | Confidential Workflow: private risk thresholds, protection strategy, credentials inside TEE; avoid liquidation; preserve loan benefit; use emergency capital efficiently | Challenge criteria met in sim |
| L3 | From **Sept 9 → submission deadline**, call `join()` on challenge contract `0x88574e7Cc0027afd04951daa09B64d4441931ba1` (Sepolia) | Join tx confirmed |
| L4 | Submit Deploy Access Form if required; **freeze workflow after deadline** (Chainlink runs scenarios next 24h) | Joined + no post-deadline edits |
| L5 | Keep this **out of** the World Mod demo narrative (or a tiny appendix) | Judges aren’t confused |

---

### Current gap vs bar (honest)

| Prize | World Mod now |
|-------|----------------|
| Confidential Workflow | No CRE; validator/utility are trusted services |
| Chainlink-Powered Upgrade | No Chainlink; escrow still JSON in the web app (Sepolia contracts exist but unused) |
| Liquidation Challenge | Unrelated; not started |

---

### Suggested priority
1. **C1→C5** for Best Confidential Workflow (highest $ and best product fit)  
2. If Continuity: ensure **U2** on-chain state change so the same work claims Upgrade  
3. Liquidation challenge **only** as a weekend side quest after C5 works  

---