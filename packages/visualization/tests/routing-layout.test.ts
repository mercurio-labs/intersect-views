import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { edgeLabelLayout,graphicGraphLayout,drawGraphic,edgeMarkerLayout } from "../src/graph-graphics.ts";
import { measuredRoutingRequest,routeMeasuredLayout } from "../src/routing-layout.ts";
import { routeGraph,segmentIntersectsBox } from "../src/routing.ts";
import { builtinPresentation,GraphicDefinitions,type SymbolLibrary } from "../src/graphics-contract.ts";
import { logicalId } from "../src/logical-id.ts";
import type { GraphScene,Presentation,Layout } from "../src/protocol.ts";
const load=(path:string)=>JSON.parse(readFileSync(new URL(path,import.meta.url),"utf8"));
const measure=(s:string,size:number)=>s.length*size*.5;
const context={revision:7,viewKey:"view:example",scopeIdentity:"scope:measured",packageFingerprint:builtinPresentation().fingerprint,generation:4};
const presentation=():Presentation=>({schemaVersion:5,views:{}});
const arrange=async(nodes:{id:string;width:number;height:number}[])=>nodes.map((n,i)=>({...n,x:50+i*500,y:80}));
test("wrapped transition roles preserve every selected source binding and logical part",()=>{
  const s=scene(),edge=s.edges[0],before=JSON.stringify(edge);
  const roles=["trigger","guard","effect"].map((role,i)=>({id:`role:${role}`,text:`${role}: ${"long expression 👩‍🔬 ".repeat(7)}\n`,binding:{...edge.binding,key:`source:${role}`,uri:`${role}.sysml`,range:{start:{line:i,character:0},end:{line:i+1,character:0}}},editTool:null}));
  const label={...edge,label:{parts:roles}},drawing=edgeLabelLayout(label,measure);
  assert.ok(drawing.width<=320);assert.ok(drawing.height>60);
  for(const role of roles){
    const fragments=drawing.fragments.filter(f=>f.part.id===role.id);
    assert.ok(fragments.length>1);assert.ok(fragments.every(f=>f.part===role&&f.part.binding===role.binding&&f.owner===edge.id&&f.slot==="edge.label"));
    assert.equal(fragments.map(f=>f.text).join(""),role.text.replaceAll("\n",""));
  }
  assert.equal(JSON.stringify(edge),before);
});
function scene():GraphScene {
  const s=load("../../../crates/intersect-views/tests/fixtures/scene-v6-m14.json") as GraphScene;
  s.nodes.forEach(n=>{n.children=[];n.regions=null;n.ports=[];n.compartments=[];});
  s.edges=s.edges.slice(0,1);s.edges[0].source=s.nodes[0].id;s.edges[0].target=s.nodes[1].id;
  return s;
}

test("builtin row and region labels have independent owner frames and preserve terminals",async()=>{
  const s=load("../../../crates/intersect-views/tests/fixtures/scene-v6-m14.json") as GraphScene;
  const p=presentation(),graphics=builtinPresentation(),row=s.nodes[0].compartments[0].rows[0];
  s.nodes[0].regions={direction:"row",items:[{id:"region:label",rule:"region",label:structuredClone(s.nodes[0].title),binding:structuredClone(s.nodes[0].binding),children:[]}]};
  const first=routeMeasuredLayout(s,await graphicGraphLayout(s,p,graphics,measure,arrange),p,graphics,context,measure).routing!;
  const rowId=logicalId("label",[row.id,"row.label"]),regionId=logicalId("label",["region:label","region.label"]);
  assert.ok(first.labelFrames[rowId]);assert.ok(first.labelFrames[regionId]);
  p.views[s.view.key]={form:"graph",packageFingerprint:graphics.fingerprint,projection:s.ruleSet,routeConstraints:{},labelPlacements:{[rowId]:{kind:"owner",dx:10,dy:5},[regionId]:{kind:"owner",dx:3,dy:2}},positions:{},viewport:{x:0,y:0,zoom:1}};
  const next=routeMeasuredLayout(s,await graphicGraphLayout(s,p,graphics,measure,arrange),p,graphics,context,measure).routing!;
  assert.equal(next.labelFrames[rowId].box.x,first.labelFrames[rowId].box.x+10);
  assert.equal(next.labelFrames[regionId].box.y,first.labelFrames[regionId].box.y+2);
  for(const edge of s.edges){assert.deepEqual(next.paths[edge.id].sourceTerminal,first.paths[edge.id].sourceTerminal);assert.deepEqual(next.paths[edge.id].targetTerminal,first.paths[edge.id].targetTerminal);}
});

