import Link from "next/link";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6 sm:pt-8">
      <div className="settle settle-1 rounded-panel bg-paper px-6 py-8 shadow-lift sm:px-10 sm:py-12">
        <nav className="flex gap-4 text-[12px] font-medium text-subtle">
          <Link href="/terms" className="rounded-full hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="rounded-full hover:text-foreground">Privacy</Link>
        </nav>
        <h1 className="mt-6 text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[42px]">
          {title}
        </h1>
        <p className="tag mt-3">Last updated {updated}</p>
        <div className="prose-legal mt-4">{children}</div>
      </div>
    </main>
  );
}
