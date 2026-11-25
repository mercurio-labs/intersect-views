/** Translate measured compositions into the worker's routing DTO. No model queries. */
import type { GraphScene, Layout, Presentation, Geometry, Point, Node, Binding } from "./protocol.ts";
import { graphPresentation,labelText,defaultNotation } from "./protocol.ts";
import { GraphicDefinitions, type PresentationContext } from "./graphics-contract.ts";
import { drawGraphic, contentBoxes,edgeLabelLayout,edgeMarkerLayout,legacyMarkerLayout,portPlacement } from "./graph-graphics.ts";
import { compose,transformRect,type MeasureText,type GraphicDrawing } from "./graphics-layout.ts";
import { ROOT_ROUTE_FRAME } from "./routing-contract.ts";
import { routeGraph, routeFrame, segmentIntersectsBox, RoutingFailure, type RoutingRequest, type RouteContext, type RoutedLabelFrame,type RouteObstacle,type RouteDegradation } from "./routing.ts";
import type {NotationProfile} from "./notation.ts";
import { own } from "./records.ts";
import { logicalId } from "./logical-id.ts";

const overlaps=(a:Geometry,b:Geometry)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;

function border(at:Point,b:Geometry):Point&{normal:Point} {
  const candidates=[{x:b.x,y:Math.max(b.y,Math.min(b.y+b.height,at.y)),normal:{x:-1,y:0}},
    {x:b.x+b.width,y:Math.max(b.y,Math.min(b.y+b.height,at.y)),normal:{x:1,y:0}},
    {x:Math.max(b.x,Math.min(b.x+b.width,at.x)),y:b.y,normal:{x:0,y:-1}},
    {x:Math.max(b.x,Math.min(b.x+b.width,at.x)),y:b.y+b.height,normal:{x:0,y:1}}];
  return candidates.reduce((a,p)=>Math.hypot(at.x-p.x,at.y-p.y)<Math.hypot(at.x-a.x,at.y-a.y)?p:a);
}
export function measuredRoutingRequest(scene:GraphScene,layout:Layout,presentation:Presentation,graphics:PresentationContext,context:RouteContext,measure:MeasureText,labelFrames:Record<string,RoutedLabelFrame>=Object.create(null)):RoutingRequest {
  const request:RoutingRequest={schemaVersion:1,context,policy:scene.routing,endpoints:[],obstacles:[],edges:scene.edges.map(e=>({id:e.id,source:e.source,target:e.target,branchGroup:e.branchGroup,styleKey:logicalId("routeStyle",[e.notation,e.styleClass,e.startMarker??null,e.endMarker??null])})),frames:Object.assign(Object.create(null),{[ROOT_ROUTE_FRAME]:{x:0,y:0}}),constraints:{}};
  const definitions=new GraphicDefinitions(graphics.libraries,graphPresentation(presentation,scene.view.key)?.symbolOverrides),saved=graphPresentation(presentation,scene.view.key),absolute=new Map<string,Geometry>(),chains=new Map<string,string[]>();
  const placements=saved?.labelPlacements??{};
  const addDrawing=(drawing:GraphicDrawing,at:Point,owner:string)=>{
    // Bound text is measured by the exact same composition implementation as paint.
    drawing.fragments.forEach((f,i)=>{if(f.text.trim()&&f.rect.width>0&&f.rect.height>0)request.obstacles.push({id:`text:${owner}:${i}`,kind:"solid",box:{...f.rect,x:at.x+f.rect.x,y:at.y+f.rect.y}});});
    for(const [id,label]of Object.entries(drawing.labels)){
      if(Object.hasOwn(labelFrames,id))throw Error("Duplicate measured label identity");
      labelFrames[id]={owner,kind:"owner",box:{...label.rect,x:at.x+label.rect.x,y:at.y+label.rect.y},frame:[...label.frame.slice(0,4),label.frame[4]+at.x,label.frame[5]+at.y] as RoutedLabelFrame["frame"]};
    }
  };
  const builtinLabel=(owner:string,slot:string,text:string,at:Point,center=false)=>{
    if(!text)return;
    const id=logicalId("label",[owner,slot]),placement=own(placements,id);
    if(placement&&placement.kind!=="owner")throw new RoutingFailure("routing.label.wrongFrame",[],[id]);
    const width=Math.max(6,measure(text,14,600,false)),x=at.x+(placement?.dx??0)-(center?width/2:0),y=at.y+(placement?.dy??0)-14;
    const box={x,y,width,height:20};labelFrames[id]={owner,kind:"owner",box,frame:[1,0,0,1,at.x,at.y]};request.obstacles.push({id,kind:"solid",box});
  };
  const visit=(nodes:Node[],at:Point,ancestors:string[])=>{
    for(const n of nodes){
      const g=own(layout.nodes,n.id);if(!g)throw Error("Missing measured node geometry");
      const b={...g,x:at.x+g.x,y:at.y+g.y},containers=[n.id,...ancestors];absolute.set(n.id,b);chains.set(n.id,ancestors);request.frames[n.id]={x:b.x,y:b.y};
      const drawing=n.graphic?drawGraphic(definitions,n.graphic,n,g.width,measure,contentBoxes(n,layout),g.height,placements):undefined;
      const body=drawing?.geometry.length?{x:b.x+Math.min(...drawing.geometry.map(g=>g.x)),y:b.y+Math.min(...drawing.geometry.map(g=>g.y)),width:Math.max(...drawing.geometry.map(g=>g.x+g.width))-Math.min(...drawing.geometry.map(g=>g.x)),height:Math.max(...drawing.geometry.map(g=>g.y+g.height))-Math.min(...drawing.geometry.map(g=>g.y))}:b;
      request.obstacles.push({id:n.id,kind:n.children.length||n.regions?.items.length||n.collapsed?"boundary":"solid",box:body});
      const definition=n.graphic?definitions.definition(n.graphic.definition):undefined;
      const anchor=definition?.connectionAnchor?drawing?.anchors[definition.connectionAnchor]:undefined;
      request.endpoints.push({id:n.id,owner:n.id,point:anchor?{x:b.x+anchor.x,y:b.y+anchor.y}:{x:body.x+body.width/2,y:body.y+body.height/2},normal:anchor?{x:anchor.dx,y:anchor.dy}:{x:1,y:0},box:anchor?null:body,ancestors});
      if(drawing)addDrawing(drawing,b,n.id);
      else if(n.children.length||n.regions?.items.length)request.obstacles.push({id:`header:${n.id}`,kind:"solid",box:{x:b.x,y:b.y,width:b.width,height:Math.min(b.height,56+n.compartments.reduce((sum,c)=>sum+20+c.rows.length*20,0))}});
      if(!drawing){
        builtinLabel(n.id,"node.title",labelText(n.title),{x:b.x+b.width/2,y:b.y+40},true);builtinLabel(n.id,"node.subtitle",labelText(n.subtitle),{x:b.x+b.width/2,y:b.y+20},true);
        let y=66;for(const compartment of n.compartments){y+=23;for(const row of compartment.rows){builtinLabel(row.id,"row.label",labelText(row.label),{x:b.x+14,y:b.y+y});y+=20;}}
      }
      for(const p of n.ports){
        let point=own(layout.ports,p.id);if(!point)throw Error("Missing measured port geometry");
        const previous=own(saved?.positions,p.id);
        if(drawing&&!previous){const peers=n.ports.filter(other=>other.side===p.side),fraction=(peers.indexOf(p)+1)/(peers.length+1);point={x:p.side==="WEST"?body.x:p.side==="EAST"?body.x+body.width:body.x+body.width*fraction,y:p.side==="NORTH"?body.y:p.side==="SOUTH"?body.y+body.height:body.y+body.height*fraction};}
        const clamped=border(previous?{x:b.x+previous.x,y:b.y+previous.y}:point,body);
        let normal=clamped.normal,attach:Point|undefined;point={x:clamped.x,y:clamped.y};
        if(p.graphic){
          const d=drawGraphic(definitions,p.graphic,p,16,measure,{},undefined,placements),def=definitions.definition(p.graphic.definition),placed=portPlacement(definitions,p.graphic,d,point),a=def.connectionAnchor?placed.connection:{...placed.connection,dx:normal.x,dy:normal.y};
          // A manually moved port can land on a different side of its owner.
          // Keep its graphic and anchor, and let the route leave the new border
          // directly if the authored direction would skim or enter the owner.
          if (!previous || a.dx * normal.x + a.dy * normal.y > 1e-8) {
            normal = { x: a.dx, y: a.dy };
          }
          // Connections attach where the symbol says, which is off the
          // border when the symbol straddles it.
          const origin=placed.origin;addDrawing(d,origin,p.id);attach={x:a.x,y:a.y};
          if(d.geometry.length){
            const left=Math.min(...d.geometry.map(r=>r.x)),top=Math.min(...d.geometry.map(r=>r.y));
            request.obstacles.push({id:p.id,kind:"solid",box:{x:origin.x+left,y:origin.y+top,width:Math.max(1,...d.geometry.map(r=>r.x+r.width-left)),height:Math.max(1,...d.geometry.map(r=>r.y+r.height-top))}});
          }
        }
        else {const text=labelText(p.label);builtinLabel(p.id,"port.label",text,{x:point.x+(point.x-b.x<b.width/2?12:-12-text.length*8),y:point.y-10});}
        request.endpoints.push({id:p.id,owner:n.id,point:attach??point,normal,box:null,ancestors});
        layout.ports[p.id]=point;
      }
      visit(n.children,b,containers);
      for(const r of n.regions?.items??[]){
        const g=own(layout.regions,r.id);if(!g)throw Error("Missing measured region geometry");const region={...g,x:b.x+g.x,y:b.y+g.y};absolute.set(r.id,region);chains.set(r.id,containers);request.frames[r.id]={x:region.x,y:region.y};
        request.obstacles.push({id:r.id,kind:"boundary",box:region},{id:`header:${r.id}`,kind:"solid",box:{...region,height:Math.min(30,region.height)}});
        builtinLabel(r.id,"region.label",labelText(r.label),{x:region.x+12,y:region.y+21});
        visit(r.children,region,[r.id,...containers]);
      }
    }
  };
  visit(scene.nodes,{x:0,y:0},[]);
  // Context keys are accepted occurrence identities. A tree projection changes
  // visual containment, but must not silently change the manual route frame.
  const occurrences=new Map<string,string[]>(),bindings=new Map<string,Binding>();
  const record=(id:string,binding:Binding)=>{const key=JSON.stringify([...binding.context,binding.key]),ids=occurrences.get(key)??[];ids.push(id);occurrences.set(key,ids);bindings.set(id,binding);};
  const collect=(nodes:Node[])=>{for(const node of nodes){record(node.id,node.binding);for(const port of node.ports)bindings.set(port.id,port.binding);collect(node.children);for(const region of node.regions?.items??[]){record(region.id,region.binding);collect(region.children);}}};collect(scene.nodes);
  // One distinct boundary handle per logical hidden endpoint, ordered by identity.
  const proxyGroups=new Map<string,typeof scene.endpointProxies>();
  for(const proxy of [...scene.endpointProxies].sort((a,b)=>a.id<b.id?-1:1)){const group=proxyGroups.get(proxy.displayOwner)??[];group.push(proxy);proxyGroups.set(proxy.displayOwner,group);}
  for(const [owner,proxies]of proxyGroups){const b=absolute.get(owner);if(!b)throw Error("Missing measured proxy owner");
    proxies.forEach((p,i)=>{const point={x:b.x+b.width,y:b.y+Math.max(32,b.height*(i+1)/(proxies.length+1))};
      request.endpoints.push({id:p.id,owner,point,normal:{x:1,y:0},box:null,ancestors:chains.get(owner)??[]});layout.ports[p.id]=point;
      bindings.set(p.id,p.binding);
    });
  }
  for(const endpoint of request.endpoints){
    const binding=bindings.get(endpoint.id);if(!binding)throw Error("Missing routing occurrence binding");
    const logical:string[]=[];
    for(let length=binding.context.length;length>0;length--){const ids=occurrences.get(JSON.stringify(binding.context.slice(0,length)))??[];if(ids.length>1)throw new RoutingFailure("routing.frame.ambiguousContext",[],ids);if(ids[0]&&ids[0]!==endpoint.owner)logical.push(ids[0]);}
    endpoint.logicalAncestors=logical.length?logical:endpoint.ancestors;
  }
  // v4 supplies these maps; v3 is accepted only by the explicit migration path.
  if(saved&&"routeConstraints" in saved)request.constraints=structuredClone(saved.routeConstraints as RoutingRequest["constraints"]);
  return request;
}
export function routeMeasuredLayout(scene:GraphScene,layout:Layout,presentation:Presentation,graphics:PresentationContext,context:RouteContext,measure:MeasureText,notation:NotationProfile=defaultNotation):Layout {
  const ownerFrames:Record<string,RoutedLabelFrame>=Object.create(null),request=measuredRoutingRequest(scene,layout,presentation,graphics,context,measure,ownerFrames),placements=graphPresentation(presentation,scene.view.key)?.labelPlacements??{};
  const paintedLabels=new Set(scene.edges.filter(edge=>labelText(edge.label).trim().length>0).map(edge=>logicalId("label",[edge.id,"edge.label"])));
  const definitions=new GraphicDefinitions(graphics.libraries,graphPresentation(presentation,scene.view.key)?.symbolOverrides);
  // An automatic box attachment shares its owning symbol with fixed ports.
  // Reserve the measured decoration plus their outward stub before choosing a
  // face/offset; changing a nearby port's authored direction is not a remedy.
  const fixedOwners=new Set(request.endpoints.filter(endpoint=>endpoint.id!==endpoint.owner).map(endpoint=>endpoint.owner)),endpoints=new Map(request.endpoints.map(endpoint=>[endpoint.id,endpoint]));let radiusParts=0,radiusCommands=0;
  for(const edge of scene.edges)for(const side of ["start","end"] as const){
    const endpoint=endpoints.get(side==="start"?edge.source:edge.target)!;if(!endpoint.box||!fixedOwners.has(endpoint.owner))continue;
    const points=side==="start"?[{x:0,y:0},{x:1,y:0}]:[{x:1,y:0},{x:0,y:0}],marker=edgeMarkerLayout(definitions,edge,side,points,measure);let boxes:Geometry[]=[];
    if(marker){radiusParts+=marker.drawing.parts;radiusCommands+=marker.drawing.commands;if(radiusParts>50_000||radiusCommands>65_536)throw new RoutingFailure("routing.limit.markerComposition",[edge.id]);boxes=[...marker.drawing.geometry,...marker.drawing.fragments.filter(f=>f.text.trim()).map(f=>f.rect)].map(box=>transformRect(marker.matrix,box));}
    else {const style={startMarker:"none",endMarker:edge.notation==="specialization"?"triangle":"none",...notation.edges?.[edge.notation],...notation.styleClasses?.[edge.styleClass??""]?.edge};if(style[side==="start"?"startMarker":"endMarker"]!=="none"){const marker=legacyMarkerLayout(points,side);boxes=[transformRect(marker.matrix,marker.box)];}}
    for(const box of boxes)endpoint.decorationRadius=Math.max(endpoint.decorationRadius??0,Math.ceil(Math.max(...[box.x,box.x+box.width].flatMap(x=>[box.y,box.y+box.height].map(y=>Math.hypot(x,y))))));
  }
  const decorations=(routing:ReturnType<typeof routeGraph>)=>{
    const obstacles:RouteObstacle[]=[],labels:Record<string,RoutedLabelFrame>=Object.create(null);let parts=0,commands=0,markup=0;
    const add=(obstacle:RouteObstacle)=>{if(request.obstacles.length+obstacles.length>=4096)throw new RoutingFailure("routing.limit.obstacles",[],[obstacle.id]);obstacles.push(obstacle);};
    for(const edge of [...scene.edges].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))for(const side of ["start","end"] as const){
      const points=routing.paths[edge.id].points,marker=edgeMarkerLayout(definitions,edge,side,points,measure,placements);
      if(!marker){
        const style={startMarker:"none",endMarker:edge.notation==="specialization"?"triangle":"none",...notation.edges?.[edge.notation],...notation.styleClasses?.[edge.styleClass??""]?.edge};
        if(style[side==="start"?"startMarker":"endMarker"]!=="none"){
          const marker=legacyMarkerLayout(points,side);
          add({id:`legacy-marker:${edge.id}:${side}`,kind:"solid",box:transformRect(marker.matrix,marker.box),excludeEndpoint:side==="start"?edge.source:edge.target});
        }
        continue;
      }
      parts+=marker.drawing.parts;commands+=marker.drawing.commands;markup+=marker.drawing.markup.length;
      if(parts>50_000||commands>65_536||markup>16*1024*1024)throw new RoutingFailure("routing.limit.markerComposition",[edge.id]);
      marker.drawing.geometry.forEach((box,i)=>add({id:`marker:${edge.id}:${side}:${i}`,kind:"solid",box:transformRect(marker.matrix,box),excludeEndpoint:marker.endpoint}));
      marker.drawing.fragments.forEach((fragment,i)=>{if(fragment.text.trim())add({id:`marker-text:${edge.id}:${side}:${i}`,kind:"solid",box:transformRect(marker.matrix,fragment.rect),excludeEndpoint:marker.endpoint});});
      for(const [id,label]of Object.entries(marker.drawing.labels)){
        if(Object.hasOwn(labels,id))throw new RoutingFailure("routing.label.duplicateIdentity",[edge.id],[id]);
        labels[id]={owner:edge.id,kind:"owner",box:transformRect(marker.matrix,label.rect),frame:compose(marker.matrix,label.frame)};
      }
    }
    return {obstacles,labels};
  };
  const labelDegradations=new Map<string,RouteDegradation>();
  const edgeLabels=(routing:ReturnType<typeof routeGraph>,markers:ReturnType<typeof decorations>)=>{
    const labels:Record<string,RoutedLabelFrame>=Object.create(null);labelDegradations.clear();
    for(const edge of [...scene.edges].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
      if(!edge.label.parts.length)continue;
      const drawing=edgeLabelLayout(edge,measure);
      const id=logicalId("label",[edge.id,"edge.label"]),placement=own(placements,id);
      if(placement&&placement.kind!=="route")throw new RoutingFailure("routing.label.wrongFrame",[edge.id],[id]);
      const at=routeFrame(routing.paths[edge.id].points,placement?.fraction??.5),tangent=placement?.tangentOffset??6,normal=placement?.normalOffset??-7;
      const x=at.x+at.tx*tangent-at.ty*normal,y=at.y+at.ty*tangent+at.tx*normal;
      let box={x,y:y-14,width:Math.max(6,...drawing.fragments.map(f=>f.rect.x+f.rect.width)),height:Math.max(20,drawing.height)};
      // Automatic captions try a fixed finite set around the half-path anchor.
      // Saved offsets are hard constraints. Never persist these layout choices.
      if(!placement&&paintedLabels.has(id)){
        const clear=(candidate:Geometry)=>{
          const expanded={x:candidate.x-scene.routing.clearance,y:candidate.y-scene.routing.clearance,width:candidate.width+2*scene.routing.clearance,height:candidate.height+2*scene.routing.clearance};
          const charge=()=>{if(++routing.work.collisionChecks>64_000_000)throw new RoutingFailure("routing.limit.collisionChecks",[edge.id],[id]);};
          for(const obstacle of [...request.obstacles,...markers.obstacles]){charge();if(obstacle.kind==="solid"&&overlaps(expanded,obstacle.box))return false;}
          for(const label of Object.values(labels)){charge();if(paintedLabels.has(logicalId("label",[label.owner,"edge.label"]))&&overlaps(expanded,label.box))return false;}
          for(const path of Object.values(routing.paths))if(path.edgeId!==edge.id)for(const segment of path.segments){charge();if(segmentIntersectsBox(segment.from,segment.to,expanded))return false;}
          return true;
        };
        let found=false;
        for(const radius of [0,24,48,96,192,384]){
          for(const [dx,dy]of [[0,0],[-box.width-12,0],[-box.width/2,-box.height-16],[0,box.height+16],[-box.width-12,box.height+16],[-box.width/2,box.height+16]]){
            const candidate={...box,x:box.x+dx+(dx<0?-radius:radius),y:box.y+dy+(dy<0?-radius:radius)};
            if(clear(candidate)){box=candidate;found=true;break;}
          }
          if(found)break;
        }
        // A crowded caption keeps its anchor position; the diagram still paints.
        if(!found)labelDegradations.set(edge.id,{edgeId:edge.id,code:"routing.label.noFreePlacement",relaxation:"labelPlacement"});
      }
      labels[id]={owner:edge.id,kind:"route",box,frame:[at.tx,at.ty,-at.ty,at.tx,at.x,at.y]};
    }
    return labels;
  };
  // Strict avoidance first; an edge with no clean path relaxes alone rather than
  // blanking the whole diagram. Saved manual routes stay hard constraints.
  let routing=routeGraph(request,undefined,{degrade:true}),markers=decorations(routing),labels=edgeLabels(routing,markers);
  const collisions=()=>{
    const unsettled:{id:string;owner:string}[]=[];
    const obstacles:RouteObstacle[]=[...markers.obstacles,...Object.entries(labels).filter(([id])=>paintedLabels.has(id)).map(([id,label])=>({id,kind:"solid" as const,box:label.box,excludeEdge:label.owner}))];
    for(const obstacle of obstacles){
      const box={x:obstacle.box.x-scene.routing.clearance,y:obstacle.box.y-scene.routing.clearance,width:obstacle.box.width+2*scene.routing.clearance,height:obstacle.box.height+2*scene.routing.clearance};
      for(const edge of scene.edges){
        if(obstacle.excludeEdge===edge.id||obstacle.excludeEndpoint===edge.source||obstacle.excludeEndpoint===edge.target)continue;
        const path=routing.paths[edge.id];
        if(path.segments.some(segment=>{if(++routing.work.collisionChecks>64_000_000)throw new RoutingFailure("routing.limit.collisionChecks",[edge.id],[obstacle.id]);return segmentIntersectsBox(segment.from,segment.to,box);}))unsettled.push({id:obstacle.id,owner:edge.id});
      }
    }
    return unsettled;
  };
  // At most three re-routing passes. Each label exempts only its own logical edge.
  let unsettled=collisions(),settled=unsettled.length===0;
  for(let pass=0;pass<3&&!settled;pass++){
    // Empty bound parts keep their source hit/frame but paint no text. Their
    // invisible hit rectangles must not force other logical edges to detour.
    const obstacles=Object.entries(labels).filter(([id])=>paintedLabels.has(id)).map(([id,label])=>({id,kind:"solid" as const,box:label.box,excludeEdge:label.owner}));
    const next=routeGraph({...request,obstacles:[...request.obstacles,...markers.obstacles,...obstacles]},routing.work,{degrade:true});
    routing=next;markers=decorations(routing);labels=edgeLabels(routing,markers);unsettled=collisions();settled=unsettled.length===0;
  }
  if(!settled)for(const label of unsettled)if(!labelDegradations.has(label.owner))labelDegradations.set(label.owner,{edgeId:label.owner,code:"routing.label.collisionDidNotSettle",relaxation:"labelPlacement"});
  const relaxed=[...(routing.degraded??[]),...[...labelDegradations.values()].filter(label=>!routing.degraded?.some(d=>d.edgeId===label.edgeId))];
  if(relaxed.length)routing.degraded=relaxed;else delete routing.degraded;
  routing.labelFrames={...ownerFrames,...markers.labels,...labels};
  for(const id of Object.keys(placements))if(!Object.hasOwn(routing.labelFrames,id))throw new RoutingFailure("routing.label.identityUnavailable",[],[id]);
  for(const box of [...Object.values(routing.labelFrames).map(label=>label.box),...markers.obstacles.map(marker=>marker.box)]){
    const minX=Math.min(routing.extents.x,box.x),minY=Math.min(routing.extents.y,box.y);
    routing.extents={x:minX,y:minY,width:Math.max(routing.extents.x+routing.extents.width,box.x+box.width)-minX,height:Math.max(routing.extents.y+routing.extents.height,box.y+box.height)-minY};
  }
  layout.routing=routing;
  for(const path of Object.values(routing.paths))layout.edges[path.edgeId]=path.points;
  return layout;
}
