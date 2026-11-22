import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GraphicDefinitions } from "../src/graphics-contract.ts";

const vectors = JSON.parse(readFileSync(new URL("../../../crates/intersect-views/tests/fixtures/graphics-v1.json", import.meta.url), "utf8")) as {
  accepted: { name: string; libraries: unknown }[];
  rejected: { name: string; libraries: unknown }[];
};
for (const v of vectors.accepted) test(`graphics accepts ${v.name}`, () => { new GraphicDefinitions(v.libraries); });
for (const v of vectors.rejected) test(`graphics rejects ${v.name}`, () => { assert.throws(() => new GraphicDefinitions(v.libraries)); });
test("graphics validates evaluated role, choice and content mappings", () => {
  const definitions = new GraphicDefinitions(vectors.accepted[0].libraries);
  const instance = { definition: "fixture.base/card", parameters: { fill: "#ffffff", ink: "#123456", enabled: true, size: 20, mode: "b" }, slots: { title: { kind: "title" } } };
  definitions.instance(instance, "node");
  assert.throws(() => definitions.instance(instance, "port"));
  assert.throws(() => definitions.instance({ ...instance, parameters: { ...instance.parameters, mode: "c" } }, "node"));
  assert.throws(() => definitions.instance({ ...instance, slots: { title: { kind: "children" } } }, "node"));
  assert.throws(() => definitions.instance({ ...instance, parameters: { ...instance.parameters, fill: "url(https://example.test/paint)" } }, "node"));
});

const limits=JSON.parse(readFileSync(new URL("../../../crates/intersect-views/tests/fixtures/graphics-limits-v1.json",import.meta.url),"utf8"));
for(const v of limits.accepted)test(`graphics boundary accepts ${v.name}`,()=>{new GraphicDefinitions(v.libraries);});
for(const v of limits.rejected)test(`graphics boundary refuses ${v.name}`,()=>{assert.throws(()=>new GraphicDefinitions(v.libraries));});
