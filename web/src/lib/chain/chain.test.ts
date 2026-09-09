import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOMAIN_NAMES,
  REGISTER_ASSET_TYPES,
  REGISTER_ENTITY_TYPES,
  SUBMIT_EPISODE_TYPES,
  assetRegistryAbi,
  bountyEscrowAbi,
  datasetRegistryAbi,
  entityRegistryAbi,
  episodeRegistryAbi,
} from "./abi";
import { ADDRESSES } from "./config";

/**
 * The ABIs in this directory are hand-written, and a hand-written ABI that has
 * drifted from its contract fails at runtime with a decode error rather than at
 * build time. These tests read Foundry's own artifacts and compare.
 *
 * They are skipped when the contracts have not been built, so the suite still
 * runs on a machine without Foundry.
 */

const OUT = join(process.cwd(), "..", "contracts", "out");

function artifact(name: string): { abi: unknown[] } | null {
  const path = join(OUT, `${name}.sol`, `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

type AbiFn = { type: string; name?: string; inputs?: { type: string }[]; outputs?: { type: string }[] };

function signature(entry: AbiFn): string {
  return `${entry.name}(${(entry.inputs ?? []).map((i) => i.type).join(",")})`;
}

function signaturesOf(abi: unknown[]): Set<string> {
  return new Set(
    (abi as AbiFn[]).filter((e) => e.type === "function").map(signature),
  );
}

const built = artifact("EpisodeRegistry") !== null;
const when = built ? describe : describe.skip;

when("hand-written ABIs match the compiled contracts", () => {
  const cases: Array<[string, readonly unknown[]]> = [
    ["EntityRegistry", entityRegistryAbi],
    ["AssetRegistry", assetRegistryAbi],
    ["EpisodeRegistry", episodeRegistryAbi],
    ["BountyEscrow", bountyEscrowAbi],
    ["DatasetRegistry", datasetRegistryAbi],
  ];

  for (const [name, mine] of cases) {
    it(`${name}: every function this app calls exists on-chain`, () => {
      const compiled = signaturesOf(artifact(name)!.abi);
      const missing = [...signaturesOf(mine as unknown[])].filter((s) => !compiled.has(s));
      expect(missing).toEqual([]);
    });

    it(`${name}: return types match`, () => {
      const compiled = new Map(
        (artifact(name)!.abi as AbiFn[])
          .filter((e) => e.type === "function")
          .map((e) => [signature(e), (e.outputs ?? []).map((o) => o.type).join(",")]),
      );

      for (const entry of mine as AbiFn[]) {
        if (entry.type !== "function") continue;
        expect(compiled.get(signature(entry))).toBe((entry.outputs ?? []).map((o) => o.type).join(","));
      }
    });
  }
});

/**
 * EIP-712 field order is load-bearing — the struct is hashed in declaration
 * order, so a reordered type produces a signature that recovers to a different
 * address and reverts as InvalidSignature. These assert the exact strings the
 * contracts hash into their typehashes.
 */
describe("EIP-712 types match the contracts' typehash strings", () => {
  function encodeType(name: string, fields: readonly { name: string; type: string }[]): string {
    return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
  }

  it("RegisterEntity", () => {
    expect(encodeType("RegisterEntity", REGISTER_ENTITY_TYPES.RegisterEntity)).toBe(
      "RegisterEntity(uint8 entityType,string metadataURI,uint256 nonce)",
    );
  });

  it("RegisterAsset", () => {
    expect(encodeType("RegisterAsset", REGISTER_ASSET_TYPES.RegisterAsset)).toBe(
      "RegisterAsset(string assetType,uint32 capabilities,string metadataURI,uint256 nonce)",
    );
  });

  it("SubmitEpisode", () => {
    expect(encodeType("SubmitEpisode", SUBMIT_EPISODE_TYPES.SubmitEpisode)).toBe(
      "SubmitEpisode(uint256 assetId,bytes32 bountyId,bytes32 manifestHash,string storageURI,uint256 nonce)",
    );
  });

  it("domain names are the ones each contract declares", () => {
    expect(DOMAIN_NAMES.entity).toBe("WorldModEntityRegistry");
    expect(DOMAIN_NAMES.asset).toBe("WorldModAssetRegistry");
    expect(DOMAIN_NAMES.episode).toBe("WorldModEpisodeRegistry");
  });
});

describe("deployed addresses", () => {
  it("match contracts/deployments.json", () => {
    const path = join(process.cwd(), "..", "contracts", "deployments.json");
    if (!existsSync(path)) return;

    const deployed = JSON.parse(readFileSync(path, "utf8"))["11155111"].contracts;
    expect(ADDRESSES.entityRegistry).toBe(deployed.EntityRegistry);
    expect(ADDRESSES.assetRegistry).toBe(deployed.AssetRegistry);
    expect(ADDRESSES.episodeRegistry).toBe(deployed.EpisodeRegistry);
    expect(ADDRESSES.bountyEscrow).toBe(deployed.BountyEscrow);
    expect(ADDRESSES.datasetRegistry).toBe(deployed.DatasetRegistry);
    expect(ADDRESSES.federatedRound).toBe(deployed.FederatedRound);
  });
});
