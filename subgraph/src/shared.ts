import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { NetworkEntity, Payment, Protocol } from "../generated/schema";

/**
 * Helpers shared by every mapping.
 *
 * The two that matter are `entityFor` and `protocol`. Both exist because a
 * subgraph indexes contracts independently and in block order — an episode can
 * arrive before the entity that submitted it if the registries were deployed
 * apart, and a counter that assumed otherwise would silently undercount.
 */

export const ZERO = BigInt.fromI32(0);

/** The single Protocol row, created on first touch. */
export function protocol(): Protocol {
  let row = Protocol.load("worldmod");
  if (row == null) {
    row = new Protocol("worldmod");
    row.entityCount = 0;
    row.assetCount = 0;
    row.episodeCount = 0;
    row.validatedCount = 0;
    row.datasetCount = 0;
    row.roundCount = 0;
    row.totalPaidUsdc = ZERO;
  }
  return row as Protocol;
}

/**
 * An entity record, created as a stub if the registry has not been seen yet.
 *
 * A contributor can appear in an episode or a payment before their
 * EntityRegistered event is indexed — different contracts, different blocks,
 * and nothing forces the order. Returning a stub keeps the graph connected;
 * handleEntityRegistered fills in the details when it arrives.
 */
export function entityFor(address: Bytes, timestamp: BigInt, tx: Bytes): NetworkEntity {
  let entity = NetworkEntity.load(address);
  if (entity == null) {
    entity = new NetworkEntity(address);
    entity.entityType = "unknown";
    entity.metadataURI = "";
    entity.registeredAt = timestamp;
    entity.registeredTx = tx;
    entity.episodeCount = 0;
    entity.acceptedCount = 0;
    entity.totalEarnedUsdc = ZERO;
  }
  return entity as NetworkEntity;
}

/** Unique within a block and across logs in it. */
export function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

/**
 * Record a withdrawal.
 *
 * `source` names which contract released it. Payments from three contracts
 * would otherwise be indistinguishable rows with the same shape, and "where
 * did this USDC come from" is exactly the question the provenance graph is
 * meant to answer.
 */
export function recordPayment(
  event: ethereum.Event,
  account: Bytes,
  amount: BigInt,
  source: string,
): void {
  const payment = new Payment(eventId(event));
  payment.accountAddress = account;
  payment.amountUsdc = amount;
  payment.source = source;
  payment.withdrawnAt = event.block.timestamp;
  payment.tx = event.transaction.hash;

  const entity = entityFor(account, event.block.timestamp, event.transaction.hash);
  entity.save();
  payment.account = entity.id;
  payment.save();

  const row = protocol();
  row.totalPaidUsdc = row.totalPaidUsdc.plus(amount);
  row.save();
}