test("authored compartment rows retain movable block identity and the actual row source",()=>{
  const s=load("../../../crates/intersect-views/tests/fixtures/scene-v6-m14.json") as GraphScene,node=s.nodes[0],row=node.compartments[0].rows[0];
  const library:SymbolLibrary={schemaVersion:1,id:"rows",imports:[],definitions:[{id:"rows/card",version:"1",role:"node",parameters:{},slots:{rows:"compartments"},connectionAnchor:null,root:{id:"content",when:null,anchors:[],content:{kind:"content",slot:"rows"}}}]};
  const definitions=new GraphicDefinitions([library]),instance={definition:"rows/card",parameters:{},slots:{rows:{kind:"compartments" as const}}};
  const first=drawGraphic(definitions,instance,node,300,measure),entry=Object.entries(first.labels).find(([,f])=>f.binding.key===row.binding.key)!;
  assert.ok(entry);const [id,frame]=entry,next=drawGraphic(definitions,instance,node,300,measure,{},undefined,{[id]:{kind:"owner",dx:9,dy:4}});
  assert.equal(next.labels[id].rect.x,frame.rect.x+9);assert.equal(next.labels[id].rect.y,frame.rect.y+4);
  assert.ok(next.fragments.filter(f=>f.owner===row.id).every(f=>f.binding===row.binding));
  assert.ok(next.markup.includes(`data-bound-label-block="${id}"`));
});

test("fixed authored ink stays the terminal envelope when manual allocation is larger",async()=>{
  const s=scene(),p=presentation(),library:SymbolLibrary={schemaVersion:1,id:"fixed",imports:[],definitions:[{id:"fixed/circle",version:"1",role:"node",parameters:{},slots:{},connectionAnchor:null,size:{minimumWidth:24,preferredWidth:24,minimumHeight:24,preferredHeight:24},root:{id:"ink",when:null,anchors:[],content:{kind:"geometry",geometry:{kind:"ellipse",width:24,height:24},fill:"#123456",stroke:"#234567",strokeWidth:1}}}]};
  s.nodes[0].graphic={definition:"fixed/circle",parameters:{},slots:{}};
  const graphics={fingerprint:"3".repeat(64),libraries:[library]};
  p.views[s.view.key]={form:"graph",packageFingerprint:graphics.fingerprint,projection:s.ruleSet,routeConstraints:{},labelPlacements:{},symbolOverrides:{},positions:{[s.nodes[0].id]:{x:100,y:80,width:400,height:200}},viewport:{x:0,y:0,zoom:1}};
  const layout=await graphicGraphLayout(s,p,graphics,measure,arrange),request=measuredRoutingRequest(s,layout,p,graphics,{...context,packageFingerprint:graphics.fingerprint},measure);
  assert.deepEqual(request.endpoints.find(e=>e.id===s.nodes[0].id)?.box,{x:100,y:80,width:24,height:24});
  const path=routeGraph(request).paths[s.edges[0].id];assert.ok(path.sourceTerminal.x<=124&&path.sourceTerminal.y<=104);
});

