import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateLaneScene,
  validateLaneRules,
  validateLaneTargets,
} from "../src/lane-validation.ts";
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../crates/intersect-views/tests/fixtures/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
for (const [name, validate] of [
  ["lane-scene-v6-m14", validateLaneScene],
  ["lane-rules-v7-m14", validateLaneRules],
  ["lane-targets-v1", validateLaneTargets],
] as const) {
  test(`${name} shared accepted`, () => validate(fixture(name)));
  for (const c of fixture(`${name.replace(/-m14$/, "")}-rejections`))
    test(`${name}: ${c.name}`, () => {
      const value = fixture(name),
        keys = c.pointer.slice(1).split("/");
      let parent = value;
      for (const key of keys.slice(0, -1)) parent = parent[key];
      if (c.remove) delete parent[keys.at(-1)!];
      else parent[keys.at(-1)!] = c.value;
      assert.throws(() => validate(value));
    });
}

import { validatePresentation } from "../src/validation.ts";
test("strict tagged lane presentation has no semantic coordinates", () => {
  const p = {
    schemaVersion:5,
    views: {
      lanes: {
        form: "laneGraph", packageFingerprint: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", projection: "fixture",
        laneOrder: ["a", "b"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
  };
  validatePresentation(p);
  for (const patch of [
    { positions: {} },
    { rank: 2 },
    { laneOrder: ["a", "a"] },
    { form: "grid" },
  ])
    assert.throws(() =>
      validatePresentation({
        ...p,
        views: { lanes: { ...p.views.lanes, ...patch } },
      }),
    );
  assert.throws(
    () => validatePresentation({ schemaVersion: 1, views: {} }),
    /export or reset/,
  );
});

import {laneLayout,checkLaneOrder} from "../src/lane-layout.ts";
for(const direction of ["horizontal","vertical"] as const)test(`lane layout preserves ${direction} ranks, full labels and empty bands`,()=>{
 const scene=fixture("lane-scene-v6-m14");scene.axis.direction=direction;const order=scene.lanes.map((l:any)=>l.id),layout=laneLayout(scene,order,s=>s.length*8),again=laneLayout(scene,order,s=>s.length*8);
 assert.deepEqual(layout,again);assert.equal(layout.lanes.size,3);assert.equal(layout.steps.size,4);assert.equal(layout.spans.size,1);
 const start=layout.steps.get(scene.order[0])!,finish=layout.steps.get(scene.order.at(-1))!;
 assert(direction==="horizontal"?finish.x>start.x:finish.y>start.y);
 const label="A long label · 🚀 ".repeat(20);scene.steps[0].label.parts[0].text=label;
 const measured=laneLayout(scene,order,s=>s.length*8);assert(measured.steps.get(scene.steps[0].id)!.width>=label.length*8+32);
 const bad=[order[0],order[2],order[1]];assert.throws(()=>checkLaneOrder(scene,bad),/contiguous/);
});

test("lane encoded and container wire limits are explicit",()=>{
 const encoded=fixture("lane-scene-v6-m14");encoded.problems=["x".repeat(8*1024*1024)];assert.throws(()=>validateLaneScene(encoded),/encoded/);
 const containers=fixture("lane-scene-v6-m14");containers.steps=[];containers.spans=[];containers.order=[];const lane=containers.lanes[0];containers.lanes=Array.from({length:33},(_,i)=>({...lane,id:`lane:${i}`,container:`container:${i}`,binding:{...lane.binding,key:`element:${i}`,context:[`container:${i}`]},label:{parts:[]}}));assert.throws(()=>validateLaneScene(containers),/containers/);
});
