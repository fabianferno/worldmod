# World Mod

<!-- Derived from README.md, product-spec.md and the shipped code rather than a
     live interview. Facts here are repo truth; nothing is invented. -->

## What it is

A permissionless network for physical-world data. Someone opens a web page,
straps a phone to their head, performs a short physical task for 15 seconds, and
the recording is scored before it earns. A buyer posts a bounty describing what
they need and escrows what it pays. The protocol underneath is asset-agnostic: a
factory sensor network registers the same way a phone does.

## The unique mechanism

Payment is settled against evidence, not trust. Every episode carries a manifest
hash anchored on-chain, signed by the contributor's own key; the escrow credits a
balance and the holder pulls it, so nobody else can redirect the money. Scoring
is heuristic — it measures whether a capture is *plausible*, not whether it is
*genuine*, and the product says so rather than implying attestation.

## Audiences

**Contributor** (this branch's surface). Holding a phone, often strapped to their
head, outdoors or in a workshop, in daylight. Not a crypto user. They came for
the money. What they need to know at a glance: what this take pays, what they
have earned, whether the last one was accepted, and how to get the money out.

**Buyer.** Posts bounties, inspects traces, funds escrow, watches the model's
scaling curve. Desk-bound, dashboard-shaped.

## Constraints

- The capture screen is a live viewfinder. Whatever surrounds it must not throw
  glare onto a phone held near someone's face.
- Contributors go offline mid-task. Episodes queue on the device and upload later;
  nothing may present as lost.
- Scoring takes about a minute and survives a page reload. Anchoring takes longer
  and is never allowed to block a result.
- Identity is a device key by default and a World App wallet if connected. The
  difference is *recoverability*, and the copy must never flatten it into
  "wallet connected".
- Installed PWA, iOS included: safe-area insets, no pinch-zoom on the viewfinder.

## Brand commitments

- Visual world pinned by the user to a supplied reference: a soft bone ground,
  mint / lilac / butter panels, deep-ink inset cards, heavy radii, large
  numerals with small trailing units. See DESIGN.md.
- Claims stay honest: "heuristic" trust level, "sandbox mock" on mock proofs,
  "this phone only" on unrecoverable keys.
