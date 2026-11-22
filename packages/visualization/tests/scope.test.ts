import test from "node:test";
import assert from "node:assert/strict";
import { Exploration } from "../src/scope.ts";
test("exploration is ordered, isolated and saves and reloads losslessly", () => {
  const state = new Exploration();
  state.append({ op: "addSeed", element: "a" });
  state.append({ op: "expand", element: "a", relation: "linked", hops: 2 });
  state.append({ op: "hide", element: "b" });
  state.append({ op: "collapse", element: "c", context: ["a"] });
  state.append({ op: "removeSeed", element: "a" });
  const saved = JSON.parse(
    JSON.stringify(state.document("v", "View", "rules")),
  );
  assert.deepEqual(new Exploration(saved.scope).scope, state.scope);
  const copy = state.scope;
  copy.ops.length = 0;
  assert.equal(state.scope.ops.length, 5);
  state.undo();
  assert.equal(state.scope.ops.length, 4);
});
test("scope op admission does not mutate when the limit fails", () => {
  const state = new Exploration({
    schemaVersion: 1,
    ops: Array.from({ length: 4096 }, () => ({ op: "addSeed", element: "a" })),
  });
  assert.throws(() => state.append({ op: "hide", element: "a" }));
  assert.equal(state.scope.ops.length, 4096);
});
