import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="rounded-panel bg-paper px-6 py-8 shadow-lift">
        <span className="tag">404</span>
        <h1 className="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-0.03em]">Nothing here.</h1>
        <Link href="/" className="interactive on-ink mt-6 inline-flex rounded-full bg-ink px-5 py-3 text-[14px] font-semibold text-on-ink">
          Back to the start
        </Link>
      </div>
    </main>
  );
}
