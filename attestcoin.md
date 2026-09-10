
Primary track: DePIN (best literal fit: sensor/phone network + cross-chain incentives)

Also claimable in narrative: AI (utility/validation triggers) and RWA (dataset / license cashflows) — pick one sector on the form; recommend DePIN.

Product angle:

Treat Sepolia as the source chain of truth for physical episodes and bounty settlement. An Attestcoin Smart Contract (ASC) on Creditcoin testnet verifies those Sepolia txs via Attestcoin Readability, then unlocks Creditcoin-side rewards / dataset claims / contributor credit history — without a centralized oracle.

Phone → Sepolia EpisodeRegistry / BountyEscrow (emit clear events)
              ↓
     Attestcoin attestors + Proof Builder
              ↓
     Off-chain readability worker
              ↓
     ASC on Creditcoin (precompile 0x0FD2) → business logic
              ↓
     CTC rewards / credit score / RWA claim

Must-ship (qualification bar)
#	Requirement	What to build
1	Meaningful Attestcoin Protocol integration	Working ASC + proofs path, not a stub
2	Deployed on testnet	Creditcoin CC3 testnet + keep using Ethereum Sepolia as source (chainKey 1)
3	Technical docs of Attestcoin setup	README section + short architecture write-up
4	Original hackathon-period work	New ASC/worker/Creditcoin contracts clearly dated in repo
5	Submission package	Name, sector, Attestcoin summary, GitHub+README, deck/PDF, demo video, team info
Depth of Attestcoin use is a core scoring criterion.

Build tasks (concrete)
ID	Task	Done when
A1	Env setup: Creditcoin CC3 testnet RPC/wallet, @gluwa/usc-sdk, Proof Builder API (proof-gen-api.cc3-testnet.creditcoin.network), ASC dashboard	Can call Proof Builder + see testnet ASC examples
A2	Source-chain events (Sepolia): add dedicated, unambiguous events on World Mod contracts (do not rely on generic Transfer). Examples: EpisodeAcceptedForAttestation(episodeId, contributor, score, bountyId), BountySettledForAttestation(bountyId, totalPaid, datasetHash)	Events emitted on real Sepolia txs; fields carry everything ASC needs
A3	Deploy ASC on Creditcoin testnet using Block Prover precompile 0x0FD2: verify Merkle + continuity proofs, check receipt status 0x1, replay-protect processedQueries, decode your events	ASC verifies a Sepolia tx and updates CTC state in one call
A4	Business logic on Creditcoin (same contract or separate): e.g. mint contributor reward points / unlock bounty mirror / write on-chain credit history / mint a dataset claim NFT	State change on CTC after successful verify
A5	Readability worker: listen Sepolia events → wait for attestation → Proof Builder → call ASC	Happy path runs without manual proof pasting
A6	Wire into product story: buyer/contributor UI shows “settled on Creditcoin via Attestcoin” with CTC tx link	Demo-visible, not a side script
A7	Docs: Attestcoin Integration Summary (architecture, chainKeys, addresses, event ABIs, how to reproduce)	Meets DoraHacks doc requirement
A8	Public/demo artifacts: testnet deploys, demo video (capture → Sepolia accept → Attestcoin prove → CTC settle), deck/PDF, DoraHacks submit	Submitted before 13 Sep 23:59 ET
Suggested ASC business logic (pick one primary)
DePIN settlement (recommended): Sepolia acceptEpisode → ASC mints/pays contributor rewards on Creditcoin
AI utility settle: Sepolia utility scores posted → ASC releases utility-pool shares on CTC
RWA claim: Sepolia dataset mint / license purchase → ASC issues a Creditcoin-side claim or receipt token
Extra depth (scoring): show batch queries (up to 10) or multiple event types (EpisodeAccepted + BountySettled) with clear replay protection.

Explicitly out of scope / don’t fake
Centralized “relayer” that trusts your server without ASC verify() — disqualifies the theme
Writability (CTC → other chains) if still “coming next” — stick to Readability (live now: read Ethereum/Sepolia)
Rebuilding the whole phone PWA on Creditcoin — keep capture on Sepolia; attest the results
Current gap vs bar
Requirement	World Mod now
Attestcoin / ASC	Not present
Creditcoin testnet deploy	Not present
Source events designed for ASC	Sepolia registries exist; no Attestcoin-oriented events
Worker + Proof Builder	Not present
Docs + demo video for CTC	Not present
Deadline	~4 days (13 Sep ET)
One-liner for DoraHacks “Attestcoin Integration Summary”
World Mod keeps physical episode capture and bounty escrow on Ethereum Sepolia, then uses Attestcoin Protocol Readability so a Creditcoin ASC trustlessly verifies those Sepolia acceptance/settlement transactions and unlocks DePIN rewards — no centralized oracle.Primary track: DePIN (best literal fit: sensor/phone network + cross-chain incentives)

