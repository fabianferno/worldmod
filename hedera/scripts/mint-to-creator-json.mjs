/**
 * Machine-consumable mint-to-creator: the ONLY thing on stdout is one line of
 * JSON (success or failure); all logs go to stderr. Spawned as a child process
 * by web/src/lib/hedera/mint-to-creator.ts — same isolation reason as
 * scripts/issue-bond-json.mjs (the SDK's window stub must not run in the
 * Next.js server process).
 *
 *     node scripts/mint-to-creator-json.mjs <bondEvmAddress> <datasetId>
 */
import { connect } from "../src/hedera-connect.mjs";
import { mintToCreator } from "../src/mint-to-creator.mjs";

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

const securityId = process.argv[2];
const datasetId = Number(process.argv[3] ?? 1);
if (!securityId) fail("bondEvmAddress (argv[2]) is required.");

try {
  const conn = await connect();
  const r = await mintToCreator(conn, { securityId, datasetId, log: (...a) => console.error(...a) });
  console.log(JSON.stringify({ ok: true, ...r }));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
