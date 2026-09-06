/**
 * Pinning episode bytes to IPFS.
 *
 * A CID is a correct address whether or not anything holds the bytes — see
 * cid.ts. Pinning is what makes it *resolvable by a stranger*, which is the
 * difference between an on-chain pointer a judge can follow and one they
 * cannot. §10.2 wants the bytes in content-addressed storage; this puts them
 * there.
 *
 * It talks to a local kubo node over its HTTP API rather than to a pinning
 * service. No third-party account, no API key, and the node joins the public
 * DHT like any other — so a CID pinned here is announced to the network and
 * fetchable through any gateway while the daemon is up. The honesty cost is
 * stated plainly: availability lasts exactly as long as this node runs, which
 * is a demo property and not a durability guarantee.
 *
 * Every call is optional and non-fatal. A missing daemon means an episode is
 * addressed but unpinned, which is the state the system was already in.
 *
 * Deliberately not marked server-only. It holds no secret — an API URL and
 * nothing else — and blobs.ts imports it while also being imported by tests;
 * the guard would make every one of those suites fail to load for no gain.
 */

const API = process.env.IPFS_API_URL ?? "http://127.0.0.1:5001";

export interface PinResult {
  ok: boolean;
  cid?: string;
  error?: string;
}

/** Whether a kubo node is reachable. Cheap, and used to decide before trying. */
export async function daemonUp(): Promise<boolean> {
  try {
    const response = await fetch(`${API}/api/v0/id`, {
      method: "POST",
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Add bytes to the local node and pin them.
 *
 * The chunking flags matter as much as the bytes: cid-version 1 with raw
 * leaves is what cid.ts computes against, and a mismatch here would pin the
 * content under an address nothing else refers to — the bytes would be on the
 * network and still unreachable from the manifest.
 */
export async function pinBytes(
  bytes: Uint8Array,
  filename: string,
  expectedCid?: string,
): Promise<PinResult> {
  try {
    const form = new FormData();
    form.set("file", new Blob([bytes as BlobPart]), filename);

    const response = await fetch(
      `${API}/api/v0/add?cid-version=1&raw-leaves=true&pin=true`,
      { method: "POST", body: form, signal: AbortSignal.timeout(120_000) },
    );

    if (!response.ok) {
      return { ok: false, error: `kubo returned ${response.status}` };
    }

    // kubo streams newline-delimited JSON; the last line is the root.
    const text = await response.text();
    const lines = text.trim().split("\n").filter(Boolean);
    const root = JSON.parse(lines[lines.length - 1]) as { Hash?: string };
    const cid = root.Hash;

    if (!cid) return { ok: false, error: "kubo returned no hash." };

    // A pin under a different address than the manifest declares is worse than
    // no pin: the bytes would be published and still unreachable from the
    // commitment that points at them.
    if (expectedCid && cid !== expectedCid) {
      return {
        ok: false,
        cid,
        error: `Pinned as ${cid} but the manifest declares ${expectedCid}.`,
      };
    }

    return { ok: true, cid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Ask the node to announce a CID to the DHT, so others can find it. */
export async function provide(cid: string): Promise<boolean> {
  try {
    const response = await fetch(`${API}/api/v0/routing/provide?arg=${cid}`, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
