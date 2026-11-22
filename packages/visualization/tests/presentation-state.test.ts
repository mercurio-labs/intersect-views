import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { previewPresentationV3,PresentationHistory } from "../src/presentation-state.ts";
import { validatePresentation } from "../src/validation.ts";
import type { GraphPresentation } from "../src/protocol.ts";
const old=()=>JSON.parse(readFileSync(new URL("../../../crates/intersect-views/tests/fixtures/presentation-v3.json",import.meta.url),"utf8"));
const graph=():GraphPresentation=>({form:"graph",packageFingerprint:"0".repeat(64),projection:"fixture",positions:{},viewport:{x:0,y:0,zoom:1},routeConstraints:{},labelPlacements:{}});
test("migration requires explicit matching identities and preserves original bytes",()=>{
  const value=old(),bytes=JSON.stringify(value),mappings=Object.entries(value.views).map(([viewKey,v]:[string,any])=>({viewKey,oldFingerprint:v.packageFingerprint,oldProjection:v.projection,decision:{kind:"compatible" as const,fingerprint:"1".repeat(64),projection:v.projection}}));
  assert.throws(()=>previewPresentationV3(value,[]));const preview=previewPresentationV3(value,mappings);validatePresentation(preview.candidate);
  assert.equal(JSON.stringify(value),bytes);assert.equal(preview.candidate.schemaVersion,4);
  assert.equal(preview.candidate.views[mappings[0].viewKey].packageFingerprint,"1".repeat(64));
  assert.throws(()=>previewPresentationV3(value,[{...mappings[0],oldFingerprint:"bad"},...mappings.slice(1)]));
  const reset=previewPresentationV3(value,mappings.map(m=>({...m,decision:{kind:"reset"}})));assert.deepEqual(reset.candidate.views,{});assert.equal(reset.resetViews.length,mappings.length);
});
test("malformed old fields cannot be hidden behind a reset decision",()=>{
  const value=old(),mappings=Object.entries(value.views).map(([viewKey,v]:[string,any])=>({viewKey,oldFingerprint:v.packageFingerprint,oldProjection:v.projection,decision:{kind:"reset" as const}}));
  Object.values<any>(value.views)[0].unexpected=true;assert.throws(()=>previewPresentationV3(value,mappings));
});
test("placement history is separate, atomic, bounded to 64, and context checked",()=>{
  const view=graph(),history=new PresentationHistory(view),positionBytes=JSON.stringify(view.positions);
  for(let i=1;i<=66;i++)history.apply(view,{routeConstraints:{},labelPlacements:{label:{kind:"owner",dx:i,dy:0}}});
  for(let i=0;i<64;i++)assert.equal(history.undo(view),true);assert.equal(history.undo(view),false);assert.equal(view.labelPlacements.label.kind==="owner"&&view.labelPlacements.label.dx,2);
  assert.equal(history.redo(view),true);const bytes=JSON.stringify(view);
  assert.throws(()=>history.apply(view,{routeConstraints:{},labelPlacements:{label:{kind:"route",fraction:2,tangentOffset:0,normalOffset:0}}}));assert.equal(JSON.stringify(view),bytes);
  history.apply(view,{routeConstraints:{},labelPlacements:{}});assert.equal(history.redo(view),false);assert.equal(JSON.stringify(view.positions),positionBytes);
  view.packageFingerprint="1".repeat(64);const changed=JSON.stringify(view);assert.throws(()=>history.undo(view));assert.equal(JSON.stringify(view),changed);
});
