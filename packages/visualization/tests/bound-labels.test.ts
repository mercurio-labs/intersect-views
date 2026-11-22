import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GraphicDefinitions } from "../src/graphics-contract.ts";
import { layoutGraphic, type BoundGraphicContent } from "../src/graphics-layout.ts";
const library=()=>JSON.parse(readFileSync(new URL("../../../harness/views/symbols/classic.symbols.json",import.meta.url),"utf8"));
const measure=(s:string,size:number)=>s.length*size*.5;
const binding={key:"actual",elementId:"snapshot:1",uri:"actual.model",context:["occurrence"],readOnly:true,range:{start:{line:1,character:2},end:{line:1,character:9}}};
function fixture(){
  const lib=library(),d=lib.definitions.find((v:any)=>v.id.endsWith("/structured"));
  delete d.size;d.parameters={};d.slots={title:"text"};d.root={id:"text",when:null,anchors:[],content:{kind:"text",slot:"title",size:14,weight:400,italic:false,align:"start",wrap:true,color:"#123456"}};
  const contents:Record<string,BoundGraphicContent>={title:{kind:"text",owner:"node:a",binding,slot:"node.title",block:{runs:[{id:"logical-run",parts:[{id:"source-part",text:"Long title text that wraps across several lines",binding,editTool:null}]}]}}};
  return {lib,d,contents,instance:{definition:d.id,parameters:{},slots:{title:{kind:"title" as const}}}};
}
test("a whole text block keeps its identity across reflow and source text changes",()=>{
  const f=fixture(),defs=new GraphicDefinitions([f.lib]);
  const narrow=layoutGraphic(defs,f.instance,"node:a",f.contents,70,measure),wide=layoutGraphic(defs,f.instance,"node:a",f.contents,240,measure);
  assert.deepEqual(Object.keys(narrow.labels),Object.keys(wide.labels));assert.ok(narrow.height>wide.height);
  const value=f.contents.title;if(value.kind!=="text")throw Error("Expected text");value.block.runs[0].parts[0].text="Changed content";
  const changed=layoutGraphic(defs,f.instance,"node:a",f.contents,70,measure);assert.deepEqual(Object.keys(changed.labels),Object.keys(narrow.labels));
  const other=layoutGraphic(defs,f.instance,"node:b",f.contents,70,measure);assert.notDeepEqual(Object.keys(other.labels),Object.keys(narrow.labels));
});
test("owner offsets transform with authored rotation without moving the owner or its anchor",()=>{
  const f=fixture();f.d.root={id:"rotated",when:null,anchors:[{id:"terminal",x:0,y:0,dx:1,dy:0}],content:{kind:"transform",x:10,y:20,rotate:90,scaleX:1,scaleY:1,child:f.d.root}};
  const defs=new GraphicDefinitions([f.lib]),before=layoutGraphic(defs,f.instance,"node:a",f.contents,180,measure),id=Object.keys(before.labels)[0];
  const moved=layoutGraphic(defs,f.instance,"node:a",f.contents,180,measure,undefined,{[id]:{kind:"owner",dx:12,dy:7}});
  assert.equal(moved.width,before.width);assert.equal(moved.height,before.height);assert.deepEqual(moved.anchors,before.anchors);
  const a=before.labels[id].rect,b=moved.labels[id].rect;assert.ok(Math.abs(b.x-a.x+7)<1e-8);assert.ok(Math.abs(b.y-a.y-12)<1e-8);
  assert.equal(moved.fragments[0].part.binding,binding);assert.deepEqual(moved.labels[id].frame,before.labels[id].frame);
  assert.throws(()=>layoutGraphic(defs,f.instance,"node:a",f.contents,180,measure,undefined,{[id]:{kind:"route",fraction:.5,tangentOffset:0,normalOffset:0}}));
});
