import test from "node:test";
import assert from "node:assert/strict";
import {PlacementEditor} from "../src/placement-editor.ts";
import {PresentationHistory} from "../src/presentation-state.ts";
import type {GraphPresentation} from "../src/protocol.ts";
const fixture=():GraphPresentation=>({form:"graph",projection:"rules",packageFingerprint:"0".repeat(64),positions:{},viewport:{x:0,y:0,zoom:1},routeConstraints:{},labelPlacements:{}});
test("manual route preview/cancel is detached, and accept is one presentation undo entry",()=>{
  const view=fixture(),bytes=JSON.stringify(view),history=new PresentationHistory(view),editor=new PlacementEditor(view,{kind:"route",id:"edge",frame:"route:root"});
  editor.setRoute(view,[{x:20,y:30}]);assert.equal(JSON.stringify(view),bytes);assert.deepEqual(editor.preview(view).routeConstraints.edge.waypoints,[{x:20,y:30}]);
  editor.setRoute(view,[{x:40,y:60}]);editor.accept(view,history);assert.equal(history.undo(view),true);assert.equal(JSON.stringify(view),bytes);assert.equal(history.undo(view),false);
  const cancel=new PlacementEditor(view,{kind:"route",id:"edge",frame:"route:root"});cancel.setRoute(view,[{x:10,y:20}]);cancel.cancel();assert.equal(JSON.stringify(view),bytes);assert.throws(()=>cancel.preview(view));
});
test("invalid label updates and stale package/placement contexts cannot partially apply",()=>{
  const view=fixture(),editor=new PlacementEditor(view,{kind:"label",id:"label",frame:"route"});
  editor.setLabel(view,{kind:"route",fraction:.5,tangentOffset:10,normalOffset:-5});const bytes=JSON.stringify(editor.preview(view));
  assert.throws(()=>editor.setLabel(view,{kind:"route",fraction:2,tangentOffset:0,normalOffset:0}));assert.equal(JSON.stringify(editor.preview(view)),bytes);
  assert.throws(()=>editor.setLabel(view,{kind:"owner",dx:0,dy:0}));
  view.packageFingerprint="1".repeat(64);const before=JSON.stringify(view);assert.throws(()=>editor.accept(view,new PresentationHistory(view)));assert.equal(JSON.stringify(view),before);
});
