import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * Without this the app is a web page, not a PWA: product-spec §3 promises
 * "Scan QR → open PWA", and §10.3 calls for "no install" in the app-store
 * sense — not for something that cannot be kept on a home screen.
 *
 * `display: standalone` matters more here than usual. The capture screen is
 * read while the phone is strapped to someone's head; browser chrome eats
 * vertical space the viewfinder needs, and an accidental swipe on the URL bar
 * ends a take that cannot be re-performed.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "World Mod",
    short_name: "World Mod",
    description:
      "A permissionless network for physical-world data. Record an episode, get scored, get paid.",
    start_url: "/c",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Capture an episode", short_name: "Capture", url: "/c" },
      { name: "Browse bounties", short_name: "Bounties", url: "/b/bounties" },
    ],
  };
}
