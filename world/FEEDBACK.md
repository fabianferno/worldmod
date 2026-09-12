# Feedback: Selfie Check docs, SDK, and sandbox

Written while integrating Selfie Check into World Mod (see `world/README.md`
for what got built). Scoped honestly: a Developer Portal app and RP now
exist (`app_d4bef1c976c0674e0583c328c02f3c10`, `rp_0f7bb62abb7fba06`), and
`web/src/app/api/world/verify/route.ts` calls World's real, live verify API.
At the time most of this document was written, this project's author never
had a logged-in portal session and Selfie Check Beta access hadn't been
granted, so the Developer Portal and Sandbox App sections below were based
on what the docs describe, not hands-on navigation or a completed check —
that distinction is called out inline rather than blurred, and left
standing below as the honest record of what the integration experience was
like *before* access existed. **Update: Beta access was subsequently
granted for this app**, the sandbox World ID App build was installed, and a
real Selfie Check was completed end to end — see `world/README.md`'s "Done"
section. That doesn't retroactively change what's written below (the
gaps identified while working docs-first were real gaps at the time), but
it does mean the "hard to test" / "still secondhand" framing in a few
places is now historical, not current. The SDK/integration-flow section is
firsthand: real npm packages, real installed type definitions, real
request/response round-trips, including one real rejection from World's
own verify API confirming it's genuinely live, not just documented.

## SelfieCheck docs and integration flow

**The docs describe an older protocol than the SDK ships.** `docs.world.org/world-id/credentials/11`
says integration is "via IDKit... generate deep links... display QR codes,"
and frames Selfie Check next to a `verification_level` concept (Orb vs.
Device). The actual current SDK (`@worldcoin/idkit@4.2.3` /
`@worldcoin/idkit-core@4.2.4`, both `npm view` latest at time of writing) has
no `VerificationLevel` enum anywhere — it's a `CredentialType` union
(`"proof_of_human" | "selfie" | "passport" | "mnc"`) inside a materially
different protocol: every request now needs an `RpContext` (a nonce and
timestamp window signed by a relying-party key), which didn't exist in the
classic `IDKitWidget` + bare `app_id` flow the docs prose still describes.
Nothing in the fetched docs mentions `RpContext`, where the signing key
comes from, or that a server-side signer (`@worldcoin/idkit-server`) exists
at all. Someone starting from the docs page alone would write code against
an API that's been superseded.

**The credential-id-11 thing is a nice, undocumented consistency.** The
SDK's own type comments say `issuer_schema_id`  `11 = selfie` — matching the
`/credentials/11` URL segment exactly. Neither page says this explicitly;
it's discoverable only by reading both and noticing the number matches. A
one-line "credential id 11" on the docs page would save that cross-check.

