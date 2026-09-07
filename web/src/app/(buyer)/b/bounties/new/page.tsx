import Link from "next/link";
import { NewBountyForm } from "./form";

export const metadata = {
  title: "Post a bounty — World Mod",
  description: "Describe the physical-world data you need and escrow its budget.",
};

export default function NewBountyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
      <Link href="/b/bounties" className="text-sm text-muted hover:text-white">
        ← Bounties
      </Link>

      <header className="mb-6 mt-3">
        <h1 className="text-xl font-semibold tracking-tight">Post a bounty</h1>
        <p className="mt-1 text-sm text-muted">
          Demand-first: describe what you need and contributors go and generate it.
        </p>
      </header>

      <NewBountyForm />
    </main>
  );
}
