# World Mod contracts

product-spec §11's registries and escrow.

| Contract | Purpose |
|---|---|
| `EntityRegistry` | Individuals and organizations. No PII on-chain. |
| `AssetRegistry` | Registered sensors and their capability bitmask. |
| `EpisodeRegistry` | Episode commitments and validation results. |
| `BountyEscrow` | Demand-first bounties, escrowed in USDC. |
| `Relayable` | Shared EIP-712 verification for contributor-signed calls. |

## Contributors never send a transaction

Every contributor action is signed on the phone and submitted by a relayer,
attributed to the **recovered signer** rather than to whoever paid the gas.
Someone with a phone strapped to their head has a key, not a funded account —
so this removes the paymaster problem from onboarding entirely.

The relayer is untrusted. It can decline to submit, but it cannot alter what
was signed or claim the result; the tests pin each of those attacks.

## Setup

```sh
forge install foundry-rs/forge-std   # not vendored into this repo
cp .env.example .env                 # then fill in PRIVATE_KEY
```

## Test

```sh
forge test                                   # unit tests, offline
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test   # + escrow against real USDC
```

Escrow tests run against Circle's real USDC on a Base Sepolia fork rather than
a mock. That matters: real USDC reverts rather than returning false, and it is
an upgradeable proxy. The fork tests skip themselves without an RPC so the
suite still runs offline.

## Deploy

Fund the deployer with Base Sepolia ETH first, then:

```sh
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```

No token is deployed. The script points at Circle's real USDC for the target
chain and refuses to run if that address has no code there.

The deployer becomes the episode registry's owner and its first validator; add
the validator service key with `setValidator`.
