import { readFile } from "node:fs/promises";
import {resolve} from "node:path";
import assert from "node:assert/strict";
const bytes = await readFile(
  resolve(process.env.CARGO_TARGET_DIR||"target","wasm32-unknown-unknown/test-fast/examples/query_gate.wasm"),
);
const { instance } = await WebAssembly.instantiate(bytes, {});
assert.equal(
  instance.exports.query_gate(),
  1,
  "Frozen-store WASM QueryPlan gate failed",
);
console.log(
  "PASS: actual WASM frozen-store QueryPlan, hidden IDs, scoped order, external reference reads, 128-ID page progress, revision mismatch, result overflow and aggregate budget gate.",
);
