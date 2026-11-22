import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePresentation, validateScene } from "../src/protocol.ts";

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
test("shared Rust scene fixture is accepted", () =>
  validateScene(fixture("scene-v6-m14.json")));
for (const rejection of fixture("scene-v6-rejections.json")) {
  test(rejection.name, () => {
    const scene = fixture("scene-v6-m14.json");
    const path = rejection.pointer.slice(1).split("/");
    const key = path.pop()!;
    let target = scene;
    for (const part of path) target = target[part];
    if (rejection.remove) delete target[key];
    else target[key] = rejection.value;
    assert.throws(() => validateScene(scene));
  });
}
test("presentation round trips border ports without semantic fields", () => {
  const value = {
    schemaVersion:4,
    views: {
      view: {
        form: "graph", packageFingerprint: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", projection: "fixture",
        routeConstraints: {}, labelPlacements: {},
      positions: { port: { x: 0, y: 45, width: 12, height: 12 } },
        viewport: { x: 5, y: 10, zoom: 0.7 },
      },
    },
  };
  assert.deepEqual(parsePresentation(JSON.stringify(value)), value);
  assert.throws(() =>
    parsePresentation(JSON.stringify({ ...value, schemaVersion: 1 })),
  );
});

test("M8 graph is accepted", () => validateScene(fixture("graph-m12-m14.json")));
for (const c of fixture("graph-m8-rejections.json"))
  test(`M8 ${c.name}`, () => {
    const s = fixture("graph-m12-m14.json"),
      path = c.pointer.slice(1).split("/"),
      key = path.pop();
    let target = s;
    for (const k of path) target = target[k];
    if (c.remove) delete target[key];
    else target[key] = c.value;
    assert.throws(() => validateScene(s));
  });

test("aggregate graph part and encoded size limits", () => {
  const s = fixture("scene-v6-m14.json");
  s.nodes = s.nodes.slice(0, 1);
  s.edges = [];
  const n = s.nodes[0];
  n.title = { parts: [] };
  n.subtitle = { parts: [] };
  n.ports = [];
  const b = n.binding;
  n.compartments = [
    {
      id: "test-compartment", label: "Fields",
      rows: Array.from({ length: 5000 }, (_, i) => ({
        id: `row:${i}`,
        binding: b,
        label: {
          parts: Array.from({ length: 5 }, (_, j) => ({
            id: `part:${i}:${j}`,
            text: "x",
            binding: b,
            editTool: null,
          })),
        },
      })),
    },
  ];
  assert.throws(() => validateScene(s), /parts/);
  for (const row of n.compartments[0].rows) {
    row.label.parts = row.label.parts.slice(0, 1);
    row.label.parts[0].text = "x".repeat(2000);
  }
  assert.throws(() => validateScene(s), /encoded/i);
});
