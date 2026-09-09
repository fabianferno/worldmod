# Subgraph

**Status: not wired into `web/`, and the contracts it indexes have since
migrated to Hedera testnet** (see the repo's Sepolia-to-Hedera migration
plan). Left in place rather than deleted — it's real, working code, and
removing it costs a working reference for no benefit. `web/src/lib/hedera/
lineage.ts` covers the same product-spec §6.1 requirement a different way:
live queries against Hedera's mirror node (no subgraph-equivalent indexer
exists there, so this was never a like-for-like port), decoded with the
same event definitions this subgraph's own mapping handlers
(`src/*.ts`) already document — that's the reference for which events
matter and how they join, even on the new path.

The provenance graph, indexed from the six contracts on Ethereum Sepolia.

product-spec §6.1 claims lineage as *"a queryable graph"* and demo scene 6 closes
on it — physical act → episode → dataset → model → payment, queried live. This is
what makes that one request instead of six contract calls and a join done by hand.

## Running it

Needs Node 20.18.1 or newer — graph-cli refuses to start on 18, and this
machine's default is 22, which works.

```sh
cd subgraph && npm install
npm run codegen        # types from the ABIs and the schema
npm run build          # compile the mappings to WASM
```

Deploying needs a Graph Studio key:

```sh
npx graph auth <deploy-key>
npx graph deploy worldmod
```

Or locally, against a graph-node:

```sh
npm run create-local && npm run deploy-local
```

## What it indexes

| Source | Address | From block |
|---|---|---|
| EntityRegistry | `0x5f73D8d846AC9E8d487072f7Bd09af5e4E5c8928` | 11578798 |
| AssetRegistry | `0xd167a52404E546FF1342faf91f6c097568039708` | 11578798 |
| EpisodeRegistry | `0xA5dB7Ad4BcCA2E2a189c257606c4B96AD32b563F` | 11578798 |
| BountyEscrow | `0x0Be163d4795D77dC8CdB2cAedF08e213ADef27D6` | 11634420 |
| DatasetRegistry | `0x1df8feDf50394A9e0f78cb0EF8F187D587812cbB` | 11634706 |
| FederatedRound | `0x65297C410B96C3604b0A41921e355B24E6cf782e` | 11634707 |

Start blocks are the deployments, so a fresh index does not walk Sepolia from
genesis.

## The query the demo closes on

One request, whole chain of custody:

```graphql
{
  episodes(first: 10, orderBy: submittedAt, orderDirection: desc) {
    id
    manifestHash
    storageURI
    contributor { id entityType totalEarnedUsdc }
    asset { assetType capabilities }
    validation { score trustLevel validator }
    acceptance { amountUsdc tx }
    datasets { dataset { id licenseCount revenueUsdc } }
  }
}
```

Network totals without aggregating client-side:

```graphql
{
  protocol(id: "worldmod") {
    entityCount assetCount episodeCount validatedCount
    datasetCount roundCount totalPaidUsdc
  }
}
```

Federated rounds, with who was invited against who turned up:

```graphql
{
  rounds(orderBy: openedAt) {
    id modelId status participants participantCount
    globalHash metricBps paidUsdc
    updates { participant updateHash }
  }
}
```

## Three notes on the design

**Stubs, not dropped edges.** A subgraph indexes each contract independently and
in block order, so a contributor can appear in an episode before their
`EntityRegistered` event is reached. Handlers create a stub entity rather than
skipping the row; the registration handler fills it in when it arrives and only
counts it once. Without this, an episode's contributor edge would dangle.

**No GraphQL type may be called `Entity`.** graph-ts exports a base class of
that name and every generated type extends it, so `type Entity` compiles to
`class Entity extends Entity` — a class extending itself. The AssemblyScript
compiler spins on that forever and emits nothing at all: no error, no timeout,
no output file. §4.1's word is "entity", so the type here is `NetworkEntity` and
the meaning is unchanged.

**Some fields are read back rather than emitted.** `EpisodeSubmitted` carries the
manifest hash but not the bounty or the storage URI, and `DatasetMinted` carries a
root rather than the member list. Widening those events to save the indexer a call
would charge every submitter gas for data only an indexer reads.
