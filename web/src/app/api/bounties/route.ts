import { CHAIN, chainEnabled } from "@/lib/chain/config";
import { bountyKey, createBountyOnChain, relayerAddress } from "@/lib/chain/escrow";
import { fileStore } from "@/lib/market/store";
import { budgetBreakdown } from "@/lib/market/types";
import type { Bounty } from "@/lib/market/types";

export async function GET() {
  return Response.json({ bounties: await fileStore.listBounties() });
}

export async function POST(request: Request) {
  let body: Bounty;
  try {
    body = (await request.json()) as Bounty;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // A bounty whose allocations do not sum to its budget is unfundable. Better
  // to refuse it here than to discover it when escrow runs short.
  const breakdown = budgetBreakdown(body);
  if (!breakdown.balanced) {
    return Response.json(
      {
        error:
          `Allocations total ${breakdown.allocated.toFixed(2)} USDC against a ` +
          `${body.budget_usdc.toFixed(2)} USDC budget.`,
      },
      { status: 400 },
    );
  }

  // Escrowed before it is listed. A bounty visible to contributors whose money
  // had not actually moved would be asking people to record for a promise —
  // §7's whole point is that the budget is locked up first.
  if (chainEnabled()) {
    const result = await createBountyOnChain({
      bountyId: body.bounty_id,
      budgetUsdc: body.budget_usdc,
      perEpisodeUsdc: body.per_episode_usdc,
      maxEpisodes: body.min_episodes,
      utilityPoolUsdc: body.utility_pool_usdc,
      validatorFeeUsdc: body.validator_fee_usdc,
      treasuryFeeUsdc: body.treasury_fee_usdc,
      deadline: body.deadline,
    });

    if (!result.ok) {
      return Response.json(
        { error: `Could not escrow the budget: ${result.error}`, txs: result.txs },
        { status: 502 },
      );
    }

    body.escrow = {
      chain_id: CHAIN.id,
      bounty_key: bountyKey(body.bounty_id),
      buyer: relayerAddress() ?? "",
      txs: result.txs.map((t) => ({ step: t.step, hash: t.hash })),
      escrowed_at: Math.floor(Date.now() / 1000),
    };
  }

  return Response.json({ bounty: await fileStore.createBounty(body) }, { status: 201 });
}