test("unrelated edges avoid measured custom marker ink, with stable exact endpoints",()=>{
  const s=scene(),p=presentation();for(const n of s.nodes){n.title={parts:[]};n.subtitle={parts:[]};}
  for(const id of ["third","fourth"]){const node=structuredClone(s.nodes[0]);node.id=id;node.binding={...node.binding,key:id,context:[]};s.nodes.push(node);}
  const edge=s.edges[0];edge.label={parts:[]};edge.startMarker=null;
  s.edges.push({...structuredClone(edge),id:"other:edge",source:"third",target:"fourth",endMarker:null});
  const library:SymbolLibrary={schemaVersion:1,id:"marker",imports:[],definitions:[{id:"marker/large",version:"1",role:"marker",parameters:{},slots:{},connectionAnchor:"tip",root:{id:"ink",when:null,anchors:[{id:"tip",x:80,y:40,dx:1,dy:0}],content:{kind:"geometry",geometry:{kind:"rectangle",width:80,height:260,radius:0},fill:"#123456",stroke:"#234567",strokeWidth:1}}}]};
  edge.endMarker={definition:"marker/large",parameters:{},slots:{}};
  const graphics={fingerprint:"5".repeat(64),libraries:[library]},layout:Layout={revision:s.revision,viewKey:s.view.key,nodes:{[s.nodes[0].id]:{x:0,y:0,width:80,height:80},[s.nodes[1].id]:{x:400,y:0,width:80,height:80},third:{x:0,y:200,width:80,height:80},fourth:{x:600,y:200,width:80,height:80}},edges:{},ports:{},regions:{},minimum:{}};
  const before=routeGraph(measuredRoutingRequest(s,structuredClone(layout),p,graphics,{...context,packageFingerprint:graphics.fingerprint},measure));
  const actual=routeMeasuredLayout(s,structuredClone(layout),p,graphics,{...context,packageFingerprint:graphics.fingerprint},measure).routing!;
  assert.notDeepEqual(actual.paths["other:edge"].points,before.paths["other:edge"].points);
  const marker=edgeMarkerLayout(new GraphicDefinitions([library]),edge,"end",actual.paths[edge.id].points,measure)!;
  assert.deepEqual(marker.matrix,[1,0,-0,1,320,0]);
  const box={x:312,y:-8,width:96,height:276};for(const segment of actual.paths["other:edge"].segments)assert.equal(segmentIntersectsBox(segment.from,segment.to,box),false);
  assert.deepEqual(actual.paths[edge.id].targetTerminal,before.paths[edge.id].targetTerminal);
  s.edges.reverse();assert.deepEqual(routeMeasuredLayout(s,structuredClone(layout),p,graphics,{...context,packageFingerprint:graphics.fingerprint},measure).routing,actual);
});

test("reusing one text marker at both ends creates distinct movable authored frames",async()=>{
  const s=scene(),p=presentation(),edge=s.edges[0];
  edge.label=structuredClone(s.nodes[0].title);edge.label.parts[0].text="bound";
  const library:SymbolLibrary={schemaVersion:1,id:"textmarker",imports:[],definitions:[{id:"textmarker/caption",version:"1",role:"marker",parameters:{},slots:{caption:"text"},connectionAnchor:"tip",root:{id:"caption",when:null,anchors:[{id:"tip",x:0,y:0,dx:1,dy:0}],content:{kind:"text",slot:"caption",size:14,weight:400,italic:false,align:"start",wrap:false,color:"#123456"}}}]};
  edge.startMarker={definition:"textmarker/caption",parameters:{},slots:{caption:{kind:"label"}}};edge.endMarker=structuredClone(edge.startMarker);
  const graphics={fingerprint:"6".repeat(64),libraries:[library]},before=JSON.stringify(s),layout=await graphicGraphLayout(s,p,graphics,measure,arrange),first=routeMeasuredLayout(s,layout,p,graphics,{...context,packageFingerprint:graphics.fingerprint},measure).routing!;
  const frames=Object.entries(first.labelFrames).filter(([,frame])=>frame.owner===edge.id&&frame.kind==="owner");assert.equal(frames.length,2);assert.notEqual(frames[0][0],frames[1][0]);
  const [id,frame]=frames[0];p.views[s.view.key]={form:"graph",packageFingerprint:graphics.fingerprint,projection:s.ruleSet,routeConstraints:{},labelPlacements:{[id]:{kind:"owner",dx:11,dy:3}},positions:{},viewport:{x:0,y:0,zoom:1}};
  const next=routeMeasuredLayout(s,await graphicGraphLayout(s,p,graphics,measure,arrange),p,graphics,{...context,packageFingerprint:graphics.fingerprint},measure).routing!;
  assert.equal(next.labelFrames[id].box.x,frame.box.x+11);assert.equal(next.labelFrames[id].box.y,frame.box.y+3);
  assert.deepEqual(next.labelFrames[frames[1][0]],frames[1][1]);assert.deepEqual(next.paths[edge.id].sourceTerminal,first.paths[edge.id].sourceTerminal);assert.deepEqual(next.paths[edge.id].targetTerminal,first.paths[edge.id].targetTerminal);
  assert.equal(JSON.stringify(s),before);
});

