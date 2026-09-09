import solc from "solc";
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("./Counter.sol", import.meta.url), "utf-8");

const input = {
  language: "Solidity",
  sources: { "Counter.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((e) => e.severity === "error");
if (errors.length > 0) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}

const contract = output.contracts["Counter.sol"].Counter;
writeFileSync(
  new URL("./counter-artifact.json", import.meta.url),
  JSON.stringify({ abi: contract.abi, bytecode: "0x" + contract.evm.bytecode.object }, null, 2),
);
console.log("Compiled. ABI entries:", contract.abi.length);
