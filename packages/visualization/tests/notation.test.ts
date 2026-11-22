import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateNotation } from "../src/notation.ts";
const read = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../crates/intersect-views/tests/fixtures/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
test("shared notation accepted", () =>
  validateNotation(read("notation-v1.json")));
for (const rejection of read("notation-v1-rejections.json"))
  test(`notation: ${rejection.name}`, () => {
    const p = read("notation-v1.json"),
      keys = rejection.pointer.slice(1).split("/"),
      last = keys.pop();
    let target = p;
    for (const key of keys) target = target[key];
    target[last] = rejection.value;
    assert.throws(() => validateNotation(p));
  });
