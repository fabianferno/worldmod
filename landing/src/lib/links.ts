/* Where the CTAs point. The app URL is an env so a deploy can retarget it. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://worldmod.vercel.app";
export const REPO_URL = "https://github.com/fabianferno/worldmod";
export const CONTRIBUTE_URL = `${APP_URL}/c`;
export const BUYER_URL = `${APP_URL}/b/bounties`;
