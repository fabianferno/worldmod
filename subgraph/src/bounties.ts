import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  BountyCreated,
  BountyRefunded,
  EpisodeAccepted,
  UtilityPaid,
  UtilitySettled,
  Withdrawn,
} from "../generated/BountyEscrow/BountyEscrow";
import { Acceptance, Bounty, Episode, UtilityAward } from "../generated/schema";
import { ZERO, entityFor, eventId, recordPayment } from "./shared";

function bountyFor(id: Bytes, timestamp: BigInt, tx: Bytes): Bounty {
  let bounty = Bounty.load(id);
  if (bounty == null) {
    bounty = new Bounty(id);
    bounty.buyer = Bytes.empty();
    bounty.budgetUsdc = ZERO;
    bounty.createdAt = timestamp;
    bounty.createdTx = tx;
    bounty.acceptedCount = 0;
    bounty.paidUsdc = ZERO;
    bounty.utilitySettled = false;
    bounty.utilityDistributedUsdc = ZERO;
    bounty.refundedUsdc = ZERO;
  }
  return bounty as Bounty;
}


export function handleBountyCreated(event: BountyCreated): void {
  const bounty = bountyFor(event.params.bountyId, event.block.timestamp, event.transaction.hash);
  bounty.buyer = event.params.buyer;
  bounty.budgetUsdc = event.params.budget;
  bounty.createdAt = event.block.timestamp;
  bounty.createdTx = event.transaction.hash;
  bounty.save();
}

export function handleEpisodeAccepted(event: EpisodeAccepted): void {
  const bounty = bountyFor(event.params.bountyId, event.block.timestamp, event.transaction.hash);
  bounty.acceptedCount = bounty.acceptedCount + 1;
  bounty.paidUsdc = bounty.paidUsdc.plus(event.params.amount);
  bounty.save();

  const acceptance = new Acceptance(eventId(event));
  acceptance.bounty = bounty.id;
  acceptance.episode = event.params.episodeId.toString();
  acceptance.contributor = event.params.contributor;
  acceptance.amountUsdc = event.params.amount;
  acceptance.acceptedAt = event.block.timestamp;
  acceptance.tx = event.transaction.hash;
  acceptance.save();

  const episode = Episode.load(event.params.episodeId.toString());
  if (episode != null) {
    episode.acceptance = acceptance.id;
    episode.save();
  }

  // Earnings are credited here rather than at withdrawal: what a contributor
  // has been awarded and what they have collected are different questions, and
  // a dashboard asks the first one.
  const contributor = entityFor(
    event.params.contributor,
    event.block.timestamp,
    event.transaction.hash,
  );
  contributor.acceptedCount = contributor.acceptedCount + 1;
  contributor.totalEarnedUsdc = contributor.totalEarnedUsdc.plus(event.params.amount);
  contributor.save();
}

export function handleUtilityPaid(event: UtilityPaid): void {
  const award = new UtilityAward(eventId(event));
  award.bounty = event.params.bountyId;
  award.contributor = event.params.contributor;
  award.shareBps = event.params.shareBps.toI32();
  award.amountUsdc = event.params.amount;
  award.settledAt = event.block.timestamp;
  award.tx = event.transaction.hash;
  award.save();

  const contributor = entityFor(
    event.params.contributor,
    event.block.timestamp,
    event.transaction.hash,
  );
  contributor.totalEarnedUsdc = contributor.totalEarnedUsdc.plus(event.params.amount);
  contributor.save();
}

export function handleUtilitySettled(event: UtilitySettled): void {
  const bounty = bountyFor(event.params.bountyId, event.block.timestamp, event.transaction.hash);
  bounty.utilitySettled = true;
  bounty.utilityDistributedUsdc = event.params.distributed;
  bounty.save();
}

export function handleBountyRefunded(event: BountyRefunded): void {
  const bounty = bountyFor(event.params.bountyId, event.block.timestamp, event.transaction.hash);
  bounty.refundedUsdc = event.params.amount;
  bounty.save();
}

export function handleWithdrawn(event: Withdrawn): void {
  recordPayment(event, event.params.account, event.params.amount, "bounty_escrow");
}
