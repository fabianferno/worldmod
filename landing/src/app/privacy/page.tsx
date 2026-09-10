import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What World Mod collects, why, and what you can do about it.",
};

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="11 September 2026">
      <p>
        World Mod is built around recording the physical world, so this policy is
        written plainly. It explains what we collect when you use the website and
        the app, why, where it goes, and what you control.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li>
          <strong>Episodes.</strong> The video, sensor readings (motion, orientation,
          rate), and timestamps you record when you contribute. This is the
          product; we collect it only when you press record.
        </li>
        <li>
          <strong>Scores and manifests.</strong> The score assigned to each
          episode, the reason it was accepted or not, and a manifest hash that
          summarises the recording.
        </li>
        <li>
          <strong>Keys and addresses.</strong> The public part of the device key
          generated in your browser and, if you connect one, your World App wallet
          address. We never see the private key.
        </li>
        <li>
          <strong>Selfie Check result.</strong> Whether World App reports the check
          as passed. We do not receive the selfie itself or any biometric data.
        </li>
        <li>
          <strong>Technical data.</strong> Standard request logs (IP address,
          browser, timestamps) needed to run and secure the service.
        </li>
      </ul>
      <p>
        We do not ask for your name, email, or phone number, and we do not use
        advertising trackers.
      </p>

      <h2>2. Processing on your device</h2>
      <p>
        A model runs in your browser to score an episode before it is uploaded.
        If you are offline, episodes wait in your browser&apos;s storage and upload
        when you are back. Clearing site data deletes queued episodes and your
        device key.
      </p>

      <h2>3. Why we use it</h2>
      <ul>
        <li>To score episodes and pay you for accepted ones.</li>
        <li>To deliver accepted episodes to the buyer whose bounty they answer.</li>
        <li>To train and evaluate the world model, including through federated rounds.</li>
        <li>To detect spoofed or replayed captures and keep the network honest.</li>
        <li>To operate, debug, and secure the service.</li>
      </ul>

      <h2>4. Where it goes</h2>
      <ul>
        <li>
          <strong>Buyers.</strong> Accepted episodes, their scores, and their
          manifests are delivered to the buyer who posted the bounty, under the
          licence in our Terms.
        </li>
        <li>
          <strong>Public blockchains.</strong> Manifest hashes, addresses, escrow
          balances, and settlement transactions are written to public networks
          (currently Hedera testnet) and cannot be deleted. The recording itself
          is not put on-chain.
        </li>
        <li>
          <strong>Validation.</strong> Episode metadata may be evaluated inside a
          Chainlink CRE Confidential Workflow. The threshold it checks against is
          private; the verdict is returned to us.
        </li>
        <li>
          <strong>World App.</strong> If you connect a wallet or run Selfie Check,
          World processes that under its own privacy policy.
        </li>
        <li>
          <strong>Infrastructure.</strong> Hosting, storage, and IPFS pinning
          providers process data on our behalf.
        </li>
      </ul>
      <p>We do not sell personal data.</p>

      <h2>5. Other people in your recordings</h2>
      <p>
        Recordings are made from a phone strapped to your head and may capture
        bystanders. You are responsible for recording only where you are allowed
        to and for obtaining consent where the law requires it. If you believe you
        appear in an episode you did not consent to, contact us and we will
        investigate.
      </p>

      <h2>6. Retention</h2>
      <p>
        Episodes and scores are kept for as long as they are useful for training
        and delivery to buyers, or until you ask us to delete them. Request logs
        are kept for a short period for security. Anything anchored on a public
        blockchain is permanent by design.
      </p>

      <h2>7. Your choices</h2>
      <ul>
        <li>You decide when to record; nothing is captured passively.</li>
        <li>You can clear your browser&apos;s site data to remove the device key and any queued episodes.</li>
        <li>You can disconnect your World App wallet at any time.</li>
        <li>
          You can ask us to delete episodes we hold, or to tell you what we hold
          that is linked to your key or address. We will act on requests within
          30 days, subject to what has already been delivered to a buyer or
          written on-chain.
        </li>
      </ul>

      <h2>8. Security</h2>
      <p>
        Episodes are signed by your key and identified by content hash so they
        cannot be altered in transit. We use standard transport encryption and
        access controls. No system is perfectly secure; if we learn of a breach
        that affects you we will say so.
      </p>

      <h2>9. Children</h2>
      <p>
        The service is not for anyone under 18. We do not knowingly collect data
        from children, and we will delete it if we learn we have.
      </p>

      <h2>10. Changes</h2>
      <p>
        We will update the date above when this policy changes and post a notice
        in the app for material changes.
      </p>

      <h2>11. Contact</h2>
      <p>
        Privacy requests and questions: open an issue on the{" "}
        <a href="https://github.com/fabianferno/worldmod">World Mod repository</a>.
      </p>
    </LegalPage>
  );
}
