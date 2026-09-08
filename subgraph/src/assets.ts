import { AssetRegistered, AssetRetired } from "../generated/AssetRegistry/AssetRegistry";
import { Asset } from "../generated/schema";
import { entityFor, protocol } from "./shared";

export function handleAssetRegistered(event: AssetRegistered): void {
  const owner = entityFor(event.params.owner, event.block.timestamp, event.transaction.hash);
  owner.save();

  const asset = new Asset(event.params.assetId.toString());
  asset.owner = owner.id;
  asset.assetType = event.params.assetType;
  // uint32 arrives as BigInt: graph-ts widens anything that will not fit a
  // signed 32-bit int. Only eight modality bits are defined, so the narrowing
  // is safe.
  asset.capabilities = event.params.capabilities.toI32();
  asset.retired = false;
  asset.registeredAt = event.block.timestamp;
  asset.registeredTx = event.transaction.hash;
  asset.save();

  const row = protocol();
  row.assetCount = row.assetCount + 1;
  row.save();
}

export function handleAssetRetired(event: AssetRetired): void {
  const asset = Asset.load(event.params.assetId.toString());
  if (asset == null) return;

  // Retired, not deleted: §4.2's episodes outlive the asset that produced them,
  // and removing it would break the lineage they hang from.
  asset.retired = true;
  asset.save();
}
