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

  return Response.json({ bounty: await fileStore.createBounty(body) }, { status: 201 });
}