test("blank bound edge captions retain their identities without becoming invisible obstacles",async()=>{
  const s=scene(),p=presentation(),graphics=builtinPresentation();
  const part=structuredClone(s.nodes[0].title.parts[0]);part.text="";
  s.edges[0].label={parts:[part]};
  s.edges.push({...structuredClone(s.edges[0]),id:"return:blank",source:s.edges[0].target,target:s.edges[0].source});
  const layout=await graphicGraphLayout(s,p,graphics,measure,arrange),routing=routeMeasuredLayout(s,layout,p,graphics,context,measure).routing!;
  assert.equal(Object.values(routing.labelFrames).filter(f=>f.kind==="route").length,2);
  assert.deepEqual(Object.keys(routing.paths).sort(),s.edges.map(e=>e.id).sort());
  assert.equal(s.edges[0].label.parts[0].binding,part.binding);
});

test("automatic bound captions clear measured bodies and every other logical path",async()=>{
  const s=scene(),p=presentation(),graphics=builtinPresentation();
  s.edges[0].label=structuredClone(s.nodes[0].title);s.edges[0].label.parts[0].text="a long trigger [guard] / effect";
  s.edges.push({...structuredClone(s.edges[0]),id:"return:caption",source:s.edges[0].target,target:s.edges[0].source});
  const layout=await graphicGraphLayout(s,p,graphics,measure,arrange),routing=routeMeasuredLayout(s,layout,p,graphics,context,measure).routing!;
  for(const frame of Object.values(routing.labelFrames).filter(f=>f.kind==="route")){
    const b={x:frame.box.x-s.routing.clearance,y:frame.box.y-s.routing.clearance,width:frame.box.width+2*s.routing.clearance,height:frame.box.height+2*s.routing.clearance};
    for(const path of Object.values(routing.paths))if(path.edgeId!==frame.owner)for(const segment of path.segments)assert.equal(segmentIntersectsBox(segment.from,segment.to,b),false);
    for(const node of Object.values(layout.nodes))assert.equal(b.x<node.x+node.width&&b.x+b.width>node.x&&b.y<node.y+node.height&&b.y+b.height>node.y,false);
  }
});
test("routing is derived from final saved node geometry rather than placement edges",async()=>{
  const s=scene(),p=presentation(),graphics=builtinPresentation();
  const initial=await graphicGraphLayout(s,p,graphics,measure,arrange);
  const a=routeMeasuredLayout(s,initial,p,graphics,context,measure).routing!;
  p.views[s.view.key]={form:"graph",packageFingerprint:graphics.fingerprint,projection:s.ruleSet,routeConstraints:{},labelPlacements:{},symbolOverrides:{},positions:{[s.nodes[1].id]:{x:800,y:340,width:360,height:120}},viewport:{x:0,y:0,zoom:1}};
  const next=await graphicGraphLayout(s,p,graphics,measure,arrange),b=routeMeasuredLayout(s,next,p,graphics,{...context,generation:5},measure).routing!;
  assert.notDeepEqual(a.paths[s.edges[0].id].targetTerminal,b.paths[s.edges[0].id].targetTerminal);
  const end=b.paths[s.edges[0].id].targetTerminal;assert.ok(end.x>=800&&end.x<=1160&&end.y>=340);
});

