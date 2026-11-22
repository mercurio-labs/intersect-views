import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { logicalId } from "../src/logical-id.ts";
test("logical identity hash matches independent SHA-256 over exact UTF-8 membership",()=>{
  for(const values of [[],["abc"],["port","bound","repeat/child"],["🚀 βeta",null,123],["x".repeat(4096)]]){
    const expected=createHash("sha256").update(JSON.stringify(["label",...values])).digest("hex");assert.equal(logicalId("label",values),`label:${expected}`);
  }
  assert.notEqual(logicalId("label",["ab","c"]),logicalId("label",["a","bc"]));
});
