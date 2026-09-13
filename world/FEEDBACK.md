# Selfie Check integration feedback

What we hit while adding Selfie Check and MiniKit to World Mod. The
integration itself is described in [`README.md`](README.md); this file is
only the feedback.

Context for what we tested against: `@worldcoin/idkit@4.2.3`,
`@worldcoin/idkit-core@4.2.4`, `@worldcoin/idkit-server`, a Developer Portal
app (`app_d4bef1c976c0674e0583c328c02f3c10`) with an RP registration
(`rp_0f7bb62abb7fba06`), Selfie Check Beta access granted for that app, and
the sandbox World ID App on iOS. One real Selfie Check completed end to end
(web app, cross-device QR) and was verified server-side against
`POST /api/v4/verify/{rp_id}`.

## Selfie Check docs and integration flow

**The docs page describes a different protocol than the SDK ships.**
`docs.world.org/world-id/credentials/11` says to integrate through IDKit
with an `app_id`, deep links and QR codes, and talks about a
`verification_level`. The current SDK has no `VerificationLevel`. It has a
`CredentialType` union (`proof_of_human | selfie | passport | mnc`) and
every request needs an `RpContext`: a nonce and time window signed with a
relying-party key using `signRequest()` from `@worldcoin/idkit-server`.
Neither `RpContext`, the signing key, nor `idkit-server` is mentioned on
the credentials page. Someone starting from that page writes code that does
not compile against the package.

**Where we actually found the flow, in order:** the README bundled inside
`@worldcoin/idkit` (has a working sample), the `selfieCheckLegacy()` preset
in `@worldcoin/idkit-core`, and `signRequest()` in `@worldcoin/idkit-server`.
None of these are linked from the credentials page.

**The Beta gate is stated in a JSDoc comment**, on `selfieCheckLegacy()`:
"Preview: Selfie Check is currently in preview. Contact us if you need it
enabled." That is the only place we saw it. It belongs on the docs page.

**Credential id 11 is undocumented.** The SDK's type comments say
`issuer_schema_id` 11 is selfie, which matches the `/credentials/11` URL.
Neither page says so. One line would save the cross-check.

**The server-side verify endpoint is fine but badly signposted.**
`POST https://developer.world.org/api/v4/verify/{rp_id}` works, and its
schema is documented at `api-reference/developer-portal/verify.md`. We
confirmed it is live by sending an invalid nullifier and getting back
`Invalid nullifier. Must be a hex string with optional 0x prefix.` But it
is not linked from `credentials/11` or `sandbox/testing-selfie-check`. We
found it as one clause in a config paragraph on `sandbox/sandbox-access`,
then found the schema through `docs.world.org/llms.txt`. The SDK's own type
comments point instead at `WorldIDVerifier.sol`, which is not the path a
mini app uses. Three hops from the named starting page to a working verify
call is the biggest single time sink in this integration.

## Developer Portal: navigation, search, product discovery, debugging

- Neither `credentials/11` nor `sandbox/testing-selfie-check` says where in
  the portal to request Selfie Check Beta access, register an RP, or find
  the `rp_id` and RP signing key. Both say "request access through your
  World point of contact."
- Nothing states whether `rp_id` and the signing key are issued with the
  `app_id` or separately, or whether one RP can back several mini apps. We
  guessed the shape of `rp-context.ts` from the `RpContext` type before we
  had real credentials to check against.
- Sandbox access is self-serve: `sandbox/sandbox-access` gives a concrete
  portal path (World ID Sandbox section, iOS and Android tabs, submit an
  email). Selfie Check Beta access is not; it is an email to a person. Both
  gate testing, and nothing explains why one is in-product and the other is
  not.
- Once access was granted the portal side was quick. The gap is discovery,
  not the screens.

## Sandbox App: states, proof flows, test users, errors, edge cases

**The good part.** `sandbox/testing-selfie-check` is the best page in this
set. It lays out a 2×3 matrix (native app or web app, by hot, cold and
semi-cold user state) with each cell described concretely, including that
hot enrolls inline so there is no separate warm flow. It names real
limitations: TestFlight and private Play links for distribution, and the
iOS semi-cold dead end where tapping "Sign in" instead of "Sign up" leaves
no way to enter the invite code. That is the level of detail the
credentials page needs.

**What we exercised.** One cell: web app, hot, cross-device QR. QR scan,
capture and match in World ID App, credential response back to the
originating web session, server verify, record written. It worked first
time once Beta access existed. The other five cells are untested by us.

**What is missing.**

- No catalogue of error codes or failure payloads. Every `IDKitErrorCodes`
  value we handle came from the SDK's `.d.ts`, not from docs.
- No self-serve fallback when something goes wrong: no status page, no
  forum, no example error responses. The "next step" everywhere is "reach
  out to your World point of contact," which does not help outside business
  hours or before that relationship exists.
- No way to pick which user state a sandbox session simulates. It is a
  manual walkthrough, and the page says so, but a test-user switch would
  make the cold and semi-cold cells much cheaper to cover.

## What was confusing, missing, broken, or hard to test

1. **Confusing:** the credentials page and the shipped SDK describe two
   protocol generations. `RpContext` and `idkit-server` are the real
   integration and are absent from the page.
2. **Buried:** the verify endpoint exists and works, but is three hops from
   the pages a developer starts on, and the SDK comments point elsewhere.
3. **Inconsistent:** sandbox access is self-serve; Selfie Check Beta is a
   human request with no in-product starting point.
4. **Hard to test:** until Beta was granted, everything below the RP-context
   layer had to be built against a self-written mock, labelled `mock: true`
   throughout. After access, the sandbox flow worked immediately.
5. **Missing:** an error-code catalogue and any documentation of where
   `rp_id` and the signing key come from.

Nothing we used was broken. The SDK, the verify API and the sandbox app all
behaved. The cost was entirely in finding the right pieces.
