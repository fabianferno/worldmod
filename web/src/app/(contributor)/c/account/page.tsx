import type { Metadata } from "next";
import { Providers } from "../providers";
import { AccountView } from "./view";

export const metadata: Metadata = {
  title: "Your account — World Mod",
  description: "What you have contributed, what it scored, and what you are owed.",
};

/**
 * The contributor's own view of themselves.
 *
 * Everything here already existed and was visible to everyone except the person
 * who did the work: reputation was computed and rendered on the buyer's
 * dashboard, earnings were a number on the capture screen, and the withdraw
 * button lived on the result screen — reachable only by recording again, which
 * meant a contributor who closed the app had no route to their own money.
 */
export default function AccountPage() {
  return (
    <Providers>
      <AccountView />
    </Providers>
  );
}
