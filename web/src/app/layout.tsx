import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { ServiceWorkerRegistration } from "@/components/service-worker";
import { MiniKitClientProvider } from "./minikit-client-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

// Capture runs on a phone strapped to someone's head: fill the viewport,
// sit under the notch, and never let a stray pinch zoom the viewfinder.
export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-950 text-white">
        <MiniKitClientProvider>
          <ServiceWorkerRegistration />
          {/* Keyboard users need a way past the nav on every page. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-neutral-950"
          >
            Skip to content
          </a>
          <div id="main" className="flex flex-1 flex-col overflow-hidden">
            {children}
          </div>
          <Nav />
        </MiniKitClientProvider>
      </body>
    </html>
  );
}
