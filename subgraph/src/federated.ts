import { Bytes } from "@graphprotocol/graph-ts";
import {
  RoundFinalized,
  RoundOpened,
  UpdateSubmitted,
  Withdrawn,
} from "../generated/FederatedRound/FederatedRound";
import { FederatedRound } from "../generated/FederatedRound/FederatedRound";
import { ModelUpdate, Round } from "../generated/schema";
import { ZERO, eventId, protocol, recordPayment } from "./shared";

export function handleRoundOpened(event: RoundOpened): void {
  const roundId = event.params.roundId.toString();

  const round = new Round(roundId);
  round.modelId = event.params.modelId;
  round.coordinator = event.transaction.from;
  round.payoutPerParticipantUsdc = event.params.payoutEach;
  round.participantCount = event.params.participants.toI32();
  round.openedAt = event.block.timestamp;
  round.openedTx = event.transaction.hash;
  round.status = "open";
  round.paidUsdc = ZERO;

  // §9's on-chain record names the participant list, so it is read back rather
  // than inferred later from whoever happened to submit — the difference
  // between "who was invited" and "who turned up" is the point of the round.
  const contract = FederatedRound.bind(event.address);
  const participants = contract.try_participantsOf(event.params.roundId);
  if (!participants.reverted) {
    const addresses = participants.value;
    const bytes = new Array<Bytes>(0);
    for (let i = 0; i < addresses.length; i++) {
      bytes.push(addresses[i] as Bytes);
    }
    round.participants = bytes;
  } else {
    round.participants = new Array<Bytes>(0);
  }

  round.save();

  const row = protocol();
  row.roundCount = row.roundCount + 1;
  row.save();
}

export function handleUpdateSubmitted(event: UpdateSubmitted): void {
  const update = new ModelUpdate(eventId(event));
  update.round = event.params.roundId.toString();
  update.participant = event.params.participant;
  update.updateHash = event.params.updateHash;
  update.submittedAt = event.block.timestamp;
  update.tx = event.transaction.hash;
  update.save();
}

export function handleRoundFinalized(event: RoundFinalized): void {
  const round = Round.load(event.params.roundId.toString());
  if (round == null) return;

  round.status = "finalized";
  round.globalHash = event.params.globalHash;
  round.metricBps = event.params.metricBps.toI32();
  round.finalizedAt = event.block.timestamp;
  round.finalizedTx = event.transaction.hash;
  round.paidUsdc = event.params.paid;
  round.save();
}

export function handleWithdrawn(event: Withdrawn): void {
  recordPayment(event, event.params.account, event.params.amount, "federated_round");
}