test("flat projection keeps the logical ancestor frame without inventing boundary gates",async()=>{
  const s=scene(),parent=structuredClone(s.nodes[0]);parent.id="flat:parent";parent.binding.key="source:parent";parent.binding.context=[];parent.title={parts:[]};parent.subtitle={parts:[]};parent.graphic=null;
  for(const node of s.nodes){node.binding.context=[parent.binding.key];node.title={parts:[]};node.subtitle={parts:[]};node.graphic=null;}
  s.nodes.push(parent);
  const p=presentation(),graphics=builtinPresentation(),layout=await graphicGraphLayout(s,p,graphics,measure,arrange);
  const request=measuredRoutingRequest(s,layout,p,graphics,context,measure),first=routeGraph(request).paths[s.edges[0].id];
  assert.equal(first.frame,parent.id);assert.deepEqual(first.gates,[]);
  const origin=request.frames[parent.id],world={x:700,y:350},local={x:world.x-origin.x,y:world.y-origin.y};
  request.constraints[s.edges[0].id]={frame:parent.id,waypoints:[local]};
  assert.ok(routeGraph(request).paths[s.edges[0].id].points.some(p=>p.x===world.x&&p.y===world.y));
  request.frames[parent.id]={x:origin.x+100,y:origin.y+100};
  assert.ok(routeGraph(request).paths[s.edges[0].id].points.some(p=>p.x===world.x+100&&p.y===world.y+100));
  assert.deepEqual(request.constraints[s.edges[0].id].waypoints,[local]);
});
test("measured authored port reuse keeps its transformed normal and logical endpoint ID",async()=>{
  const s=scene(),lib=load("../../../harness/views/symbols/classic.symbols.json"),port=lib.definitions.find((d:any)=>d.role==="port");
  port.root=port.root.content.children[0];port.slots={};
  lib.definitions.push({id:"harness.symbols/routedPort",version:"1",role:"port",parameters:{},slots:{},connectionAnchor:"nested/tip",root:{id:"nested",when:null,anchors:[],content:{kind:"use",definition:port.id,parameters:{angle:{kind:"constant",value:45}},slots:{}}}});
  const p=presentation(),graphics={fingerprint:"1".repeat(64),libraries:[lib]},node=s.nodes[0];
  node.ports=[{id:"port:actual",rule:"pin",label:{parts:[]},side:"EAST",binding:node.binding,text:{},graphic:{definition:"harness.symbols/routedPort",parameters:{},slots:{}}}];s.edges[0].source="port:actual";
  const layout=await graphicGraphLayout(s,p,graphics,measure,arrange),request=measuredRoutingRequest(s,layout,p,graphics,{...context,packageFingerprint:graphics.fingerprint},measure),terminal=request.endpoints.find(e=>e.id==="port:actual")!;
  assert.ok(Math.abs(terminal.normal.x-terminal.normal.y)<1e-8);assert.equal(request.edges[0].source,"port:actual");
  const points=routeGraph(request).paths[s.edges[0].id].points;
  assert.deepEqual(points[0],terminal.point);assert.ok(Math.abs(points[1].x-points[0].x-(points[1].y-points[0].y))<1e-8);

  p.views[s.view.key] = {
    form: "graph",
    packageFingerprint: graphics.fingerprint,
    projection: s.ruleSet,
    routeConstraints: {},
    labelPlacements: {},
    positions: {
      "port:actual": { x: 0, y: layout.nodes[node.id].height / 2, width: 12, height: 12 },
    },
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const moved = measuredRoutingRequest(
    s, layout, p, graphics, { ...context, packageFingerprint: graphics.fingerprint }, measure,
  );
  const movedTerminal = moved.endpoints.find(e => e.id === "port:actual")!;
  const movedPath = routeGraph(moved).paths[s.edges[0].id].points;
  assert.deepEqual(movedTerminal.normal, { x: -1, y: 0 });
  assert.deepEqual(movedPath[0], movedTerminal.point);
  assert.equal(movedPath[1].y, movedPath[0].y);
  assert.ok(movedPath[1].x < movedPath[0].x);
});
