If you have a demonstration, link to it here! *
https://worldmod.vercel.app/c  (live PWA, open on a phone; buyer side at https://worldmod.vercel.app/b/bounties; landing at https://worldmod-landing.vercel.app)
<!-- TODO: paste the demo video URL here before submitting -->

Short description *
A max 100-character or less description of your project (it should fit in a tweet!)

Anyone with a phone records short real-world tasks for robot training and gets paid in USDC.

Description *
Go in as much detail as you can about what this project is. Please be as clear as possible! (min 280 characters)

World Mod is a permissionless network for physical-world data. Anyone with a phone opens a web page, does a short physical task while the camera watches, and gets paid in USDC once the recording is accepted. A buyer posts what they need and escrows what it pays. Nothing to install, no hardware to buy, no gas to hold.

**Why this exists.** Robots cannot learn from the internet the way language models did. They need first-person video of humans handling objects, and the datasets that exist today were collected by expensive, centralised research programs with recruited participants and custom hardware. The scarce resource is not storage or compute. It is someone doing a physical thing while a sensor is pointed at it. World Mod makes that contribution nearly frictionless and pays the person who made it.

**How an episode earns**

![How an episode earns](https://raw.githubusercontent.com/fabianferno/worldmod/main/docs/diagrams/how-an-episode-earns.png)

1. **A buyer posts a bounty** ("15 seconds of keyboard typing, hands in frame") and escrows the full budget in real USDC. A bounty is only listed once it is funded.
2. **A contributor opens the app inside World App.** Their World wallet is their identity, and a one-time Selfie Check keeps one person from farming payouts across many devices.
3. **They record a 15-second task** on their phone. A head strap gives the best first-person footage but is optional; holding the phone works too. The app shows a live hand skeleton so they can see they are in frame.
4. **The recording is sealed on the device** before a single byte leaves it: hashed, signed with the contributor's key, and queued so going offline mid-task loses nothing.
5. **The server scores every frame.** Are the hands in frame? Does the camera motion agree with the gyroscope (a screen replay fails this)? Is it a near-duplicate of something already submitted? We measured the replay check against real recordings: genuine takes correlate at 59% on average, replays at 24%.
6. **The buyer's acceptance threshold is checked inside a TEE** by a Chainlink CRE Confidential Workflow, so the bar a buyer sets is never visible on-chain or to the operator. A pass is written on-chain as a DON-signed report. A rejection makes no on-chain call at all.
7. **The contributor is paid from escrow** in real USDC, into a balance only they can withdraw. They never need gas.

**What accepted episodes become.** Episodes are bundled into a licensed dataset with a real IPFS content address and an on-chain registry entry. A buyer can tokenise that dataset as a KYC-gated Bond on Hedera, mint licence seats to the dataset's creator, and pay licence-fee coupons in USDC. Meanwhile a world model trains over the episodes and runs live during the next take, showing the wearer what it thinks happens next. A second Confidential Workflow settles each contributor's share of model improvement on-chain.

**What is real today.** All six registry and escrow contracts are deployed on both Ethereum Sepolia and Hedera testnet, using Circle's testnet USDC on both, not a mock token. Real episodes from three contributors have been captured, scored, anchored, paid and tokenised. A real Selfie Check has completed end to end against World's sandbox.

**What we say plainly.** A browser has no secure enclave, so every episode carries a "heuristic" trust level in the UI: the checks measure whether a capture is plausible, not that pixels came from a real camera. With five episodes the world model does not yet beat a "predict no change" baseline, and the buyer dashboard shows that curve rather than hiding it. We would rather ship a real pipeline that improves with every episode than a mock that looks finished.

How it's made *
Tell us about how you built this project; the nitty-gritty details. What technologies did you use? How are they pieced together? If you used any partner technologies, how did it benefit your project? Did you do anything particuarly hacky that's notable and worth mentioning? (min 280 characters)

![World Mod components](https://raw.githubusercontent.com/fabianferno/worldmod/main/docs/diagrams/component-diagram.png)

**The phone.** A Next.js PWA, installable on iOS and Android. Capture is getUserMedia plus MediaRecorder with per-browser codec negotiation recorded into the manifest, DeviceMotionEvent for 60Hz IMU, and TensorFlow.js hand-pose detection with self-hosted 4MB lite models for the live skeleton. The manifest is canonicalised with RFC 8785 and the IMU is hashed as a binary stream, because float formatting across two runtimes is where byte-exactness dies. Scoring used to run on the phone too. We measured it dropping capture to 26.9fps with 818ms gaps during movement, so it moved to the server; a client-computed score was never authoritative anyway.

**The server.** ffmpeg decodes every frame. Optical flow is correlated against the gyroscope with lag estimation, because the frame and IMU clocks are offset and a zero-lag correlation scored a genuine capture below a spoof. Fixing that took one episode from 5.2% to 59.6%. Perceptual hashing catches duplicates. Episode bytes and dataset metadata are pinned to IPFS through a local kubo node.

**Contracts.** Foundry. EntityRegistry, AssetRegistry, EpisodeRegistry, BountyEscrow, DatasetRegistry and FederatedRound, plus a native WMOD token whose one shipped function is a ValidatorBond that stakes and slashes validators. Contributors sign EIP-712 payloads that a relayer submits, so nobody needs gas. Escrow credits a pull-based balance so nobody else can redirect a payout. The same contracts are deployed on Ethereum Sepolia and Hedera testnet, switched by one environment variable.

**Chainlink CRE.** Two Confidential Workflows, both registered with cre.handlerInTee. The episode validator fetches the buyer's minimum framing and plausibility thresholds with runtime.getSecrets so they are only ever decrypted inside the enclave, pulls scored episodes over HTTPClient, compares in-enclave, and on a pass calls donRuntime.report then evmClient.writeReport into a consumer contract registered as an EpisodeRegistry validator. The utility oracle holds the utility weighting exponent as a secret, computes normalised basis-point shares in-enclave, and the DON co-signs them into a second consumer that is now BountyEscrow's registered oracle. Both consumers follow Chainlink's ReceiverTemplate and accept the production Sepolia KeystoneForwarder. This replaced the product's biggest trust assumption: one EOA acting as validator and oracle.

**Hedera.** The core contracts call the HTS precompile in their constructors to self-associate with Circle's HTS USDC. Forge's local EVM has no HTS precompile, so those three had to be deployed via raw viem over Hashio instead of forge script. On top, a licensed dataset becomes an Asset Tokenization Studio Bond: the app reads the DatasetRegistry live, maps it through a tested dataset-to-bond mapping with a valid ISIN, issues via Bond.create, grants KYC with a real Terminal3 Verifiable Credential, mints licence seats to the dataset creator, sets a 5% coupon, and distributes it in real USDC. Four Bonds are source-verified on Sourcify for chain 296.

**World.** The app is a MiniKit mini app. MiniKit.walletAuth gives contributors a recoverable identity, and MiniKit.signTypedData signs the same EIP-712 payloads the previous Privy signer did, a transport swap rather than a redesign. Selfie Check uses IDKitRequestWidget with the selfieCheckLegacy preset and a server-signed RP context. The verify route calls World's production v4 verify API and only records a verification when World says success.

**World model.** A PyTorch encoder plus GRU dynamics head, exported to ONNX and checked against the PyTorch graph over an eight-step recurrent sequence (worst-case difference 2.5e-5). During capture the phone streams a cropped frame and motion sample twice a second, the server keeps the GRU hidden state per session, and returns the nearest-neighbour frame from the same take.

**Hacky things worth mentioning.** The Hedera ATS SDK has no raw-key signing path; its public wallet list is MetaMask, WalletConnect and enterprise custody only. We wired an ethers.Wallet directly onto its transaction adapter and stubbed the hard global.window gate. That stub then broke Next.js server rendering across the whole app, because React checks typeof window in its own internals, so ATS issuance now runs in a short-lived child process that starts, issues one Bond, prints one line of JSON, and exits. Granting KYC and setting coupons both revert on a fresh Bond because the diamond owner does not receive _KYC_ROLE or _CORPORATEACTIONS_ROLE automatically; we found that by decoding reverts on the mirror node, and in the process discovered our own account-id and private-key pair had been mismatched from day one. Nobody had verified the ATS ResolverProxy on Hedera testnet before, so we recovered the compiler version from the on-chain metadata CBOR and rebuilt 153 source files to a byte-exact match.

GitHub Repositories *
Add any repositories that contain code for your project. Please make sure the repositories are public.

https://github.com/fabianferno/worldmod

Describe how AI tools were used in your project (if applicable)
Be specific about which tools were used and explain which parts of the projects they were used for. This field may be left blank if no AI tools were used.

Claude Code was used as a pair programmer throughout, driven by a product spec we wrote first that separates [MVP], [PROTOCOL] and [ROADMAP] claims so nothing got overstated. It scaffolded the Foundry contracts and tests, wrote the CRE Confidential Workflows starting from the CLI-scaffolded hello-confidential-workflows-ts and keeper-bot-ts templates, wrote the Hedera ATS scripts and the Sourcify verification tooling, ported the Privy signer to MiniKit, and built the capture and buyer UIs against a design spec. It was also used to reverse-engineer undocumented SDK behaviour by reading installed type definitions and SDK test suites (the ATS raw-key signing path, the IDKit RpContext protocol). Every on-chain claim in the READMEs was verified by a human against a block explorer, mirror node or Sourcify before being written down. The hand-pose and optical-flow models are off-the-shelf; the world model was trained by us on our own episodes. The two diagrams above were generated with Excalidraw from a script.

Prize	How are you using this Protocol / API? *
Hedera - $15000
Please add a sentence or two on why you're applicable for this prize.

World Mod tokenises licensed physical-world datasets as compliant Asset Tokenization Studio Bonds on Hedera testnet: a buyer clicks "Issue as Hedera Bond" on a real dataset, the app issues the Bond, grants KYC with a real Verifiable Credential, mints licence seats to the dataset's creator, fixes a licence-fee coupon, and pays it out in real HTS USDC, with every step confirmed on the mirror node and the Bonds source-verified on Sourcify. The full DePIN loop (capture, validate, mint, escrow) is also deployed on Hedera testnet with contracts that self-associate to USDC through the HTS precompile, so this is "Tokenization of Anything" applied to a data asset that actually exists on-chain.

Link to the line of code where the tech is used.
https://github.com/fabianferno/worldmod/blob/main/docs/sponsor-links.md#hedera

How easy is it to use the API / Protocol? (1 - very difficult, 10 - very easy)
4

Additional feedback for the Sponsor. They will use this to make the tech and documentation better.

The ATS SDK has no documented way to sign with a raw private key; the public wallet list is MetaMask, WalletConnect, DFNS, Fireblocks and AWS KMS, which rules out server-side or CI use. We found the path by reading the SDK's own integration tests and reaching into internals its exports map hides, plus stubbing a hard global.window check. A first-class "sign with an ethers.Signer" option would have saved most of a day. The npm-latest SDK also targets a different factory and resolver version than the live testnet infrastructure, and nothing says which SDK version matches which deployment. Freshly issued Bonds start with none of the delegable roles (_KYC_ROLE, _SSI_MANAGER_ROLE, _CORPORATEACTIONS_ROLE) granted even to the diamond owner, and the SDK's own Bond.test.js hides this because its fixture account already holds them; one line in the setCoupon and grantKyc docs would prevent a confusing AccountNotAssignedToRole revert. setCoupon timestamps must be in the future at mining time, not at request-build time, which is a surprising WrongTimestamp revert. Forge's revm cannot simulate the HTS precompile, so any contract touching 0x167 in its constructor cannot be deployed with forge script; documenting that with a viem/Hashio example would help every Foundry team. The mirror node and HashScan were excellent for debugging, and decoding reverts there is what made all of the above solvable.

World - $7000
Please add a sentence or two on why you're applicable for this prize.

World Mod runs as a MiniKit mini app: World App wallet auth is the contributor's recoverable identity and MiniKit.signTypedData signs the EIP-712 submissions the relayer anchors on-chain. Because the network pays per accepted episode, the obvious abuse is one person farming payouts across many device identities, so Selfie Check is a hard abuse-prevention gate before a contributor's first recording; the server independently verifies the credential against World's production v4 verify API, and a real Selfie Check has completed end to end in the sandbox. The feedback document covering the docs and integration flow, Developer Portal, Sandbox App states and edge cases, and what was confusing or hard to test is at https://github.com/fabianferno/worldmod/blob/main/world/FEEDBACK.md and the working app is at https://worldmod.vercel.app/c.

Link to the line of code where the tech is used.
https://github.com/fabianferno/worldmod/blob/main/docs/sponsor-links.md#world

How easy is it to use the API / Protocol? (1 - very difficult, 10 - very easy)
5

Additional feedback for the Sponsor. They will use this to make the tech and documentation better.

The docs and the shipped SDK describe two different protocol generations. The credentials/11 page talks about IDKit with a bare app_id and a verification_level, but @worldcoin/idkit-core 4.x has no VerificationLevel enum; it uses a CredentialType union and requires an RpContext signed by a relying-party key via @worldcoin/idkit-server, which the credential docs never mention. We reconstructed the real flow from the bundled README, installed .d.ts files and the selfieCheckLegacy JSDoc. The server-side verify endpoint (POST /api/v4/verify/{rp_id}) exists and works well, but it is three link-hops from the Selfie Check page and not mentioned in the SDK's type comments, which point at WorldIDVerifier.sol instead. There is no error-code catalogue in the docs; every IDKitErrorCodes value we handle came from the type file. The sandbox testing page for Selfie Check is genuinely good: the hot/cold/semi-cold by native/web matrix and the named iOS invite-code landmine are exactly the detail the credentials page lacks. Sandbox access is self-serve in the portal but Selfie Check Beta is a human email request with no in-product starting point, and nothing explains the difference. Once granted, the sandbox flow worked first time. The full write-up is at world/FEEDBACK.md in the repo.

Chainlink - $3000
Please add a sentence or two on why you're applicable for this prize.

World Mod ships two CRE Confidential Workflows that replace the product's single biggest trust assumption, one EOA acting as validator and utility oracle. episode-validator fetches the buyer's private acceptance thresholds with runtime.getSecrets inside cre.handlerInTee, compares each scored episode in the enclave, and on a pass delivers a DON-signed report via writeReport to a consumer contract registered as an EpisodeRegistry validator on Sepolia; a rejection makes no on-chain call, so the threshold is never inferable. utility-oracle keeps the utility weighting policy secret, computes contributor shares in-enclave, and the DON co-signs them into a second consumer that is now BountyEscrow's oracle for settleUtility. Both consumers are deployed and wired, the real simulation output is in cre/README.md, and 10/10 unit tests confirm neither secret ever appears in a log line.

Link to the line of code where the tech is used.
https://github.com/fabianferno/worldmod/blob/main/docs/sponsor-links.md#chainlink

How easy is it to use the API / Protocol? (1 - very difficult, 10 - very easy)
7

Additional feedback for the Sponsor. They will use this to make the tech and documentation better.

The CLI-scaffolded templates (hello-confidential-workflows-ts, keeper-bot-ts) were the most reliable source of truth; we built by reading them and it worked. The simulator is excellent for the confidential path: it states which TEE the trigger would run in and lets you exercise both the getSecrets and writeReport branches locally. Things that cost time: the Workflow Registry being anchored on Ethereum mainnet means link-key and deploy both need a funded mainnet owner key even for a Sepolia-only workflow, which is surprising for a hackathon and not prominent in the docs. Confidential Workflows deploy access is a separate private beta from general CRE access, and the difference between "cre account access says deploy enabled" and "Confidential Workflows enabled" was unclear until we hit it. A table of KeystoneForwarder addresses per chain, plus a note that the tenant mock forwarder has its own address, would remove guesswork (we found ours via cre workflow supported-chains). Per-workflow static secret IDs mean one workflow instance per bounty; dynamic secret lookup keyed on runtime data would let one workflow serve many buyers. Overall the SDK ergonomics (handlerInTee, HTTPClient, prepareReportRequest) are clean and the TypeScript types caught most mistakes at compile time.

Which other partners' technologies have you used on your project?
Select any additional technologies you used but aren't applying for prizes

Ethereum Sepolia (full contract deployment, kept as the fallback network), Circle USDC (real testnet token on both Sepolia and Hedera, no mock), IPFS (episode bytes and dataset metadata pinned with real content addresses via kubo), Sourcify (contract verification on Hedera testnet), TensorFlow.js (hand-pose detection and optical flow), PyTorch and ONNX Runtime (world model training and live inference), Foundry, Next.js, viem.
