// Usage: node --env-file=.env mint-to-creator.mjs <bondEvmAddress> [datasetId=1]
import { connect } from "./src/hedera-connect.mjs";
import { mintToCreator } from "./src/mint-to-creator.mjs";

const securityId = process.argv[2];
const datasetId = Number(process.argv[3] ?? 1);
if (!securityId) throw new Error("Usage: node --env-file=.env mint-to-creator.mjs <bondEvmAddress> [datasetId]");

const conn = await connect();
const out = await mintToCreator(conn, { securityId, datasetId, log: (...a) => console.log(...a) });
console.log("\n=== MINTED TO CREATOR ===");
console.log(out);
