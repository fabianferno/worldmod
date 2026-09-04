import { EntityRegistered, EntityUpdated } from "../generated/EntityRegistry/EntityRegistry";
import { entityFor, protocol } from "./shared";

/** EntityRegistry.EntityType, in declaration order. */
function entityTypeName(value: i32): string {
  return value == 0 ? "individual" : value == 1 ? "organization" : "unknown";
}

export function handleEntityRegistered(event: EntityRegistered): void {
  const entity = entityFor(event.params.entity, event.block.timestamp, event.transaction.hash);

  // "unknown" means this address was seen first as a stub — an episode or a
  // payment reached the index before the registration did. Only then is it a
  // new entity as far as the count is concerned.
  const isNew = entity.entityType == "unknown";

  entity.entityType = entityTypeName(event.params.entityType);
  entity.metadataURI = event.params.metadataURI;
  entity.registeredAt = event.block.timestamp;
  entity.registeredTx = event.transaction.hash;
  entity.save();

  if (isNew) {
    const row = protocol();
    row.entityCount = row.entityCount + 1;
    row.save();
  }
}

export function handleEntityUpdated(event: EntityUpdated): void {
  const entity = entityFor(event.params.entity, event.block.timestamp, event.transaction.hash);
  entity.metadataURI = event.params.metadataURI;
  entity.save();
}
