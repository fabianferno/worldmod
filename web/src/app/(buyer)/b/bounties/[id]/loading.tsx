/**
 * Skeletons shaped like the bounty rows they replace, so the layout does not
 * jump when the data lands. A spinner would tell the buyer nothing about what
 * is coming.
 */
export default function LoadingBounties() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8" aria-busy="true" aria-label="Loading bounties">
      <div className="skeleton h-7 w-40 rounded-lg" />
      <div className="skeleton mt-2 h-4 w-full max-w-md rounded" />

      <ul className="mt-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="rounded-2xl border border-line p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="skeleton h-5 w-44 rounded" />
              <div className="skeleton h-4 w-24 rounded" />
            </div>
            <div className="skeleton mt-3 h-4 w-full rounded" />
            <div className="skeleton mt-1.5 h-4 w-2/3 rounded" />
            <div className="mt-4 flex gap-2">
              <div className="skeleton h-6 w-28 rounded-full" />
              <div className="skeleton h-6 w-20 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
