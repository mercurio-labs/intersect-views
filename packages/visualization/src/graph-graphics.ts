import {authoredPropertyKeys} from "./symbol-properties-contract.ts";
/** Generic bound-content adapter. Semantic selection stays in the shared host. */
import { GraphicDefinitions, type GraphicInstance, type PresentationContext } from "./graphics-contract.ts";
import { layoutGraphic,measureBlock, type BoundGraphicContent, type MeasureText, type GraphicDrawing,type Matrix } from "./graphics-layout.ts";
import type { Node, Port, Edge, Geometry, Layout, GraphScene, Presentation, Binding, Label, TextBlock, Point } from "./protocol.ts";
import { graphPresentation, labelText } from "./protocol.ts";
import { own } from "./records.ts";
import type { LabelPlacement } from "./routing-contract.ts";
import { logicalId } from "./logical-id.ts";

/** Conservative bounds for the closed legacy SVG marker adapter (stroke 1.4). */
export function legacyMarkerLayout(points:Point[],side:"start"|"end"){
  const at=side==="start"?points[0]:points.at(-1)!,other=side==="start"?points[1]:points.at(-2)!,angle=Math.atan2(at.y-other.y,at.x-other.x),cos=Math.cos(angle),sin=Math.sin(angle);
  return {matrix:[cos,sin,-sin,cos,at.x,at.y] as Matrix,box:{x:-24,y:-12,width:26,height:24}};
}

/** The same measured marker transform is used by routing, text hits and paint. */
export function edgeMarkerLayout(definitions:GraphicDefinitions,edge:Edge,side:"start"|"end",points:Point[],measure:MeasureText,placements:Record<string,LabelPlacement>={}){
  const instance=edge[side==="start"?"startMarker":"endMarker"];if(!instance)return undefined;
  if(points.length<2)throw Error("Marker needs a complete routed path");
  const drawing=drawGraphic(definitions,instance,edge,16,measure,{},undefined,placements,`edge.${side}Marker`),definition=definitions.definition(instance.definition);
  const anchor=definition.connectionAnchor?drawing.anchors[definition.connectionAnchor]:{x:0,y:0,dx:1,dy:0};
  const at=side==="start"?points[0]:points.at(-1)!,other=side==="start"?points[1]:points.at(-2)!;
  const angle=Math.atan2(side==="start"?other.y-at.y:at.y-other.y,side==="start"?other.x-at.x:at.x-other.x)-Math.atan2(anchor.dy,anchor.dx),cos=Math.cos(angle),sin=Math.sin(angle);
  const matrix:Matrix=[cos,sin,-sin,cos,at.x-cos*anchor.x+sin*anchor.y,at.y-sin*anchor.x-cos*anchor.y];
  return {drawing,matrix,endpoint:side==="start"?edge.source:edge.target};
}

/** Wrap one complete logical edge label; never persist its visual fragments. */
export function edgeLabelLayout(edge:Pick<Edge,"id"|"binding"|"label">,measure:MeasureText){
  const id=logicalId("label",[edge.id,"edge.label"]),width=Math.max(6,Math.min(320,measure(labelText(edge.label),14,600,false)));
  return measureBlock({kind:"text",owner:edge.id,binding:edge.binding,slot:"edge.label",block:{runs:[{id,parts:edge.label.parts}]}},width,{size:14,weight:600,italic:false,align:"start",wrap:true,color:"#65718a"},measure);
}

