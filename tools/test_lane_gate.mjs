import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import assert from "node:assert/strict";
const target=process.env.CARGO_TARGET_DIR||"target";
const {instance}=await WebAssembly.instantiate(await readFile(resolve(target,"wasm32-unknown-unknown/test-fast/examples/lane_gate.wasm")),{});
console.time("M9 actual WASM lane gate");
assert.equal(instance.exports.lane_gate(),1,"Lane constraints/source-command WASM gate failed");
console.timeEnd("M9 actual WASM lane gate");
console.log("PASS: deterministic ranks/ties/span, both axes, lexical selectors, source prepare/commit/reanalysis and comment/CRLF/Unicode preservation in actual WASM.");
