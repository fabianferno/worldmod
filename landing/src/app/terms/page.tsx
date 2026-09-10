import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms under which you use World Mod.",
};

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="11 September 2026">
      <p>
        These terms govern your use of World Mod — the website, the progressive
        web app, and the smart contracts and services behind them (together, the
        &ldquo;Service&rdquo;). By opening the app, recording an episode, posting a
        bounty, or interacting with the contracts, you agree to them. If you do
        not agree, do not use the Service.
      </p>

      <h2>1. What the Service is</h2>
      <p>
        World Mod is a permissionless network for physical-world data. Contributors
        record short episodes of real tasks and are paid when an episode is
        accepted. Buyers post bounties describing the data they need and escrow
        what it pays. The Service coordinates this; it does not employ
        contributors and it is not a party to the arrangement between a buyer and
        a contributor.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 years old, or the age of majority where you live,
        and able to enter a binding agreement. You must not use the Service where
        doing so is unlawful, and you are responsible for complying with the laws
        that apply to you, including tax obligations on anything you earn.
      </p>

      <h2>3. Your key and your wallet</h2>
      <p>
        By default your identity on the Service is a key generated on your device.
        <strong> That key lives on this phone only.</strong> If you clear site
        data, lose the device, or reinstall the app, the key — and any balance
        signed to it — cannot be recovered by us or anyone else. Connecting a
        World App wallet makes your identity recoverable through that wallet. You
        are solely responsible for safeguarding your keys and wallet credentials.
      </p>

      <h2>4. Recording episodes</h2>
      <ul>
        <li>Record only tasks you are performing yourself, in places you are permitted to record.</li>
        <li>Do not record other people without their consent, and do not record anything unlawful, dangerous, or that you do not have the right to share.</li>
        <li>Do not attempt to spoof, replay, synthesise, or otherwise misrepresent a capture. Scoring is heuristic; a plausible fake is still a breach of these terms.</li>
        <li>Some tasks require a Selfie Check through World App before your first recording. That check is performed by World, under its own terms.</li>
      </ul>

      <h2>5. Scoring and acceptance</h2>
      <p>
        An episode is scored by a model, first on your own device and then by the
        Service. Scoring measures whether a capture is <strong>plausible</strong>,
        not whether it is genuine, and the Service will say so rather than imply
        attestation. Acceptance thresholds may be private and may change. A
        verdict of &ldquo;needs a hand&rdquo; or &ldquo;rejected&rdquo; is final for
        that episode; you may record again. We do not guarantee that any episode
        will be accepted or that any bounty will remain open.
      </p>

      <h2>6. Payment</h2>
      <p>
        Accepted episodes credit a balance held by an escrow contract and signed
        to your key. You withdraw it yourself; nobody, including us, can redirect
        it. Payments are made in the stablecoin the bounty specifies (currently
        USDC) on the network the bounty specifies. Network fees, exchange rates,
        and the availability of any third-party wallet or exchange are outside our
        control. Balances on test networks have no monetary value.
      </p>

      <h2>7. Licence to your episodes</h2>
      <p>
        You keep whatever rights you have in a recording. By submitting an episode
        you grant World Mod and the buyer of the bounty it answers a worldwide,
        perpetual, irrevocable, royalty-free licence to store, process, score,
        train models on, distribute, and sublicense that episode and data derived
        from it. Episode manifests, hashes, and scores are anchored on public
        blockchains and cannot be removed.
      </p>

      <h2>8. Buyers</h2>
      <p>
        If you post a bounty you are responsible for its description, for funding
        the escrow it promises, and for using the resulting data lawfully. You may
        not post bounties that solicit unlawful, deceptive, or harmful recordings.
        Escrowed funds are released by contract logic; we cannot reverse a
        settlement once it has occurred.
      </p>

      <h2>9. Smart contracts and networks</h2>
      <p>
        The Service relies on public blockchain networks and smart contracts,
        including on Hedera, and on third-party services such as Chainlink CRE and
        World App. These operate independently of us. Contracts are provided as
        deployed; we may upgrade, pause, or migrate them, and we are not liable
        for network outages, forks, congestion, or bugs in third-party code.
      </p>

      <h2>10. Acceptable use</h2>
      <p>
        Do not interfere with the Service, probe or attack it, scrape it at scale,
        reverse-engineer scoring to evade it, or use it to harm others. We may
        suspend or refuse access to anyone we reasonably believe is in breach.
      </p>

      <h2>11. Disclaimers</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;,
        without warranties of any kind, express or implied, including
        merchantability, fitness for a particular purpose, and non-infringement.
        It is experimental software under active development.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, World Mod and its contributors are
        not liable for any indirect, incidental, special, consequential, or
        punitive damages, or for lost profits, lost data, or lost keys, arising out
        of your use of the Service. Our total liability for any claim is limited
        to the greater of the amount you paid us in the preceding twelve months and
        USD 100.
      </p>

      <h2>13. Changes</h2>
      <p>
        We may change these terms. When we do we will update the date above and,
        for material changes, post a notice in the app. Continuing to use the
        Service after a change means you accept it.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these terms: open an issue on the{" "}
        <a href="https://github.com/fabianferno/worldmod">World Mod repository</a>.
      </p>
    </LegalPage>
  );
}