export function drawGraphic(definitions: GraphicDefinitions, instance: GraphicInstance, owner: Node | Port | Edge, width: number | undefined, measure: MeasureText, boxes: Record<string, { width: number; height: number }> = {}, allocatedHeight?: number, placements:Record<string,LabelPlacement>={},instancePath?:string): GraphicDrawing {
  const contents: Record<string, BoundGraphicContent> = Object.create(null);
  for (const [name, source] of Object.entries(instance.slots)) {
    if (source.kind === "compartments") {
      if (!("compartments" in owner)) throw Error("Compartment content needs node");
      contents[name] = { kind: "compartments", owner: owner.id, binding: owner.binding, items: owner.compartments };
    } else if (source.kind === "children" || source.kind === "regions") {
      contents[name] = { kind: "box", ...(own(boxes, source.kind) ?? { width: 0, height: 0 }) };
    } else {
      let block: TextBlock;
      if (source.kind === "text") {
        const b = own(owner.text, source.name); if (!b) throw Error("Missing evaluated block"); block = b;
      } else {
        const label = source.kind === "title" && "title" in owner ? owner.title : source.kind === "subtitle" && "subtitle" in owner ? owner.subtitle : "label" in owner ? owner.label : undefined;
        if (!label) throw Error("Invalid evaluated content role");
        block = { runs: [{ id: `${owner.id}:${source.kind}`, parts: label.parts }] };
      }
      contents[name] = { kind: "text", block, owner: owner.id, binding: owner.binding, slot: source.kind === "text" ? source.name : `${"title" in owner ? "node" : "source" in owner ? "edge" : "port"}.${source.kind}` };
    }
  }
  let keys:Set<string>|undefined;
  if(Object.hasOwn(definitions.propertyOverrides,owner.id)&&"source"in owner){keys=new Set<string>();for(const side of ["start","end"] as const){const marker=owner[side==="start"?"startMarker":"endMarker"];if(marker)for(const key of authoredPropertyKeys(definitions,marker.definition,`edge.${side}Marker`))keys.add(key);}}
  try { return layoutGraphic(definitions, instance, owner.id, contents, width, measure,allocatedHeight,placements,instancePath,keys); }
  catch(error) { throw Error(`Graphic ${instance.definition}, occurrence ${owner.id}: ${error instanceof Error ? error.message : String(error)}`); }
}
export function contentBoxes(node: Node, layout: Layout): Record<string, { width: number; height: number }> {
  const extent = (ids: string[], map: Record<string, Geometry>) => ({ width: Math.max(0, ...ids.map((id) => (own(map, id)?.x ?? 0) + (own(map, id)?.width ?? 0))), height: Math.max(0, ...ids.map((id) => (own(map, id)?.y ?? 0) + (own(map, id)?.height ?? 0))) });
  // Child geometries are local to the node; take the packed size independently
  // of their current content-slot origin, which changes with text reflow.
  const packed = (ids: string[], map: Record<string, Geometry>,outsets=layout.outsets) => {
    if (!ids.length) return { width: 0, height: 0 };
    const e = {width:Math.max(...ids.map(id=>(own(map,id)?.x??0)+(own(map,id)?.width??0)+(own(outsets,id)?.right??0))),height:Math.max(...ids.map(id=>(own(map,id)?.y??0)+(own(map,id)?.height??0)+(own(outsets,id)?.bottom??0)))}, x = Math.min(...ids.map((id) => (own(map, id)?.x ?? 0)-(own(outsets,id)?.left??0))), y = Math.min(...ids.map((id) => (own(map, id)?.y ?? 0)-(own(outsets,id)?.top??0)));
    return { width: e.width - x, height: e.height - y };
  };
  return { children: packed(node.children.map((c) => c.id), layout.nodes), regions: packed((node.regions?.items ?? []).map((r) => r.id), layout.regions,{}) };
}
export const hasGraphics = (nodes: Node[]): boolean => nodes.some((n) => n.graphic !== null || n.ports.some((p) => p.graphic !== null) || hasGraphics(n.children) || (n.regions?.items.some((r) => hasGraphics(r.children)) ?? false));

/** Keep existing allocations authoritative when source edits add an unsaved sibling. */
export function separateUnsaved(nodes:{id:string}[],positions:Record<string,Geometry>,saved:Record<string,import("./protocol.ts").SavedPosition>,gap:number){
  const occupied=nodes.filter(n=>own(saved,n.id)).map(n=>positions[n.id]);
  for(const n of [...nodes].filter(n=>!own(saved,n.id)).sort((a,b)=>a.id<b.id?-1:1)){
    const g=positions[n.id];if(occupied.some(b=>g.x<b.x+b.width+gap&&g.x+g.width+gap>b.x&&g.y<b.y+b.height+gap&&g.y+g.height+gap>b.y))g.y=Math.max(...occupied.map(b=>b.y+b.height+gap));
    occupied.push(g);
  }
}

