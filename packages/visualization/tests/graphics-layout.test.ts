import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GraphicDefinitions } from "../src/graphics-contract.ts";
import { layoutGraphic, measureBlock } from "../src/graphics-layout.ts";
import ELK from "elkjs/lib/elk.bundled.js";
import { drawGraphic, graphicGraphLayout } from "../src/graph-graphics.ts";
const library = () => JSON.parse(readFileSync(new URL("../../../harness/views/symbols/classic.symbols.json",import.meta.url),"utf8"));
const measure = (s: string, size: number) => [...s].length * size / 2;
const binding = { key:"source:actual",elementId:"snapshot:2",context:["instance:a"],uri:"actual.model",range:{start:{line:1,character:2},end:{line:1,character:7}},readOnly:false };
for(const name of ["sysml","electrical","fault"]) test(`independent ${name} library uses the generic renderer`,()=>{
  const lib=JSON.parse(readFileSync(new URL(`../../../harness/views/symbols/${name}.symbols.json`,import.meta.url),"utf8")), defs=new GraphicDefinitions([lib]);
  const node=JSON.parse(readFileSync(new URL("../../../crates/intersect-views/tests/fixtures/scene-v6-m14.json",import.meta.url),"utf8")).nodes[0];
  node.text.documentation={runs:[{id:"doc",parts:[{id:"logical:doc",text:"Requirement paragraph\ntrigger / guard / effect",binding:node.binding,editTool:null}]}]};
  for(const d of lib.definitions){
    const slots=Object.fromEntries(Object.entries(d.slots).map(([key,type])=>[key,type==="compartments"?{kind:"compartments"}:key==="title"||key==="subtitle"?{kind:key}:{kind:"text",name:"documentation"}]));
    const instance={definition:d.id,parameters:Object.fromEntries(Object.entries(d.parameters).map(([key,p]:[string,any])=>[key,p.default])),slots};
    const drawing=drawGraphic(defs,instance,node,360,measure);
    assert.ok(Number.isFinite(drawing.width)); assert.ok(Number.isFinite(drawing.height));
    assert.ok(!drawing.markup.includes("<script"));
  }
});
test("wrapped LF and Unicode fragments keep logical identities and exact source bindings", () => {
  const part = {id:"logical:a",text:"Alpha βeta 👩‍🔬\nsecond <script>",binding,editTool:null};
  const content = {kind:"text" as const,owner:"occurrence:a",binding,slot:"node.text.doc",block:{runs:[{id:"run",parts:[part]}]}};
  const style = {size:14,weight:400,italic:false,align:"start" as const,wrap:true,color:"#123456"};
  const narrow = measureBlock(content,55,style,measure), wide=measureBlock(content,230,style,measure);
  assert.ok(narrow.height>wide.height);
  for (const f of [...narrow.fragments,...wide.fragments]) { assert.equal(f.part,part);assert.equal(f.binding,binding);assert.equal(f.owner,"occurrence:a"); }
  assert.ok(narrow.markup.includes("&lt;script&gt;") || narrow.markup.includes("&lt;"));
  assert.ok(!wide.markup.includes("<script>"));
  assert.equal(narrow.fragments.filter(f=>f.text.includes("👩")).length,1);
  assert.equal(part.text,"Alpha βeta 👩‍🔬\nsecond <script>");
});
test("rotation, translation and reuse transform named connection points with geometry", () => {
  const lib=library(), port=lib.definitions.find((d:any)=>d.role==="port");
  port.root=port.root.content.children[0];port.slots={};
  port.root.content.x=12;port.root.content.y=5;
  lib.definitions.push({id:"harness.symbols/reused",version:"1",role:"port",parameters:{},slots:{},connectionAnchor:"nested/tip",root:{id:"nested",when:null,anchors:[],content:{kind:"use",definition:port.id,parameters:{angle:{kind:"constant",value:90}},slots:{}}}});
  const defs=new GraphicDefinitions([lib]);
  const drawing=layoutGraphic(defs,{definition:"harness.symbols/reused",parameters:{},slots:{}},"port:a",{},16,measure);
  const p=drawing.anchors["nested/tip"];
  assert.ok(Math.abs(p.x-20)<1e-8);assert.ok(Math.abs(p.y-21)<1e-8);
  assert.ok(Math.abs(p.dx)<1e-8);assert.ok(Math.abs(p.dy-1)<1e-8);
  assert.equal(drawing.width,28);assert.equal(drawing.height,21);
});
test("hidden connection anchors and zero evaluated scale refuse rendering",()=>{
  for(const kind of ["hidden","scale"]){
    const lib=library(),port=lib.definitions.find((d:any)=>d.role==="port");
    port.root=port.root.content.children[0];port.slots={};
    if(kind==="hidden")port.root.when=false;else port.root.content.scaleX={op:"parameter",name:"angle"};
    assert.throws(()=>{const defs=new GraphicDefinitions([lib]);return layoutGraphic(defs,{definition:port.id,parameters:{angle:0,facing:"EAST"},slots:{}},"port:a",{},16,measure);});
  }
});

