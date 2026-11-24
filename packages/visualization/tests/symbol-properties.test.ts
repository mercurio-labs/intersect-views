import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GraphicDefinitions } from "../src/graphics-contract.ts";
import {
  resolveProperties,
  propertyKey,
  validateSymbolOverrides,
} from "../src/symbol-properties-contract.ts";
const cases = JSON.parse(
  readFileSync(
    new URL(
      "../../../crates/intersect-views/tests/fixtures/symbol-properties-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
for (const c of cases)
  test(`shared visual property contract: ${c.name}`, () => {
    if (c.accepted)
      assert.doesNotThrow(() => new GraphicDefinitions([c.library]));
    else assert.throws(() => new GraphicDefinitions([c.library]));
  });
test("qualified per-occurrence overrides retain inherited values and protect rule parameters", () => {
  const def = cases[0].library.definitions[0],
    values = Object.fromEntries(
      Object.entries<any>(def.parameters).map(([k, p]) => [k, p.default]),
    ),
    property = def.properties.find((p: any) => p.id === "fill"),
    key = propertyKey(def, def.id, property),
    overrides = { first: { [key]: "#123456" } },
    targets: any[] = [];
  validateSymbolOverrides(overrides);
  assert.equal(
    resolveProperties(
      def,
      "first",
      def.id,
      values,
      new Set(),
      overrides,
      targets,
    ).fill,
    "#123456",
  );
  assert.equal(targets.find((p) => p.key === key).inherited, values.fill);
  assert.equal(
    resolveProperties(def, "second", def.id, values, new Set(), overrides, [])
      .fill,
    values.fill,
  );
  assert.throws(
    () =>
      resolveProperties(
        def,
        "first",
        def.id,
        values,
        new Set(["fill"]),
        overrides,
        [],
      ),
    /protected/,
  );
  assert.throws(
    () => validateSymbolOverrides({ first: { foreign: true } }),
    /Malformed/,
  );
});

import { layoutGraphic } from "../src/graphics-layout.ts";
import { SymbolEdit, SymbolHistory } from "../src/symbol-editor.ts";
import {
  previewPresentationV3,
  previewPresentationV4,
} from "../src/presentation-state.ts";
import { validatePresentation } from "../src/validation.ts";
import type { GraphPresentation } from "../src/protocol.ts";
test("visual overrides remeasure complete bound text and ink while preserving source identities", () => {
  const lib = structuredClone(cases[0].library),
    d = lib.definitions[0],
    values = Object.fromEntries(
      Object.entries<any>(d.parameters).map(([k, p]) => [k, p.default]),
    );
  const instance = {
      definition: d.id,
      parameters: values,
      sourceParameters: [],
      slots: { title: { kind: "title" as const } },
    },
    binding = {
      key: "source:shared",
      elementId: "snapshot:1",
      uri: "model.harness",
      readOnly: true,
      context: [],
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 12 },
      },
    },
    part = {
      id: "title:part",
      text: "Repeated inherited semantic title with complete source content",
      binding,
      editTool: null,
    };
  const content = {
      title: {
        kind: "text" as const,
        owner: "first",
        binding,
        slot: "node.title",
        block: { runs: [{ id: "title", parts: [part] }] },
      },
    },
    measure = (s: string, size: number) => s.length * size * 0.55,
    source = JSON.stringify({ lib, instance, content });
  const base = layoutGraphic(
      new GraphicDefinitions([lib]),
      instance,
      "first",
      content,
      180,
      measure,
    ),
    block = Object.keys(base.labels)[0],
    font = base.propertyTargets.find(
      (p) => p.target === block && p.descriptor.id === "fontSize",
    )!,
    line = base.propertyTargets.find(
      (p) => p.target === "first" && p.descriptor.id === "strokeWidth",
    )!;
  const styled = layoutGraphic(
    new GraphicDefinitions([lib], {
      [block]: { [font.key]: 28 },
      first: { [line.key]: 12 },
    }),
    instance,
    "first",
    content,
    180,
    measure,
  );
  assert.equal(Object.keys(styled.labels)[0], block);
  assert.ok(styled.height > base.height);
  assert.ok(
    new Set(styled.fragments.map((f) => f.rect.y)).size >
      new Set(base.fragments.map((f) => f.rect.y)).size,
  );
  assert.ok(
    styled.fragments.every(
      (f) => f.part === part && f.binding === binding && f.size === 28,
    ),
  );
  assert.ok(
    styled.geometry.some((g) => g.x === -6 && g.width === styled.width + 12),
  );
  assert.match(styled.markup, /stroke-width:12/);
  const other = layoutGraphic(
    new GraphicDefinitions([lib], { [block]: { [font.key]: 28 } }),
    instance,
    "second",
    content,
    180,
    measure,
  );
  assert.ok(other.fragments.every((f) => f.size === 14));
  assert.equal(JSON.stringify({ lib, instance, content }), source);
  const protectedInstance = { ...instance, sourceParameters: ["strokeWidth"] };
  assert.throws(
    () =>
      layoutGraphic(
        new GraphicDefinitions([lib], { first: { [line.key]: 12 } }),
        protectedInstance,
        "first",
        content,
        180,
        measure,
      ),
    /protected/,
  );
});

test("explicit mixed selections refuse ineligible targets and history preserves later placement", () => {
  const d = cases[0].library.definitions[0],
    values = Object.fromEntries(
      Object.entries<any>(d.parameters).map(([k, p]) => [k, p.default]),
    ),
    targets: any[] = [];
  resolveProperties(d, "a", d.id, values, new Set(), {}, targets);
  resolveProperties(
    d,
    "b",
    d.id,
    { ...values, fill: "#ff0000" },
    new Set(),
    {},
    targets,
  );
  const v: GraphPresentation = {
      form: "graph",
      packageFingerprint: "0".repeat(64),
      projection: "fixture",
      positions: {
        a: { x: 10, y: 20, width: 200, height: 100 },
        b: { x: 500, y: 20, width: 200, height: 100 },
      },
      symbolOverrides: {},
      routeConstraints: {},
      labelPlacements: { label: { kind: "owner", dx: 17, dy: 21 } },
      viewport: { x: 4, y: 5, zoom: 0.7 },
    },
    bytes = JSON.stringify(v),
    edit = new SymbolEdit(v, ["a", "b"], targets),
    fill = edit.rows.find((r) => r.targets[0].descriptor.id === "fill")!;
  assert.equal(fill.mixed, true);
  edit.set(fill.key, "#123456");
  assert.equal(JSON.stringify(v), bytes);
  assert.throws(() => edit.set(fill.key, "url(x)"));
  assert.equal(edit.draft.symbolOverrides.a[fill.key], "#123456");
  edit.size("a", undefined, undefined, { width: 140, height: 64 });
  assert.deepEqual(edit.draft.positions.a, { x: 10, y: 20 });
  assert.throws(() => edit.size("b", 100, 20, { width: 140, height: 64 }));
  const history = new SymbolHistory(v.packageFingerprint, v.projection);
  history.apply(v, edit.candidate(v));
  v.positions.a.x = 90;
  v.labelPlacements.label = { kind: "owner", dx: 29, dy: 31 };
  history.undo(v);
  assert.deepEqual(v.positions.a, { x: 90, y: 20, width: 200, height: 100 });
  assert.deepEqual(v.labelPlacements.label, { kind: "owner", dx: 29, dy: 31 });
  assert.deepEqual(v.symbolOverrides, {});
  history.redo(v);
  assert.deepEqual(v.positions.a, { x: 90, y: 20 });
  assert.equal(v.symbolOverrides.b[fill.key], "#123456");
  const incompatible = new SymbolEdit(v, ["a", "missing"], targets);
  assert.throws(() => incompatible.set(fill.key, "#abcdef"), /Unavailable/);
  edit.invalidate();
  assert.throws(() => edit.candidate(v), /stale/);
});

test("explicit v4 migration preserves all M14 placement fields and v3 chains through v4", () => {
  const old = JSON.parse(
      readFileSync(
        new URL(
          "../../../crates/intersect-views/tests/fixtures/presentation-v4.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    bytes = JSON.stringify(old),
    mapping = (p: any) =>
      Object.entries<any>(p.views).map(([viewKey, v]) => ({
        viewKey,
        oldFingerprint: v.packageFingerprint,
        oldProjection: v.projection,
        decision: {
          kind: "compatible" as const,
          fingerprint: v.packageFingerprint,
          projection: v.projection,
        },
      }));
  assert.throws(() => validatePresentation(old));
  const result = previewPresentationV4(old, mapping(old));
  assert.equal(result.to, 5);
  validatePresentation(result.candidate);
  assert.equal(JSON.stringify(old), bytes);
  for (const [key, view] of Object.entries<any>(old.views)) {
    const migrated: any = result.candidate.views[key];
    assert.deepEqual(migrated, {
      ...view,
      ...(view.form === "graph" ? { symbolOverrides: {} } : {}),
    });
  }
  assert.throws(
    () =>
      previewPresentationV4(
        old,
        mapping(old).map((m) => ({
          ...m,
          decision: {
            kind: "compatible" as const,
            fingerprint: "f".repeat(64),
            projection: m.oldProjection,
          },
        })),
      ),
    /explicit compatibility decision/,
  );
  const upgraded = previewPresentationV4(old, mapping(old).map((m) => ({
    ...m,
    decision: {
      kind: "compatible-package-upgrade",
      fingerprint: "f".repeat(64),
      projection: m.oldProjection,
    },
  }))).candidate;
  for (const [key, view] of Object.entries(upgraded.views))
    assert.deepEqual(view, {
      ...result.candidate.views[key],
      packageFingerprint: "f".repeat(64),
    });
  const malformed = structuredClone(old);
  Object.values<any>(malformed.views)[0].surprise = true;
  assert.throws(() =>
    previewPresentationV4(
      malformed,
      mapping(old).map((m) => ({ ...m, decision: { kind: "reset" as const } })),
    ),
  );
  const v3 = JSON.parse(
      readFileSync(
        new URL(
          "../../../crates/intersect-views/tests/fixtures/presentation-v3.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    v4 = previewPresentationV3(v3, mapping(v3)).candidate;
  assert.equal(
    previewPresentationV4(v4, mapping(v4)).candidate.schemaVersion,
    5,
  );
});

test("native/TS v5 persisted scalar and allocation vectors", () => {
  const vectors = JSON.parse(
    readFileSync(
      new URL(
        "../../../crates/intersect-views/tests/fixtures/symbol-presentation-v5.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const v of vectors)
    if (v.accepted)
      assert.doesNotThrow(() => validatePresentation(v.value), v.name);
    else assert.throws(() => validatePresentation(v.value), v.name);
});

test("empty override targets still consume the byte budget", () => {
  assert.throws(
    () =>
      validateSymbolOverrides(
        Object.fromEntries(
          Array.from({ length: 5000 }, (_, i) => ["a".repeat(250) + i, {}]),
        ),
      ),
    /budget/,
  );
});