/** Composition dimensions are measured before arranging siblings. No semantic queries. */
export async function graphicGraphLayout(scene: GraphScene, presentation: Presentation, context: PresentationContext, measure: MeasureText, arrange: (nodes: { id: string; width: number; height: number }[], edges: Edge[]) => Promise<{ id: string; x?: number; y?: number }[]>): Promise<Layout> {
  const definitions = new GraphicDefinitions(context.libraries,graphPresentation(presentation,scene.view.key)?.symbolOverrides), saved = graphPresentation(presentation, scene.view.key)?.positions ?? {};
  const result: Layout = { revision: scene.revision, viewKey: scene.view.key, nodes: Object.create(null), ports: Object.create(null), edges: Object.create(null), regions: Object.create(null), minimum: Object.create(null) };
  const outsets:NonNullable<Layout["outsets"]>=Object.create(null);result.outsets=outsets;
  const padding=scene.routing.stubLength+scene.routing.clearance+8;
  const place = async (nodes: Node[]) => {
    for (const node of nodes) await size(node);
    const siblings = new Set(nodes.map((n) => n.id));
    // Only immediate node endpoints constrain this composition level. Ports and
    // cross-container edges retain the existing endpoint/routing treatment.
    const edges = scene.edges.filter((e) => siblings.has(e.source) && siblings.has(e.target));
    const positions = await arrange(nodes.map((n) => ({ id: n.id, width:result.nodes[n.id].width+outsets[n.id].left+outsets[n.id].right,height:result.nodes[n.id].height+outsets[n.id].top+outsets[n.id].bottom })), edges);
    for (const p of positions) {
      const g = result.nodes[p.id], old = own(saved, p.id); g.x = old?.x ?? (p.x??0)+outsets[p.id].left; g.y = old?.y ?? (p.y??0)+outsets[p.id].top;
    }
    if(nodes.some(n=>own(saved,n.id)))separateUnsaved(nodes,result.nodes,saved,padding*2);
  };
  const size = async (n: Node): Promise<void> => {
    await place(n.children);
    for (const r of n.regions?.items ?? []) {
      await place(r.children);
      const cs = r.children.map((c) => ({g:result.nodes[c.id],o:outsets[c.id]}));
      result.regions[r.id] = { x: 0, y: 0, width: Math.max(205, measure(labelText(r.label), 14, 600, false) + 28, ...cs.map(({g,o}) => g.x + g.width + o.right + padding*2)), height: Math.max(70, ...cs.map(({g,o}) => g.y + g.height + o.bottom + padding*2+30)) };
      for (const {g} of cs) { g.x += padding; g.y += 30+padding; }
    }
    let rx = 0, ry = 0;
    for (const r of n.regions?.items ?? []) { const g = result.regions[r.id]; g.x = rx; g.y = ry; if (n.regions?.direction === "row") rx += g.width + 12; else ry += g.height + 12; }
    const boxes = contentBoxes(n, result), old = own(saved, n.id);
    let width = Math.max(240, old?.width ?? 360, boxes.children.width + 32, boxes.regions.width + 32), height: number;
    if (n.graphic) {
      const authored=definitions.definition(n.graphic.definition).size;
      const drawing = drawGraphic(definitions, n.graphic, n, authored && !old?.width ? undefined : width, measure, boxes);
      width = drawing.width; height = drawing.height;
      for (const [slot, source] of Object.entries(n.graphic.slots)) {
        const at = own(drawing.content, slot);
        if(!at && ((source.kind==="children"&&n.children.length)||(source.kind==="regions"&&n.regions?.items.length)))throw Error(`Graphic ${n.graphic.definition} hides visible ${source.kind}`);
        if (!at) continue;
        if (source.kind === "children") {
          const minX = n.children.length ? Math.min(...n.children.map((c) => result.nodes[c.id].x-outsets[c.id].left)) : 0, minY = n.children.length ? Math.min(...n.children.map((c) => result.nodes[c.id].y-outsets[c.id].top)) : 0;
          for (const c of n.children) { result.nodes[c.id].x += at.x - minX; result.nodes[c.id].y += at.y - minY; }
        } else if (source.kind === "regions") for (const r of n.regions?.items ?? []) { result.regions[r.id].x += at.x; result.regions[r.id].y += at.y; }
      }
    } else {
      const rows = n.compartments.reduce((sum, c) => sum + 20 + c.rows.length * 20, 0);
      height = 64 + rows + Math.max(boxes.children.height, boxes.regions.height) + 38;
      for (const c of n.children) { result.nodes[c.id].x += 20; result.nodes[c.id].y += 64 + rows; }
      for (const r of n.regions?.items ?? []) { result.regions[r.id].x += 20; result.regions[r.id].y += 64 + rows; }
    }
    result.minimum[n.id] = { width:n.graphic && definitions.definition(n.graphic.definition).size ? drawGraphic(definitions,n.graphic,n,1,measure,boxes).width : Math.min(width,Math.max(240, boxes.children.width + 32, boxes.regions.width + 32)), height };
    if(n.graphic&&definitions.definition(n.graphic.definition).properties?.length){
      const min=drawGraphic(definitions,n.graphic,n,width,measure,boxes,1),preferred=drawGraphic(definitions,n.graphic,n,undefined,measure,boxes);
      result.minimum[n.id].height=min.height;(result.preferred??={})[n.id]={width:preferred.width,height:preferred.height};
    }
    result.nodes[n.id] = { x: 0, y: 0, width, height: Math.max(1, height, old?.height ?? 0) };
    const body=result.nodes[n.id],o={left:0,top:0,right:0,bottom:0};outsets[n.id]=o;
    // An ordinary box endpoint can attach on any free face. Reserve its lead
    // before the parent's authored content slot packs it against a boundary.
    const endpointIds=new Set([n.id,...n.ports.map(p=>p.id)]),selfCounts=new Map<string,number>();
    const nodeEndpoint=scene.edges.some(e=>e.source===n.id||e.target===n.id);
    for(const edge of scene.edges)if(edge.source===edge.target&&endpointIds.has(edge.source))selfCounts.set(edge.source,(selfCounts.get(edge.source)??0)+1);
    const selfCount=Math.max(0,...selfCounts.values());
    const parallelCounts=new Map<string,number>();
    for(const edge of scene.edges)if(endpointIds.has(edge.source)||endpointIds.has(edge.target)){const pair=JSON.stringify([edge.source,edge.target]);parallelCounts.set(pair,(parallelCounts.get(pair)??0)+1);}
    const lanes=Math.max(0,...parallelCounts.values());
    const reserve=selfCount?scene.routing.stubLength+scene.routing.clearance*2+12+(selfCount-1)*8:nodeEndpoint?scene.routing.stubLength+scene.routing.clearance+Math.max(0,lanes-1)*8:0;
    if(reserve)o.left=o.top=o.right=o.bottom=reserve;
    const include=(x:number,y:number,w:number,h:number)=>{o.left=Math.max(o.left,-x+scene.routing.clearance);o.top=Math.max(o.top,-y+scene.routing.clearance);o.right=Math.max(o.right,x+w-body.width+scene.routing.clearance);o.bottom=Math.max(o.bottom,y+h-body.height+scene.routing.clearance);};
    // Packing reserves authored defaults. Movable text affects routing/fit,
    // without shifting its owner or the owner's fixed port geometry.
    if(n.graphic){const drawing=drawGraphic(definitions,n.graphic,n,body.width,measure,boxes,body.height);for(const f of drawing.fragments)include(f.rect.x,f.rect.y,f.rect.width,f.rect.height);if(drawing.propertyTargets.length)for(const ink of drawing.geometry)include(ink.x,ink.y,ink.width,ink.height);}
    for(const side of ["NORTH","SOUTH","WEST","EAST"]){const ps=n.ports.filter(p=>p.side===side);ps.forEach((p,i)=>{
      const t=(i+1)/(ps.length+1),point={x:side==="WEST"?0:side==="EAST"?body.width:body.width*t,y:side==="NORTH"?0:side==="SOUTH"?body.height:body.height*t};
      if(p.graphic){const d=drawGraphic(definitions,p.graphic,p,16,measure),definition=definitions.definition(p.graphic.definition),a=definition.connectionAnchor?d.anchors[definition.connectionAnchor]:{x:d.width/2,y:d.height/2,dx:1,dy:0};include(point.x-a.x+d.left,point.y-a.y+d.top,d.width,d.height);const magnitude=Math.hypot(a.dx,a.dy);include(point.x+a.dx/magnitude*scene.routing.stubLength,point.y+a.dy/magnitude*scene.routing.stubLength,1,1);}
      else {include(point.x-6,point.y-6,12,12);const text=labelText(p.label),w=measure(text,14,600,false);include(point.x+(side==="WEST"?12:-12-text.length*8),point.y-24,w,20);}
    });}
  };
  await place(scene.nodes);
  const ports = (nodes: Node[], x: number, y: number) => {
    for (const n of nodes) {
      const g = result.nodes[n.id], a = { x: x + g.x, y: y + g.y };
      for (const side of ["NORTH", "SOUTH", "WEST", "EAST"]) {
        const ps = n.ports.filter((p) => p.side === side);
        ps.forEach((p, i) => { const t = (i + 1) / (ps.length + 1); result.ports[p.id] = { x: a.x + (side === "WEST" ? 0 : side === "EAST" ? g.width : g.width * t), y: a.y + (side === "NORTH" ? 0 : side === "SOUTH" ? g.height : g.height * t) }; });
      }
      ports(n.children, a.x, a.y);
      for (const r of n.regions?.items ?? []) { const b = result.regions[r.id]; ports(r.children, a.x + b.x, a.y + b.y); }
    }
  }; ports(scene.nodes, 0, 0);
  for (const g of [...Object.values(result.nodes), ...Object.values(result.regions)]) if (![g.x,g.y,g.width,g.height].every((v) => Number.isFinite(v) && Math.abs(v) <= 1_000_000)) throw Error("Graphical layout extent exceeded");
  return result;
}