test("authored sizing measures slots after width allocation and preserves full bound hits",()=>{
  const lib=library(),d=lib.definitions.find((d:any)=>d.id.endsWith("/structured"));
  d.size={minimumWidth:180,preferredWidth:300,minimumHeight:30,preferredHeight:{op:"max",left:30,right:{op:"slotHeight",slot:"doc"}}};
  const defs=new GraphicDefinitions([lib]);
  const parameters=Object.fromEntries(Object.entries(d.parameters).map(([key,p]:[string,any])=>[key,p.default]));
  const contents:any={title:{kind:"text",owner:"a",binding,slot:"node.title",block:{runs:[{id:"a",parts:[{id:"title:a",text:"Title",binding,editTool:null}]}]}},subtitle:{kind:"text",owner:"a",binding,slot:"node.subtitle",block:{runs:[]}},doc:{kind:"text",owner:"a",binding,slot:"doc",block:{runs:[{id:"doc",parts:[{id:"doc:a",text:"A long requirement paragraph with trigger / guard / effect. ".repeat(8),binding,editTool:null}]}]}},compartments:{kind:"compartments",owner:"a",binding,items:[]}};
  const slots:any=Object.fromEntries(Object.entries(d.slots).map(([key,type])=>[key,type==="compartments"?{kind:"compartments"}:{kind:"text",name:key}]));
  const instance={definition:d.id,parameters,slots};
  const preferred=layoutGraphic(defs,instance,"a",contents,undefined,measure),minimum=layoutGraphic(defs,instance,"a",contents,1,measure);
  assert.ok(preferred.width>=300);assert.ok(minimum.width>=180);assert.ok(minimum.height>=preferred.height);
  assert.ok(minimum.fragments.every(f=>f.rect.x>=0&&f.rect.y>=0&&f.rect.y+f.rect.height<=minimum.height));
});

test("newline-only bound text retains an accessible logical hit",()=>{
  const part={id:"newline:a",text:"\n\n",binding,editTool:null};
  const drawing=measureBlock({kind:"text",owner:"a",binding,slot:"doc",block:{runs:[{id:"doc",parts:[part]}]}},100,{size:14,weight:400,italic:false,align:"start",wrap:true,color:"#000000"},measure);
  assert.equal(drawing.fragments.length,1);assert.equal(drawing.fragments[0].part,part);assert.match(drawing.markup,/tabindex="0"/);assert.ok(drawing.fragments[0].rect.width>0);
});

