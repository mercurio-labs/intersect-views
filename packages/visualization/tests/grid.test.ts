import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateScene,
  validateRuleSet,
  validateGridTargets,
} from "../src/protocol.ts";
const validators = {
  scene: validateScene,
  rules: validateRuleSet,
  targets: validateGridTargets,
};
for (const accept of [true, false])
  for (const c of JSON.parse(
    readFileSync(
      new URL(
        `../../../crates/intersect-views/tests/fixtures/grid-v7-${accept ? "accepted" : "rejected"}-m14.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  )) {
    test(`grid contract ${c.name} ${accept ? "accept" : "reject"}`, () => {
      const validate = validators[c.kind as keyof typeof validators];
      if (accept) validate(c.value);
      else assert.throws(() => validate(c.value));
    });
  }

test("binding property order does not change grid provenance", () => {
  const accepted = JSON.parse(
    readFileSync(
      new URL(
        "../../../crates/intersect-views/tests/fixtures/grid-v7-accepted-m14.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const value = accepted.find((c: any) => c.name === "matrix").value;
  value.grid.cells[0].binding = Object.fromEntries(
    Object.entries(value.grid.cells[0].binding).reverse(),
  );
  validateScene(value);
});