Also claimable in narrative: AI (utility/validation triggers) and RWA (dataset / license cashflows) — pick one sector on the form; recommend DePIN.

Product angle:

Treat Sepolia as the source chain of truth for physical episodes and bounty settlement. An Attestcoin Smart Contract (ASC) on Creditcoin testnet verifies those Sepolia txs via Attestcoin Readability, then unlocks Creditcoin-side rewards / dataset claims / contributor credit history — without a centralized oracle.

Phone → Sepolia EpisodeRegistry / BountyEscrow (emit clear events)
              ↓
     Attestcoin attestors + Proof Builder
              ↓
     Off-chain readability worker
              ↓
     ASC on Creditcoin (precompile 0x0FD2) → business logic
              ↓
     CTC rewards / credit score / RWA claim

Must-ship (qualification bar)
#	Requirement	What to build
1	Meaningful Attestcoin Protocol integration	Working ASC + proofs path, not a stub
2	Deployed on testnet	Creditcoin CC3 testnet + keep using Ethereum Sepolia as source (chainKey 1)
3	Technical docs of Attestcoin setup	README section + short architecture write-up
4	Original hackathon-period work	New ASC/worker/Creditcoin contracts clearly dated in repo
5	Submission package	Name, sector, Attestcoin summary, GitHub+README, deck/PDF, demo video, team info
Depth of Attestcoin use is a core scoring criterion.

Build tasks (concrete)
ID	Task	Done when
A1	Env setup: Creditcoin CC3 testnet RPC/wallet, @gluwa/usc-sdk, Proof Builder API (proof-gen-api.cc3-testnet.creditcoin.network), ASC dashboard	Can call Proof Builder + see testnet ASC examples
A2	Source-chain events (Sepolia): add dedicated, unambiguous events on World Mod contracts (do not rely on generic Transfer). Examples: EpisodeAcceptedForAttestation(episodeId, contributor, score, bountyId), BountySettledForAttestation(bountyId, totalPaid, datasetHash)	Events emitted on real Sepolia txs; fields carry everything ASC needs
A3	Deploy ASC on Creditcoin testnet using Block Prover precompile 0x0FD2: verify Merkle + continuity proofs, check receipt status 0x1, replay-protect processedQueries, decode your events	ASC verifies a Sepolia tx and updates CTC state in one call
A4	Business logic on Creditcoin (same contract or separate): e.g. mint contributor reward points / unlock bounty mirror / write on-chain credit history / mint a dataset claim NFT	State change on CTC after successful verify
A5	Readability worker: listen Sepolia events → wait for attestation → Proof Builder → call ASC	Happy path runs without manual proof pasting
A6	Wire into product story: buyer/contributor UI shows “settled on Creditcoin via Attestcoin” with CTC tx link	Demo-visible, not a side script
A7	Docs: Attestcoin Integration Summary (architecture, chainKeys, addresses, event ABIs, how to reproduce)	Meets DoraHacks doc requirement
A8	Public/demo artifacts: testnet deploys, demo video (capture → Sepolia accept → Attestcoin prove → CTC settle), deck/PDF, DoraHacks submit	Submitted before 13 Sep 23:59 ET
Suggested ASC business logic (pick one primary)
DePIN settlement (recommended): Sepolia acceptEpisode → ASC mints/pays contributor rewards on Creditcoin
AI utility settle: Sepolia utility scores posted → ASC releases utility-pool shares on CTC
RWA claim: Sepolia dataset mint / license purchase → ASC issues a Creditcoin-side claim or receipt token
Extra depth (scoring): show batch queries (up to 10) or multiple event types (EpisodeAccepted + BountySettled) with clear replay protection.

Explicitly out of scope / don’t fake
Centralized “relayer” that trusts your server without ASC verify() — disqualifies the theme
Writability (CTC → other chains) if still “coming next” — stick to Readability (live now: read Ethereum/Sepolia)
Rebuilding the whole phone PWA on Creditcoin — keep capture on Sepolia; attest the results
Current gap vs bar
Requirement	World Mod now
Attestcoin / ASC	Not present
Creditcoin testnet deploy	Not present
Source events designed for ASC	Sepolia registries exist; no Attestcoin-oriented events
Worker + Proof Builder	Not present
Docs + demo video for CTC	Not present
Deadline	~4 days (13 Sep ET)
One-liner for DoraHacks “Attestcoin Integration Summary”
World Mod keeps physical episode capture and bounty escrow on Ethereum Sepolia, then uses Attestcoin Protocol Readability so a Creditcoin ASC trustlessly verifies those Sepolia acceptance/settlement transactions and unlocks DePIN rewards — no centralized oracle. 

https://docs.attestcoin.org/

