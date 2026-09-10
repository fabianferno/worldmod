/**
 * Relay a contributor's signed episode onto the chain.
 *
 * The phone signs; this pays. Nothing here can change what was signed — the
 * contracts recover the signer from the signature and attribute the episode to
 * them, so a dishonest relayer can withhold a submission but cannot steal or
 * alter one.
 *
 * Called after an episode has been scored. This route only commits the
 * episode's manifest hash — it no longer records a validation score itself.
 * That comparison now happens inside a Chainlink CRE Confidential Workflow
 * (see `cre/episode-validator/`), which reaches its own verdict against the
 * bounty's private threshold and writes it on-chain via a DON-signed report.
 */

import { fileStore } from "@/lib/market/store";
import { CHAIN, chainEnabled } from "@/lib/chain/config";
import { acceptEpisodeOnChain, bountyExists, fundGas } from "@/lib/chain/escrow";
import { anchorEpisode, type RelayedSignatures } from "@/lib/chain/relay";

/**
 * Gas dust for the contributor, so they can collect their own payment.
 *
 * The escrow credits a balance and the recipient pulls it — right shape, but a
 * phone that has never held ETH cannot call withdraw at all. Enough for a few
 * withdrawals on a testnet and not a penny more; this is a faucet, not an
 * allowance.
 */
const WITHDRAW_GAS_WEI = BigInt("2000000000000000"); // 0.002 ETH

export async function POST(request: Request) {
  if (!chainEnabled()) {
    return Response.json({ error: "Anchoring is not configured." }, { status: 501 });
  }

  let body: { episodeId?: string; signed?: RelayedSignatures };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  const { episodeId, signed } = body;
  if (!episodeId || !signed?.contributor || !signed.episode) {
    return Response.json({ error: "episodeId and signed episode are required." }, { status: 400 });
  }

  const episodes = await fileStore.listEpisodes();
  const episode = episodes.find((e) => e.episode_id === episodeId);
  if (!episode) return Response.json({ error: "No such episode." }, { status: 404 });
  if (episode.status !== "scored") {
    return Response.json({ error: "Only a scored episode can be anchored." }, { status: 409 });
  }
  if (episode.anchor?.onchain_episode_id) {
    return Response.json({ anchor: episode.anchor, alreadyAnchored: true });
  }

  // The manifest hash the chain commits to is the one the server verified from
  // the uploaded bytes, never one supplied alongside the signature.
  if (signed.episode.manifestHash.toLowerCase() !== episode.manifest_hash.toLowerCase()) {
    return Response.json(
      { error: "Signed manifest hash does not match the stored episode." },
      { status: 422 },
    );
  }

  const result = await anchorEpisode(signed);

  const anchor = {
    chain_id: CHAIN.id,
    onchain_episode_id: result.episodeId,
    contributor: signed.contributor,
    txs: result.txs.map((t) => ({ step: t.step, hash: t.hash })),
    anchored_at: Math.floor(Date.now() / 1000),
    error: result.ok ? undefined : result.error,
  };

  await fileStore.recordAnchor(episodeId, anchor);

  // Payment only for an episode the validator actually accepted, and only once
  // it is on-chain — the escrow reads the validation from the registry itself
  // and refuses to pay for work nobody checked.
  let payment = undefined;
  if (result.ok && result.episodeId && episode.accepted) {
    payment = await releasePayment(episode.bounty_id, result.episodeId, signed.contributor, episode.paid_usdc);
    if (payment) await fileStore.recordPayment(episodeId, payment);
  }

  return Response.json({ anchor, payment }, { status: result.ok ? 200 : 502 });
}

/**
 * Release an accepted episode's USDC, and leave the contributor able to collect it.
 *
 * Never throws into the caller. The verdict is already recorded and an episode
 * does not become unaccepted because a transaction failed — the error is
 * attached to the payment record so it is visible rather than silent.
 */
async function releasePayment(
  bountyId: string,
  onchainEpisodeId: string,
  contributor: `0x${string}`,
  amountUsdc: number,
) {
  if (!(await bountyExists(bountyId))) {
    return {
      chain_id: CHAIN.id,
      contributor,
      amount_usdc: amountUsdc,
      tx: "",
      paid_at: Math.floor(Date.now() / 1000),
      error: "This bounty was never escrowed on-chain, so there is nothing to release.",
    };
  }

  const result = await acceptEpisodeOnChain(bountyId, onchainEpisodeId);

  // Dust regardless of outcome: a contributor with credit from an earlier
  // episode still needs gas to reach it.
  await fundGas(contributor, WITHDRAW_GAS_WEI);

  return {
    chain_id: CHAIN.id,
    contributor,
    amount_usdc: amountUsdc,
    tx: result.txs[0]?.hash ?? "",
    paid_at: Math.floor(Date.now() / 1000),
    error: result.ok ? undefined : result.error,
  };
}
