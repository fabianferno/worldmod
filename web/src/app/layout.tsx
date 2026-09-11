import type { Metadata, Viewport } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { AppMenu } from "@/components/app-menu";
import { ServiceWorkerRegistration } from "@/components/service-worker";
import { MiniKitClientProvider } from "./minikit-client-provider";
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider";

/**
 * Manrope for everything a person reads: a geometric grotesque with a tall
 * x-height and genuinely tight numerals, which is what this world spends most
 * of its type budget on. Geist Mono stays, scoped to the things that are
 * literally data — addresses, transaction hashes, sensor rates.
 */
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "World Mod",
  description: "A permissionless network for physical-world data.",
  applicationName: "World Mod",
  appleWebApp: {
    // iOS ignores the web app manifest and needs its own hints.
    capable: true,
    title: "World Mod",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

// Capture runs on a phone strapped to someone's head: fill the viewport,
// sit under the notch, and never let a stray pinch zoom the viewfinder.
export const viewport: Viewport = {
  themeColor: "#e9e9e6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bone text-foreground">
        {/*
          THESIS: A payout ledger you can read at arm's length with a phone
          still warm on your forehead. It refuses the dark crypto dashboard —
          the chart wall, the neon accent, the metric grid — and quotes one
          figure at a time.
          OWN-WORLD: Bone ground; stacked lozenges at 30px radius; three flat
          fields (mint = the task, lilac = the model, butter = needs a hand)
          against deep-ink cards that hold settled money; figures at 600 weight
          with a small grey unit riding the baseline; full-pill controls and a
          circular knob straddling the seam between two panels.
          STORY: I can see what this pays, I record, I am told plainly whether
          it was accepted and why, and the money is one press away.
          FIRST VIEWPORT: Balance top-left with the task's rate facing it on a
          mint pill; the viewfinder as the ink card filling the rest, the task
          named across its foot; the Start bar in the thumb zone as an ink pill
          with the mint record knob inset at its head; a black dock beneath,
          its own disc cut into the top edge. Withdrawal is the same bar in
          reverse — mint field, ink knob — one screen away, where the balance
          it moves actually lives.
          FORM: Brief-pinned by the user's reference image, so no direction
          roll was dealt; SEED: user-pinned.
          FINISH: unreviewed and undocumented is unfinished; this build ends
          with the finish review, the verdict, and DESIGN.md.
        */}
        <MiniKitClientProvider>
          <ServiceWorkerRegistration />
          <OnboardingProvider>
            {/* Keyboard users need a way past the nav on every page. */}
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-ink"
            >
              Skip to content
            </a>
            <div id="main" className="flex flex-1 flex-col overflow-hidden">
              {children}
            </div>
            <AppMenu />
            <Nav />
          </OnboardingProvider>
        </MiniKitClientProvider>
      </body>
    </html>
  );
}
