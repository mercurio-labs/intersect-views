import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateTargets } from "../src/validation.ts";
import {
  validateScope,
  validateViewDocument,
  validatePresentation,
  validateRuleSet,
  validateScene,
  validateSceneResponse,
} from "../src/protocol.ts";
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../crates/intersect-views/tests/fixtures/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
for (const c of fixture("m10-root-only.json"))
  test(`shared ${c.name}`, () => {
    for (const index of [0, 1]) {
      const rules = fixture("rule-set-v7-m14.json");
      rules.edges[index].rootOnly = c.value;
      if (c.accepted) validateRuleSet(rules);
      else assert.throws(() => validateRuleSet(rules));
    }
  });
test("real cached Rcore harness scene passes the client contract", () => {
  const response = fixture("scene-harness-v6-m14.json");
  validateSceneResponse(response);
  assert.equal(response.scene.nodes.length, 2);
});
const validators: Record<string, (v: unknown) => void> = {
  scope: validateScope,
  "view-document": validateViewDocument,
  presentation: validatePresentation,
  "rule-set": validateRuleSet,
  scene: validateScene,
  targets: validateTargets,
};
function mutate(value: any, c: any) {
  const keys = c.pointer.slice(1).split("/"),
    key = keys.pop();
  let target = value;
  for (const part of keys) target = target[part];
  if (c.remove) delete target[key];
  else
    target[key] =
      c.repeat !== undefined
        ? Array.from({ length: c.repeat }, () => structuredClone(c.value))
        : c.repeatMap !== undefined
          ? Object.fromEntries(
              Array.from({ length: c.repeatMap }, (_, i) => [
                String(i),
                structuredClone(c.value),
              ]),
            )
          : c.value;
}
for (const kind of [
  "scope",
  "view-document",
  "presentation",
  "rule-set",
  "targets",
]) {
  test(`${kind}: shared accepted document`, () =>
    validators[kind](
      fixture(
        `${kind}-${kind === "rule-set" ? "v7-m14" : kind === "presentation" ? "v4" : "v1"}.json`,
      ),
    ));
  for (const c of fixture(
    `${kind}-${kind === "rule-set" ? "v7" : kind === "presentation" ? "v4" : "v1"}-rejections.json`,
  ))
    test(`${kind}: ${c.name}`, () => {
      const value = fixture(
        `${kind}-${kind === "rule-set" ? "v7-m14" : kind === "presentation" ? "v4" : "v1"}.json`,
      );
      mutate(value, c);
      assert.throws(() => validators[kind](value));
    });
}
for (const c of fixture("document-boundaries-v4.json"))
  test(c.name, () => {
    const value = fixture(
      `${c.kind}-${c.kind === "scene" ? "v6-m14" : c.kind === "rule-set" ? "v7-m14" : c.kind === "presentation" ? "v4" : "v1"}.json`,
    );
    if (c.nodeCount !== undefined) {
      value.nodes = Array.from({ length: c.nodeCount }, (_, i) => ({
        ...structuredClone(value.nodes[0]),
        id: `n${i}`,
        title: { parts: [] },
        subtitle: { parts: [] },
        ports: [],
        compartments: [],
        children: [],
      }));
      value.edges = [];
    } else mutate(value, c);
    if (c.accept) validators[c.kind](value);
    else assert.throws(() => validators[c.kind](value));
  });
test("legacy scene is refused", () =>
  assert.throws(() => validateScene(fixture("scene-v1.json"))));

for (const key of ["__proto__", "constructor", "toString"])
  test(`opaque view key ${key} does not resolve an inherited presentation entry`, async () => {
    const { graphPresentation } = await import("../src/protocol.ts");
    assert.equal(
      graphPresentation({ schemaVersion:4, views: {} }, key),
      undefined,
    );
    const p = JSON.parse(
      `{"schemaVersion":4,"views":{${JSON.stringify(key)}:{"form":"graph","packageFingerprint":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","projection":"fixture","routeConstraints":{},"labelPlacements":{},"positions":{},"viewport":{"x":0,"y":0,"zoom":1}}}}`,
    );
    validatePresentation(p);
    assert.equal(graphPresentation(p, key)?.form, "graph");
  });