**The real integration path had to be reverse-engineered from installed
`.d.ts` files and README examples, not docs prose**, in this order:
`@worldcoin/idkit`'s bundled README (has a real, working code sample —
better than the hosted docs), then `@worldcoin/idkit-core`'s exported
`selfieCheckLegacy()` preset builder (whose own JSDoc is where the Beta gate
is actually stated: *"Preview: Selfie Check is currently in preview. Contact
us if you need it enabled"*), then `@worldcoin/idkit-server`'s `signRequest()`
for the RP-signing half. None of that chain is linked from the two docs
pages this task named.

**Correction to an earlier draft of this document**: it originally called
"no documented path to verify a proof server-side" the single biggest gap.
That verify endpoint does exist and is documented — `POST
https://developer.world.org/api/v4/verify/{rp_id}`, full request/response
schema at `api-reference/developer-portal/verify.md`. It's real: wired into
`web/src/app/api/world/verify/route.ts` and confirmed live by sending it a
deliberately invalid nullifier, which came back with a specific, correct
rejection (`"Invalid nullifier. Must be a hex string with optional 0x
prefix."`) — not a stub, an actual working validator. Leaving the wrong
claim in place after finding this would be worse than the claim itself, so
retracting it here rather than quietly editing it away.

**What made it genuinely hard to find, and is still worth fixing**: this
endpoint is not linked, named, or hinted at anywhere on either page this
bounty task pointed to (`credentials/11`, `sandbox/testing-selfie-check`),
nor in `@worldcoin/idkit-core`'s or `@worldcoin/idkit-server`'s own type
comments — the closest thing there, "compatible with `WorldIDVerifier.sol`,"
points toward an on-chain path that isn't the one actually used. It only
turned up by reading `sandbox/sandbox-access` (linked from Sandbox's
overview page, not from either credential/integration doc), and even there
it's one clause in a config paragraph — the URL with no method, headers, body
schema, or example. The actual schema lives on a *third* page
(`api-reference/developer-portal/verify.md`), reachable only via the docs'
full site index (`docs.world.org/llms.txt`), not by following links from any
page a developer starting at `credentials/11` would naturally land on. Three
hops from the named starting point to a working integration is a real
information-architecture gap, even though every individual piece turned out
to exist.

## Developer Portal: navigation, search, product discovery, debugging

**Updated partway through this project**: a Developer Portal account and app
now exist (`app_d4bef1c976c0674e0583c328c02f3c10`, RP `rp_0f7bb62abb7fba06`)
— the caveat below no longer applies to whoever registered those; it still
applies to this document's author, who worked from docs and SDK source, not
a logged-in portal session, and never saw the actual screens described.
- The two docs pages this task named (`credentials/11`,
  `sandbox/testing-selfie-check`) never link to *where in the portal* to
  request Selfie Check Beta access, register an RP, or find `rp_id`/
  signing-key fields — both just say "request access through your World
  point of contact." **Sandbox access, by contrast, turned out to be
  self-serve** — `sandbox/sandbox-access` (found only by following a link
  from Sandbox's overview page, not from either page this task named)
  gives a concrete Developer Portal path: a "World ID Sandbox" section,
  separate iOS/Android tabs, submit an email, wait for approval. Selfie
  Check Beta access apparently isn't that — it's still framed as a human
  request — but nothing explains *why* one credential's access is portal
  self-serve and another's needs an email, which reads as inconsistent
  from the outside even if there's a real reason (e.g. Selfie Check being
  newer/Beta) behind it.
- Nothing found (docs or SDK) states which Developer Portal screen an
  `rp_id` and RP signing key come from, whether they're issued together with
  an `app_id` or separately, or whether one RP can back multiple mini apps.
  Building `web/src/lib/world/rp-context.ts` required guessing the shape
  from `RpContext`'s type fields alone before real credentials existed to
  check the guess against.

## Sandbox App: states, proof flows, test users, errors, edge cases

**Written while still secondhand — Beta access is the prerequisite the docs
state for even starting sandbox testing**, and at the time this section was
drafted, this project didn't have it, so nothing below had been clicked
through yet. (Access was granted later — see the update at the top of this
document — but the finding stands as written: everything below came from
reading the page, not from a session.) Read the full `sandbox/testing-selfie-check` page
(not just a fetched summary of it) after an earlier draft of this document
undersold it — worth correcting in place rather than leaving the weaker
claim standing:

- **This page is genuinely well-organized**, better than an earlier AI-
  fetched summary made it look. Coverage is a real 2×3 matrix — entry
  surface (native app / web app) × user state (Hot / Cold / Semi-cold) —
  with each of the six cells described concretely: Hot enrolls inline if
  the user isn't already Selfie-Check-enrolled, then matches ("no distinct
  Warm flow — enrollment happens inline within Hot"); Cold is the full
  funnel (install → account → DOB → invite code on iOS → enroll → check);
  Semi-cold is reinstall-and-recover, then check. Web app states are the
  same three, cross-device via QR, proof returned to the originating web
  session. This answers what an earlier pass of this feedback called a
  gap ("no way to choose which state a session simulates") — it isn't a
  parameter, it's a manual walkthrough matrix, and the page states that
  plainly. Correcting that here rather than leaving it wrong.
- **Named, specific known limitations** — also better than expected: sandbox
  apps distribute via TestFlight (iOS) / a private Google Play testing link
  (Android), not public listings; iOS Semi-cold has a real, specific gap
  (tapping "Sign in" instead of "Sign up" mid-flow leaves no path to add the
  invite code — requires restarting from a fresh QR/deep link) that Android
  doesn't share; invite-code handling differs by platform in the Cold flow.
  These are the kind of concrete "here's exactly where it breaks" details
  the credential docs page (`credentials/11`) doesn't have any equivalent of.
- **What's still genuinely missing, even reading the full page**: no
  catalogue of error codes or failure responses a developer could expect
  and handle — every error code this integration actually handles
  (`IDKitErrorCodes` in `@worldcoin/idkit-core`) came from the SDK's type
  file, not from any docs page. And the page's own "Next step" for anything
  uncovered is the same human escalation as everywhere else in this
  integration — "reach out to your World point of contact" — with no
  self-serve fallback (a status page, a support forum, example error
  payloads) for a developer working outside business hours or before that
  relationship exists.

## What was confusing, missing, broken, or hard to test — summary

1. **Confusing**: docs prose and shipped SDK describe two different
   protocol generations; a developer reading only the docs page would write
   code that doesn't compile against the current package.
2. **Findable but buried**: the server-side verify endpoint
   (`POST /api/v4/verify/{rp_id}`) is real, documented, and confirmed working
   (see the correction above) — but it's three link-hops from either page
   this task named, and never mentioned by the SDK's own type comments,
   which point toward an unrelated on-chain path instead. Not missing;
   badly signposted.
3. **Inconsistent, not missing**: Sandbox access is self-serve through the
   Developer Portal with a named path (`sandbox/sandbox-access`); Selfie
   Check Beta access is a human email request with no in-product start
   point. Both gate testing; only one explains how to get unblocked without
   leaving the docs.
4. **Hard to test, until it wasn't**: the Beta gate blocked sandbox testing
   entirely until a human granted access — reasonable for a Beta feature,
   and the sandbox coverage page itself is well-specified once you have
   that access (see above — it names exact states, platforms, and known
   limitations). Until access existed, the whole integration below the
   RP-context layer had to be built against a self-built mock (clearly
   labelled `mock: true` throughout, see `world/README.md`) rather than
   verified against anything real — that mock was honest about its own
   limits, but was not a substitute for actually exercising this against a
   live sandbox session. Access was later granted, and that final exercise
   happened for real — see `world/README.md`'s "Done" section. The gap this
   point describes was real for most of this project's development, and is
   worth keeping on record as what a Beta-gated credential costs a team
   building against it in good faith before access lands.
5. **Missing**: an error-code catalogue anywhere in the docs — every error
   this integration handles came from reading the SDK's own `.d.ts`, not
   from documentation aimed at developers who haven't installed the package
   yet.