test("compartment hit rectangles include heading and preceding row offsets",()=>{
  const lib=library(),d=lib.definitions.find((d:any)=>d.id.endsWith("/structured"));
  delete d.size;
  d.root={id:"rows",when:null,anchors:[],content:{kind:"content",slot:"compartments"}};d.slots={compartments:"compartments"};
  const defs=new GraphicDefinitions([lib]),parameters=Object.fromEntries(Object.entries(d.parameters).map(([key,p]:[string,any])=>[key,p.default]));
  const row=(id:string)=>({id,binding,label:{parts:[{id:"label:"+id,text:id,binding,editTool:null}]}});
  const result=layoutGraphic(defs,{definition:d.id,parameters,slots:{compartments:{kind:"compartments"}}},"a",{compartments:{kind:"compartments",owner:"a",binding,items:[{id:"compartments",label:"Fields",rows:[row("first"),row("second")]}]}},200,measure);
  const first=result.fragments.find(f=>f.part.id==="label:first")!,second=result.fragments.find(f=>f.part.id==="label:second")!;
  assert.ok(first.rect.y>0);assert.ok(second.rect.y>=first.rect.y+first.rect.height);assert.ok(second.rect.y+second.rect.height<=result.height);
});

test("unbreakable grapheme grows measured bounds instead of clipping",()=>{
 const part={id:"emoji:a",text:"👩‍🔬",binding,editTool:null};
 const d=measureBlock({kind:"text",owner:"a",binding,slot:"doc",block:{runs:[{id:"doc",parts:[part]}]}},1,{size:14,weight:400,italic:false,align:"start",wrap:true,color:"#000000"},measure);
 assert.equal(d.fragments.length,1);assert.equal(d.fragments[0].text,part.text);assert.ok(d.width>=d.fragments[0].rect.width);
});


test("authored flat containment edges constrain real layered geometry",async()=>{
 const scene=JSON.parse(readFileSync(new URL("../../../crates/intersect-views/tests/fixtures/scene-v6-m14.json",import.meta.url),"utf8"));
 const lib=library(),d=lib.definitions.find((d:any)=>d.id.endsWith("/structured"));
 const base=structuredClone(scene.nodes[0]);
 const node=(id:string)=>({...structuredClone(base),id,children:[],regions:null,ports:[],compartments:[],text:{documentation:{runs:[]}},graphic:{definition:d.id,parameters:Object.fromEntries(Object.entries(d.parameters).map(([k,p]:[string,any])=>[k,p.default])),slots:{title:{kind:"title"},subtitle:{kind:"subtitle"},doc:{kind:"text",name:"documentation"},compartments:{kind:"compartments"}}}});
 const edge=(id:string,source:string,target:string)=>({...structuredClone(scene.edges[0]),id,source,target});
 scene.nodes=[node("a"),node("b"),node("c")];scene.edges=[edge("ab","a","b"),edge("bc","b","c")];scene.layout.direction="DOWN";
 const elk=new ELK(),groups:{nodes:string[];edges:string[]}[]=[];
 const arrange=async(nodes:any[],edges:any[])=>{groups.push({nodes:nodes.map(n=>n.id),edges:edges.map(e=>e.id)});const g=await elk.layout({id:"root",children:nodes,edges:edges.map(e=>({id:e.id,sources:[e.source],targets:[e.target]})),layoutOptions:{"elk.algorithm":"layered","elk.direction":"DOWN"}});return g.children??[];};
 const result=await graphicGraphLayout(scene,{schemaVersion:4,views:{}},{fingerprint:"0".repeat(64),libraries:[lib]},measure,arrange);
 for(const e of scene.edges)assert.ok(result.nodes[e.target].y>=result.nodes[e.source].y+result.nodes[e.source].height);
 assert.deepEqual(groups.find(g=>g.nodes.length===3)?.edges,["ab","bc"]);
 // A root container and its child are separate composition levels. A crossing
 // edge must not be handed to ELK with an endpoint absent from that level.
 const a=node("a");a.graphic=null;a.children=[node("b")];scene.nodes=[a,node("c")];scene.edges=[edge("ac","a","c"),edge("bc","b","c")];groups.length=0;
 await graphicGraphLayout(scene,{schemaVersion:4,views:{}},{fingerprint:"0".repeat(64),libraries:[lib]},measure,arrange);
 assert.deepEqual(groups.find(g=>g.nodes.includes("a"))?.edges,["ac"]);
 assert.deepEqual(groups.find(g=>g.nodes.includes("b"))?.edges,[]);
});
