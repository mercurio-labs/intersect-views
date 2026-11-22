import {ViewCanvas} from "../../packages/visualization/src/view-canvas.ts";
import {WorkerHost} from "../../packages/visualization/src/worker-host.ts";
import {sha256,PRESENTATION_CAPABILITIES,type PresentationInput} from "../../packages/visualization/src/presentation-package.ts";
import type {SceneResponse,View,Scope,ScopeOp,Presentation,Binding} from "../../packages/visualization/src/protocol.ts";
import Worker from "./host.worker?worker";
import {defaultNotation} from "../../packages/visualization/src/protocol.ts";
import markerDefinition from "../views/symbols/marker-caption.definition.json?raw";
import markerSource from "../models/symbols.harness?raw";
import treeSource from "../models/structure.harness?raw";
import regionSource from "../models/m14-regions.harness?raw";
import nestedLibrary from "../views/symbols/containers.symbols.json?raw";
import treeLibrary from "../views/symbols/classic.symbols.json?raw";
import nestedRules from "../views/symbols/containers.viewrules.json?raw";
import palette from "../views/symbols/symbols.palette.json?raw";
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const projection=$<HTMLSelectElement>("projection"),layouts:Record<string,Presentation>=JSON.parse(localStorage.getItem("intersect.m14.routing")??"{}");
let generation=0,active:{host:WorkerHost;canvas:ViewCanvas;root:HTMLElement;scene:SceneResponse;scope:Scope;view:View;kind:string;presentation:Presentation;source:string}|undefined;
const status=(value:unknown)=>{$("status").textContent=String(value);};
function selected(binding:Binding,reveal:boolean){
  $("binding").textContent=JSON.stringify(binding,null,2);
  if(reveal&&binding.uri==="structure.harness"){
    const source=active!.source;
    const area=$<HTMLTextAreaElement>("source"),at=(p:{line:number;character:number})=>source.split("\n").slice(0,p.line).reduce((sum,line)=>sum+line.length+1,0)+p.character;
    area.focus();area.setSelectionRange(at(binding.range.start),at(binding.range.end));
  }
}
async function load(){
  const ticket=++generation,kind=projection.value,source=kind==="tree"?treeSource:kind==="markers"?markerSource:regionSource,host=new WorkerHost(new Worker());let candidate:typeof active;
  status(`Preparing ${kind} projection…`);
  try {
    const initialized=await host.request<{language:{namespace:string;fingerprint:string}}>("initialize",{protocolVersion:2});
    const library=JSON.parse(kind==="tree"?treeLibrary:nestedLibrary),rules=JSON.parse(nestedRules);
    rules.id="m14.routing";rules.symbols[0].children={select:"boxParts"};
    if(kind==="tree"){
      delete rules.symbols[0].regions;
      rules.projection={kind:"containmentTree",edgeRole:"children",edgeNotation:"containment"};rules.routing.trunks="siblings";
      delete rules.symbols[0].graphic.slots.children;delete rules.symbols[0].graphic.slots.regions;
    }
    if(kind==="markers"){
      library.definitions.push(JSON.parse(markerDefinition));
      for(const edge of rules.edges){const marker={definition:"example.containers/captionMarker",parameters:{},slots:{caption:{kind:"label"}},text:{}};edge.startMarker=structuredClone(marker);edge.endMarker=marker;}
    }
    for(const definition of library.definitions)if(definition.role==="port"&&definition.parameters.angle)definition.parameters.angle.default=45;
    for(const symbol of rules.symbols)if(symbol.graphic)symbol.graphic.definition=symbol.graphic.definition.replace("harness.symbols/",`${library.id}/`);
    for(const edge of rules.edges)for(const marker of [edge.startMarker,edge.endMarker])if(marker)marker.definition=marker.definition.replace("harness.symbols/",`${library.id}/`);
    const candidatePalette=JSON.parse(palette);candidatePalette.groups[0].entries.push({id:"layout",label:"Arrange",icon:"layout",gesture:"action",command:"presentation.layout",parameters:{},inputs:[]});
    const resources=[{id:"symbols",content:JSON.stringify(library)},{id:"rules",content:JSON.stringify(rules)},{id:"palette",content:JSON.stringify(candidatePalette)}];
    const input:PresentationInput={root:"m14.routing@1",manifests:[{schemaVersion:1,id:"m14.routing",version:"1",language:initialized.language.namespace,languageFingerprint:initialized.language.fingerprint,requires:PRESENTATION_CAPABILITIES,dependencies:[],resources:await Promise.all(resources.map(async(r,i)=>({id:r.id,kind:(["symbolLibrary","ruleSet","palette"] as const)[i],sha256:await sha256(r.content)})))}],resources};
    await host.request("views/preparePresentation",input);
    const document={schemaVersion:1,key:"m14.routing",name:"M14 structural routing",ruleSet:rules.id,scope:{schemaVersion:1,ops:[]}};
    const analyzed=await host.request<{clean:boolean;diagnostics:unknown[]}>("workspace/analyze",{revision:1,sources:[{uri:"structure.harness",text:source},{uri:"routing.view.json",text:JSON.stringify(document)}]});
    if(!analyzed.clean)throw Error(JSON.stringify(analyzed.diagnostics));
    const catalog=await host.request<{views:View[]}>("views/catalog",{revision:1}),view=catalog.views.find(v=>v.key===document.key);if(!view)throw Error("Missing actual native view");
    const owner=view.owners.find(o=>o.label==="Alpha");if(!owner)throw Error("Missing actual native root");
    const scope:Scope={schemaVersion:1,ops:kind==="markers"?catalog.views.find(v=>v.key===document.key)!.owners.filter(o=>o.label==="Alpha"||o.label==="Beta").map(o=>({op:"addSeed",element:o.key})):[{op:"addSeed",element:owner.key}]};
    const scene=await host.request<SceneResponse>("views/scene",{revision:1,viewKey:view.key,scope}),root=documentNode(),presentation=layouts[kind]??{schemaVersion:4,views:{}};
    const canvas=new ViewCanvas(root,{view(){},select:selected,async command(){throw Error("This qualification fixture has no semantic editing provider");},presentation(value){if(active?.canvas===canvas){active.presentation=value;layouts[kind]=value;localStorage.setItem("intersect.m14.routing",JSON.stringify(layouts));}},save(){localStorage.setItem("intersect.m14.routing",JSON.stringify(layouts));},palette(){},undo(){status("Source undo is independent of placement undo");},scope(op){void explore(op);}});
    candidate={host,canvas,root,scene,scope,view,kind,presentation,source};if(kind==="tree")canvas.setNotation({...defaultNotation,edges:{containment:{line:"solid",stroke:"neutral",startMarker:"triangle",endMarker:"none"}}});canvas.setPresentation(presentation);canvas.views(catalog.views,view.key);canvas.setScene(scene);
    root.style.visibility="hidden";root.style.position="absolute";root.style.inset="0";$("canvas").append(root);await canvas.whenReady();
    if(ticket!==generation)throw Error("Projection superseded");
    active?.canvas.destroy();active?.host.destroy();active=candidate;candidate=undefined;root.style.visibility="";root.style.position="";root.style.inset="";$("canvas").replaceChildren(root);$("source").textContent=source;status(`Accepted ${kind} projection`);
  }catch(error){candidate?.canvas.destroy();candidate?.root.remove();host.destroy();if(ticket===generation)status(`Projection refused: ${String(error)}`);}
}
function documentNode(){const root=document.createElement("div");root.style.height="100%";return root;}
async function explore(op:ScopeOp){
  const current=active;if(!current)return;current.scope.ops.push(op);
  try {const scene=await current.host.request<SceneResponse>("views/scene",{revision:1,viewKey:current.view.key,scope:current.scope});if(active!==current)return;current.canvas.setScene(scene);await current.canvas.whenReady();current.scene=scene;status(`Accepted ${current.kind} projection`);}catch(error){status(`Projection refused: ${String(error)}`);}
}
projection.onchange=()=>void load();
$("collapse").onclick=()=>{const current=active;if(!current||current.scene.scene.form!=="graph")return;const all=current.scene.scene.nodes,child=all.flatMap(n=>n.children.concat(n.regions?.items.flatMap(r=>r.children)??[])).find(n=>n.children.length||n.ports.length)||all.find(n=>n.binding.context.length&&n.ports.length);if(child)void explore({op:"collapse",element:child.binding.key,context:child.binding.context});};
$("expand").onclick=()=>{if(active){active.scope.ops=active.scope.ops.filter(op=>op.op!=="collapse");void explore({op:"addSeed",element:active.view.owners.find(o=>o.label==="Alpha")!.key});}};
$("reset-layout").onclick=()=>{if(active){delete layouts[active.kind];localStorage.setItem("intersect.m14.routing",JSON.stringify(layouts));void load();}};
Object.assign(window,{m14:{get active(){return active;},load}});void load();
