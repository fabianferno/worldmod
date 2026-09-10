import Link from "next/link";
import { REPO_URL } from "@/lib/links";

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 pb-10 pt-16 sm:px-6">
      <div className="flex flex-col gap-4 border-t border-line pt-6 text-[12px] text-subtle sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} World Mod. A permissionless network for physical-world data.</p>
        <nav className="flex gap-5">
          <Link href="/terms" className="rounded-full hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="rounded-full hover:text-foreground">
            Privacy
          </Link>
          <a href={REPO_URL} className="rounded-full hover:text-foreground">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
