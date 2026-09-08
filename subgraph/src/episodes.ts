import {
  EpisodeSubmitted,
  ValidationRecorded,
} from "../generated/EpisodeRegistry/EpisodeRegistry";
import { EpisodeRegistry } from "../generated/EpisodeRegistry/EpisodeRegistry";
import { Asset, Episode, Validation } from "../generated/schema";
import { entityFor, eventId, protocol } from "./shared";

/** EpisodeRegistry.TrustLevel, in declaration order. §6.4's ladder. */
function trustLevelName(value: i32): string {
  if (value == 0) return "self_reported";
  if (value == 1) return "heuristic";
  if (value == 2) return "attested";
  if (value == 3) return "hardware";
  return "unknown";
}

export function handleEpisodeSubmitted(event: EpisodeSubmitted): void {
  const contributor = entityFor(
    event.params.contributor,
    event.block.timestamp,
    event.transaction.hash,
  );
  contributor.episodeCount = contributor.episodeCount + 1;
  contributor.save();

  const episode = new Episode(event.params.episodeId.toString());
  episode.contributor = contributor.id;
  episode.asset = event.params.assetId.toString();
  episode.manifestHash = event.params.manifestHash;
  episode.submittedAt = event.block.timestamp;
  episode.submittedTx = event.transaction.hash;

  // The event carries the manifest hash but not the bounty or the storage URI,
  // so they are read back from the registry. One call, and it keeps the event
  // small — an event wide enough to avoid this would cost every submitter gas
  // for data only an indexer reads.
  const registry = EpisodeRegistry.bind(event.address);
  const stored = registry.try_getEpisode(event.params.episodeId);
  if (!stored.reverted) {
    episode.bountyId = stored.value.bountyId;
    episode.bounty = stored.value.bountyId;
    episode.storageURI = stored.value.storageURI;
  } else {
    episode.bountyId = event.params.manifestHash;
    episode.storageURI = "";
  }

  episode.save();

  // An asset stub, if the registries were indexed out of order.
  if (Asset.load(event.params.assetId.toString()) == null) {
    const asset = new Asset(event.params.assetId.toString());
    asset.owner = contributor.id;
    asset.assetType = "unknown";
    asset.capabilities = 0;
    asset.retired = false;
    asset.registeredAt = event.block.timestamp;
    asset.registeredTx = event.transaction.hash;
    asset.save();
  }

  const row = protocol();
  row.episodeCount = row.episodeCount + 1;
  row.save();
}

export function handleValidationRecorded(event: ValidationRecorded): void {
  const episodeId = event.params.episodeId.toString();

  const validation = new Validation(eventId(event));
  validation.episode = episodeId;
  validation.score = event.params.score;
  validation.trustLevel = trustLevelName(event.params.trustLevel);
  validation.validator = event.params.validator;
  validation.validatedAt = event.block.timestamp;
  validation.tx = event.transaction.hash;
  validation.save();

  const episode = Episode.load(episodeId);
  if (episode != null) {
    episode.validation = validation.id;
    episode.save();
  }

  const row = protocol();
  row.validatedCount = row.validatedCount + 1;
  row.save();
}
