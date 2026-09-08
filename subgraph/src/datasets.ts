import { DatasetMinted, LicensePurchased, Withdrawn } from "../generated/DatasetRegistry/DatasetRegistry";
import { DatasetRegistry } from "../generated/DatasetRegistry/DatasetRegistry";
import { Dataset, DatasetMember, License } from "../generated/schema";
import { ZERO, eventId, protocol, recordPayment } from "./shared";

export function handleDatasetMinted(event: DatasetMinted): void {
  const datasetId = event.params.datasetId.toString();

  const dataset = new Dataset(datasetId);
  dataset.creator = event.params.creator;
  dataset.episodeCount = event.params.episodeCount.toI32();
  dataset.episodesRoot = event.params.episodesRoot;
  dataset.mintedAt = event.block.timestamp;
  dataset.mintedTx = event.transaction.hash;
  dataset.licenseCount = 0;
  dataset.revenueUsdc = ZERO;
  dataset.save();

  // The membership is the edge that makes lineage traversable — dataset back
  // to episode back to the contributor who recorded it — and it is what §6.1
  // means by a queryable graph. The event carries only a root, so the list is
  // read back; committing every id to logs would price minting by bundle size.
  const registry = DatasetRegistry.bind(event.address);
  const members = registry.try_membersOf(event.params.datasetId);
  if (!members.reverted) {
    const ids = members.value;
    for (let i = 0; i < ids.length; i++) {
      const member = new DatasetMember(datasetId + "-" + ids[i].toString());
      member.dataset = datasetId;
      member.episode = ids[i].toString();
      member.save();
    }
  }

  const row = protocol();
  row.datasetCount = row.datasetCount + 1;
  row.save();
}

export function handleLicensePurchased(event: LicensePurchased): void {
  const datasetId = event.params.datasetId.toString();

  const license = new License(eventId(event));
  license.dataset = datasetId;
  license.buyer = event.params.buyer;
  license.priceUsdc = event.params.price;
  license.purchasedAt = event.block.timestamp;
  license.tx = event.transaction.hash;
  license.save();

  const dataset = Dataset.load(datasetId);
  if (dataset != null) {
    dataset.licenseCount = dataset.licenseCount + 1;
    dataset.revenueUsdc = dataset.revenueUsdc.plus(event.params.price);
    dataset.save();
  }
}

export function handleWithdrawn(event: Withdrawn): void {
  recordPayment(event, event.params.account, event.params.amount, "dataset_registry");
}
