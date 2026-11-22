/** Bounded geometry-only router. Invoked in the layout worker after measurement. */
import type { Geometry, Point } from "./protocol.ts";
import { graphicObject, graphicArray, graphicId, graphicNumber } from "./graphics-contract.ts";
import { validateRoutingPolicy, validateRouteConstraint, ROOT_ROUTE_FRAME,
  type RoutingPolicy, type RouteConstraint } from "./routing-contract.ts";

export interface RouteContext {
  revision:number; viewKey:string; scopeIdentity:string; packageFingerprint:string; generation:number;
}
export interface RouteEndpoint {
  id:string; owner:string; point:Point; normal:Point;
  /** A box endpoint chooses its boundary face per edge. Authored anchors use null. */
  box:Geometry|null;
  /** Nearest containing outline first; excludes the terminal's own outline. */
  ancestors:string[];
  /** Accepted occurrence ancestry can survive a flat visual projection. */
  logicalAncestors?:string[];
  /** Measured decoration radius reserves other fixed terminals on this owner. */
  decorationRadius?:number;
}
export interface RouteObstacle { id:string; box:Geometry; kind:"solid"|"boundary"; excludeEdge?:string; excludeEndpoint?:string }
export interface RouteEdge { id:string; source:string; target:string; branchGroup:string|null; styleKey:string }
export interface RoutingRequest {
  schemaVersion:1; context:RouteContext; policy:RoutingPolicy;
  endpoints:RouteEndpoint[]; obstacles:RouteObstacle[]; edges:RouteEdge[];
  frames:Record<string,Point>; constraints:Record<string,RouteConstraint>;
}
export interface RouteGate { owner:string; point:Point }
export interface RouteSegment { id:string; from:Point; to:Point }
export interface RoutedPath {
  edgeId:string; frame:string; sourceTerminal:Point; targetTerminal:Point;
  points:Point[]; gates:RouteGate[]; segments:RouteSegment[];
}
export interface SharedSegment { id:string; from:Point; to:Point; members:string[] }
export interface RoutedLabelFrame {owner:string;kind:"owner"|"route";box:Geometry;frame:[number,number,number,number,number,number]}
export interface RoutingResult {
  schemaVersion:1; context:RouteContext; paths:Record<string,RoutedPath>;
  sharedSegments:SharedSegment[]; extents:Geometry;
  labelFrames:Record<string,RoutedLabelFrame>;
  work:{expansions:number;collisionChecks:number;segments:number};
}
export function validateRoutingResult(value:unknown):asserts value is RoutingResult {
  const r=graphicObject(value,["schemaVersion","context","paths","sharedSegments","extents","labelFrames","work"],"routing result");
  if(r.schemaVersion!==1)throw Error("Unsupported routing result");
  const c=graphicObject(r.context,["revision","viewKey","scopeIdentity","packageFingerprint","generation"],"routing context");
  for(const n of [c.revision,c.generation])if(!Number.isSafeInteger(n)||Number(n)<0)throw Error("Invalid routing generation");
  graphicId(c.viewKey);graphicId(c.scopeIdentity);if(typeof c.packageFingerprint!=="string"||!/^[a-f0-9]{64}$/.test(c.packageFingerprint))throw Error("Invalid routing fingerprint");
  const paths=graphicObject(r.paths),keys=Object.keys(paths);if(keys.length>LIMIT.edges)throw Error("Routing path limit");
  let segments=0;
  for(const [id,value]of Object.entries(paths)){
    const p=graphicObject(value,["edgeId","frame","sourceTerminal","targetTerminal","points","gates","segments"],"routed path");graphicId(id);graphicId(p.frame);
    if(p.edgeId!==id)throw Error("Mismatched route identity");point(p.sourceTerminal);point(p.targetTerminal);
    const points=graphicArray(p.points,LIMIT.vertices) as Point[];points.forEach(point);
    if(points.length<2||!equal(points[0],p.sourceTerminal)||!equal(points.at(-1)!,p.targetTerminal))throw Error("Mismatched route terminals");
    for(let i=1;i<points.length;i++)if(equal(points[i-1],points[i])||(i>1&&i<points.length-1&&points[i-1].x!==points[i].x&&points[i-1].y!==points[i].y))throw Error("Invalid orthogonal route segment");
    for(const gate of graphicArray(p.gates,128)){const g=graphicObject(gate,["owner","point"],"route gate");graphicId(g.owner);point(g.point);if(!points.some(p=>equal(p,g.point as Point)))throw Error("Missing route gate vertex");}
    const list=graphicArray(p.segments,LIMIT.vertices-1);if(list.length!==points.length-1)throw Error("Invalid route segment count");
    list.forEach((v,i)=>{const s=graphicObject(v,["id","from","to"],"route segment");point(s.from);point(s.to);if(s.id!==JSON.stringify([c.generation,id,i])||!equal(s.from,points[i])||!equal(s.to,points[i+1]))throw Error("Mismatched route segment");});segments+=list.length;
  }
  if(segments>LIMIT.segments)throw Error("Routing segment limit");
  for(const item of graphicArray(r.sharedSegments,LIMIT.segments)){
    const s=graphicObject(item,["id","from","to","members"],"shared route segment");if(typeof s.id!=="string"||s.id.length>16384)throw Error("Invalid shared hit ID");point(s.from);point(s.to);
    const members=graphicArray(s.members,LIMIT.edges);if(members.length<2||new Set(members).size!==members.length)throw Error("Invalid shared route members");
    for(const id of members){graphicId(id);const path=paths[id] as RoutedPath|undefined;if(!path?.segments.some(v=>equal(v.from,s.from as Point)&&equal(v.to,s.to as Point)))throw Error("Foreign shared route member");}
  }
  const extents=graphicObject(r.extents,["x","y","width","height"],"routing extents");for(const v of Object.values(extents))graphicNumber(v);if(Number(extents.width)<0||Number(extents.height)<0)throw Error("Invalid routing extents");
  const work=graphicObject(r.work,["expansions","collisionChecks","segments"],"routing work");for(const n of Object.values(work))if(!Number.isSafeInteger(n)||Number(n)<0)throw Error("Invalid routing work");if(work.segments!==segments||Number(work.expansions)>LIMIT.total||Number(work.collisionChecks)>64_000_000)throw Error("Invalid routing work total");
  const labels=graphicObject(r.labelFrames);if(Object.keys(labels).length>20000)throw Error("Routing label frame limit");
  for(const [id,value]of Object.entries(labels)){
    graphicId(id);const l=graphicObject(value,["owner","kind","box","frame"],"routed label frame");graphicId(l.owner);
    if(!["owner","route"].includes(l.kind as string))throw Error("Invalid label frame kind");const box=graphicObject(l.box,["x","y","width","height"],"label frame box");for(const n of Object.values(box))graphicNumber(n);if(Number(box.width)<0||Number(box.height)<0)throw Error("Invalid label frame box");
    const m=graphicArray(l.frame,6);if(m.length!==6)throw Error("Invalid label affine frame");m.forEach(graphicNumber);if(Math.abs(Number(m[0])*Number(m[3])-Number(m[1])*Number(m[2]))<1e-9)throw Error("Singular label affine frame");
  }
}
export class RoutingFailure extends Error {
  code:string; edgeIds:string[]; partIds:string[];
  constructor(code:string, edgeIds:string[], partIds:string[]=[]) {
    super(`${code}${partIds.length?`: ${partIds.join(", ")}`:""}`);this.code=code;this.edgeIds=edgeIds;this.partIds=partIds;
  }
}
const LIMIT={obstacles:4096,edges:2048,coordinates:512,expansions:100_000,total:2_000_000,vertices:128,segments:32768};
const equal=(a:Point,b:Point)=>a.x===b.x&&a.y===b.y;
const manhattan=(a:Point,b:Point)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const inside=(p:Point,b:Geometry)=>p.x>b.x&&p.x<b.x+b.width&&p.y>b.y&&p.y<b.y+b.height;
const coord=(v:number)=>{graphicNumber(v);return v;};
function point(v:unknown):asserts v is Point {
  const p=graphicObject(v,["x","y"],"routing point");coord(p.x as number);coord(p.y as number);
}
export function validateRoutingRequest(value:unknown):asserts value is RoutingRequest {
  const r=graphicObject(value,["schemaVersion","context","policy","endpoints","obstacles","edges","frames","constraints"],"routing request");
  if(r.schemaVersion!==1)throw Error("Unsupported routing request");
  const c=graphicObject(r.context,["revision","viewKey","scopeIdentity","packageFingerprint","generation"],"routing context");
  for(const n of [c.revision,c.generation])if(!Number.isSafeInteger(n)||Number(n)<0)throw Error("Invalid routing generation");
  graphicId(c.viewKey);graphicId(c.scopeIdentity);
  if(typeof c.packageFingerprint!=="string"||!/^[0-9a-f]{64}$/.test(c.packageFingerprint))throw Error("Invalid routing fingerprint");
  validateRoutingPolicy(r.policy);
  const ids=new Set<string>(),owners=new Map<string,RouteObstacle>();
  for(const value of graphicArray(r.obstacles,LIMIT.obstacles)) {
    const o=graphicObject(value,Object.hasOwn(graphicObject(value),"excludeEdge")?["id","box","kind","excludeEdge"]:Object.hasOwn(graphicObject(value),"excludeEndpoint")?["id","box","kind","excludeEndpoint"]:["id","box","kind"],"routing obstacle");graphicId(o.id);
    if(o.excludeEdge!==undefined)graphicId(o.excludeEdge);if(o.excludeEndpoint!==undefined)graphicId(o.excludeEndpoint);
    const b=graphicObject(o.box,["x","y","width","height"],"routing box");
    for(const v of Object.values(b))graphicNumber(v);
    if(Number(b.width)<=0||Number(b.height)<=0||!["solid","boundary"].includes(o.kind as string)||owners.has(o.id))throw Error("Invalid routing obstacle");
    coord(Number(b.x)+Number(b.width));coord(Number(b.y)+Number(b.height));owners.set(o.id,value as RouteObstacle);
  }
  for(const value of graphicArray(r.endpoints,5000)) {
    const fields=graphicObject(value);const e=graphicObject(value,["id","owner","point","normal","box","ancestors",...(Object.hasOwn(fields,"logicalAncestors")?["logicalAncestors"]:[]),...(Object.hasOwn(fields,"decorationRadius")?["decorationRadius"]:[])],"routing endpoint");
    if(e.decorationRadius!==undefined){graphicNumber(e.decorationRadius);if(Number(e.decorationRadius)<0)throw Error("Negative decoration radius");}graphicId(e.id);graphicId(e.owner);point(e.point);point(e.normal);
    if(e.box!==null){const b=graphicObject(e.box,["x","y","width","height"],"routing endpoint box");for(const v of Object.values(b))graphicNumber(v);if(Number(b.width)<=0||Number(b.height)<=0)throw Error("Invalid endpoint box");}
    if(ids.has(e.id)||!owners.has(e.owner)||Math.hypot(e.normal.x,e.normal.y)<1e-9)throw Error("Invalid routing terminal");ids.add(e.id);
    const seen=new Set<string>();
    for(const a of graphicArray(e.ancestors,64)) {graphicId(a);if(seen.has(a)||a===e.owner||owners.get(a)?.kind!=="boundary")throw Error("Invalid routing ancestor");seen.add(a);}
    if(e.logicalAncestors!==undefined){const logical=new Set<string>();for(const a of graphicArray(e.logicalAncestors,64)){graphicId(a);if(a===e.owner||logical.has(a))throw Error("Invalid logical routing ancestor");logical.add(a);}}
  }
  for(const obstacle of r.obstacles as RouteObstacle[])if(obstacle.excludeEndpoint!==undefined&&!ids.has(obstacle.excludeEndpoint))throw Error("Foreign excluded endpoint");
  const edges=new Set<string>();
  for(const value of graphicArray(r.edges,LIMIT.edges)) {
    const e=graphicObject(value,["id","source","target","branchGroup","styleKey"],"routing edge");graphicId(e.id);graphicId(e.source);graphicId(e.target);
    if(typeof e.styleKey!=="string"||!e.styleKey.length||new TextEncoder().encode(e.styleKey).length>4096)throw Error("Invalid routing style identity");
    if(e.branchGroup!==null)graphicId(e.branchGroup);
    if(edges.has(e.id)||!ids.has(e.source)||!ids.has(e.target))throw Error("Invalid routing edge reference");edges.add(e.id);
  }
  for(const obstacle of r.obstacles as RouteObstacle[])if(obstacle.excludeEdge!==undefined&&!edges.has(obstacle.excludeEdge))throw Error("Foreign excluded edge");
  const frames=graphicObject(r.frames),constraints=graphicObject(r.constraints);
  if(Object.keys(frames).length>1024||Object.keys(constraints).length>LIMIT.edges)throw Error("Routing map limit");
  for(const [id,p]of Object.entries(frames)){graphicId(id);point(p);}
  for(const endpoint of r.endpoints as RouteEndpoint[])for(const id of endpoint.logicalAncestors??[])if(!Object.hasOwn(frames,id))throw Error("Missing logical routing frame");
  if(!Object.hasOwn(frames,ROOT_ROUTE_FRAME))throw Error("Missing root routing frame");
  for(const [id,constraint]of Object.entries(constraints)){if(!edges.has(id))throw Error("Foreign route constraint");validateRouteConstraint(constraint);if(!Object.hasOwn(frames,constraint.frame))throw Error("Missing route frame");}
}

interface SearchState { key:number; x:number; y:number; dir:number; cost:number; score:number; previous?:SearchState }
class Queue {
  private items:SearchState[]=[];
  private before(a:SearchState,b:SearchState) {return a.score-b.score||a.cost-b.cost||a.y-b.y||a.x-b.x||a.dir-b.dir;}
  push(v:SearchState) {const a=this.items;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(this.before(a[p],v)<=0)break;a[i]=a[p];i=p;}a[i]=v;}
  pop():SearchState|undefined {
    const a=this.items,top=a[0],last=a.pop();if(!a.length)return top;
    let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&this.before(a[c+1],a[c])<0)c++;if(this.before(last!,a[c])<=0)break;a[i]=a[c];i=c;}a[i]=last!;return top;
  }
}
function inflated(b:Geometry,d:number):Geometry {return {x:coord(b.x-d),y:coord(b.y-d),width:b.width+2*d,height:b.height+2*d};}
export function segmentIntersectsBox(a:Point,b:Point,r:Geometry):boolean {
  if(a.x===b.x)return a.x>r.x&&a.x<r.x+r.width&&Math.max(a.y,b.y)>r.y&&Math.min(a.y,b.y)<r.y+r.height;
  if(a.y===b.y)return a.y>r.y&&a.y<r.y+r.height&&Math.max(a.x,b.x)>r.x&&Math.min(a.x,b.x)<r.x+r.width;
  // Non-cardinal terminal leads use a bounded slab intersection.
  let lo=0,hi=1;
  for(const [v,d,min,max]of [[a.x,b.x-a.x,r.x,r.x+r.width],[a.y,b.y-a.y,r.y,r.y+r.height]]){
    if(d===0){if(v<=min||v>=max)return false;continue;}
    const p=(min-v)/d,q=(max-v)/d;lo=Math.max(lo,Math.min(p,q));hi=Math.min(hi,Math.max(p,q));
  }
  return lo<hi&&hi>0&&lo<1;
}
function boundaryCrossings(a:Point,b:Point,r:Geometry):Point[] {
  if(a.x!==b.x&&a.y!==b.y)return [];
  const result:Point[]=[];
  if(a.x===b.x&&a.x>r.x&&a.x<r.x+r.width){for(const y of [r.y,r.y+r.height])if(y>=Math.min(a.y,b.y)&&y<=Math.max(a.y,b.y))result.push({x:a.x,y});}
  if(a.y===b.y&&a.y>r.y&&a.y<r.y+r.height){for(const x of [r.x,r.x+r.width])if(x>=Math.min(a.x,b.x)&&x<=Math.max(a.x,b.x))result.push({x,y:a.y});}
  return result;
}
/** Full-path arclength frame; vertices use the following nonzero segment. */
export function routeFrame(points:Point[],fraction:number):Point&{tx:number;ty:number} {
  if(!Number.isFinite(fraction)||fraction<0||fraction>1||points.length<2)throw Error("Invalid route frame");
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
  const total=lengths.reduce((a,b)=>a+b,0);if(total===0)throw Error("Degenerate route frame");
  let distance=fraction*total;
  for(let i=0;i<lengths.length;i++)if(lengths[i]>0){const length=lengths[i];if(distance<length||i===lengths.length-1){const tx=(points[i+1].x-points[i].x)/length,ty=(points[i+1].y-points[i].y)/length;return {x:points[i].x+distance*tx,y:points[i].y+distance*ty,tx,ty};}distance-=length;}
  throw Error("Missing route tangent");
}
export function projectRoute(points:Point[],at:Point):{fraction:number;tangentOffset:number;normalOffset:number} {
  let best={distance:Infinity,fraction:0,tangentOffset:0,normalOffset:0},past=0;
  const total=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
  if(total===0)throw Error("Degenerate route projection");
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(!length)continue;
    const tx=(b.x-a.x)/length,ty=(b.y-a.y)/length,t=Math.max(0,Math.min(length,(at.x-a.x)*tx+(at.y-a.y)*ty));
    const dx=at.x-a.x-t*tx,dy=at.y-a.y-t*ty,distance=dx*dx+dy*dy;
    if(distance<best.distance)best={distance,fraction:(past+t)/total,tangentOffset:dx*tx+dy*ty,normalOffset:-dx*ty+dy*tx};past+=length;
  }
  const frame=routeFrame(points,best.fraction),dx=at.x-frame.x,dy=at.y-frame.y;
  return {fraction:best.fraction,tangentOffset:dx*frame.tx+dy*frame.ty,normalOffset:-dx*frame.ty+dy*frame.tx};
}

export function routeGraph(request:RoutingRequest,work:RoutingResult["work"]={expansions:0,collisionChecks:0,segments:0}):RoutingResult {
  validateRoutingRequest(request);
  const sortedObstacles=[...request.obstacles].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const {context,policy}=request, endpoints=new Map(request.endpoints.map(e=>[e.id,e])), obstacles=new Map(sortedObstacles.map(o=>[o.id,o]));
  work.segments=0;
  const result:RoutingResult={schemaVersion:1,context:{...context},paths:Object.create(null),sharedSegments:[],labelFrames:Object.create(null),extents:{x:0,y:0,width:0,height:0},work};
  const sorted=[...request.edges].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),parallel=new Map<string,number>();
  for(const edge of sorted) {
    let obstruction:string|undefined;
    const fail=(code:string):never=>{throw new RoutingFailure(code,[edge.id],obstruction?[obstruction]:[]);};
    const rawSource=endpoints.get(edge.source)!,rawTarget=endpoints.get(edge.target)!;
    const terminal=(e:RouteEndpoint,toward:Point):RouteEndpoint=>{
      if(!e.box)return e;
      const b=e.box,c={x:b.x+b.width/2,y:b.y+b.height/2},dx=toward.x-c.x,dy=toward.y-c.y;
      const normal=Math.abs(dx)/b.width>=Math.abs(dy)/b.height?{x:dx>=0?1:-1,y:0}:{x:0,y:dy>=0?1:-1};
      const directions=[normal,...[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}].filter(n=>n.x!==normal.x||n.y!==normal.y)];
      for(const n of directions)for(const offset of [0,policy.stubLength+policy.clearance+2,-policy.stubLength-policy.clearance-2,b.width/4,-b.width/4]){
        const at={x:n.x?c.x+n.x*b.width/2:Math.max(b.x+1,Math.min(b.x+b.width-1,c.x+offset)),y:n.y?c.y+n.y*b.height/2:Math.max(b.y+1,Math.min(b.y+b.height-1,c.y+offset))};
        const end={x:at.x+n.x*policy.stubLength,y:at.y+n.y*policy.stubLength};
        const blocked=sortedObstacles.some(o=>{
          if(++result.work.collisionChecks>64_000_000)fail("routing.limit.collisionChecks");
          if(o.excludeEdge===edge.id||o.excludeEndpoint===edge.source||o.excludeEndpoint===edge.target||o.id===e.owner||e.ancestors.includes(o.id))return false;
          const sibling=endpoints.get(o.id),reserve=e.decorationRadius&&sibling&&sibling.id!==e.id&&sibling.owner===e.owner?policy.stubLength+e.decorationRadius:0;
          return segmentIntersectsBox(at,end,inflated(o.box,policy.clearance+reserve));
        });
        if(!blocked)return {...e,point:at,normal:n};
      }
      return fail("routing.terminal.noFreeAttachment");
    };
    const source=terminal(rawSource,rawTarget.point),target=terminal(rawTarget,source.point);
    const common=[source.owner,...source.ancestors].find(id=>[target.owner,...target.ancestors].includes(id));
    const logical=[source.owner,...(source.logicalAncestors??source.ancestors)].find(id=>[target.owner,...(target.logicalAncestors??target.ancestors)].includes(id));
    const frame=logical??ROOT_ROUTE_FRAME, constraint=Object.hasOwn(request.constraints,edge.id)?request.constraints[edge.id]:undefined;
    if(constraint&&constraint.frame!==frame)fail("routing.constraint.frameChanged");
    const gates:RouteGate[]=[],portals:Point[]=[];
    // A chosen gate is a geometry checkpoint, never a semantic endpoint.
    const gate=(owner:string,toward:Point)=>{
      const b=obstacles.get(owner)!.box, margin=policy.clearance+2;
      const center={x:b.x+b.width/2,y:b.y+b.height/2};
      const horizontal=Math.abs(toward.x-center.x)/b.width>=Math.abs(toward.y-center.y)/b.height;
      const preferred=horizontal?(toward.x>=center.x?"east":"west"):(toward.y>=center.y?"south":"north");
      // A facing boundary may be entirely covered by a measured heading. Choose
      // a free checkpoint on another face; never route through the heading.
      for(const face of [preferred,...["east","south","west","north"].filter(f=>f!==preferred)]){
        const vertical=face==="east"||face==="west",lo=vertical?b.y:b.x,extent=vertical?b.height:b.width;
        for(const offset of [vertical?toward.y:toward.x,lo+extent/2,lo+extent/4,lo+extent*3/4]){
          const along=Math.max(lo+margin,Math.min(lo+extent-margin,offset));
          const point=vertical?{x:face==="east"?b.x+b.width:b.x,y:along}:{x:along,y:face==="south"?b.y+b.height:b.y};
          const blocked=sortedObstacles.some(o=>{
            if(++result.work.collisionChecks>64_000_000)fail("routing.limit.collisionChecks");
            if(o.excludeEdge===edge.id||o.excludeEndpoint===edge.source||o.excludeEndpoint===edge.target||o.kind==="boundary")return false;
            return inside(point,inflated(o.box,policy.clearance));
          });
          if(!blocked){gates.push({owner,point});portals.push(point);return point;}
        }
      }
      return fail("routing.gate.noFreeCheckpoint");
    };
    const chain=(e:RouteEndpoint)=>common===e.owner?[]:e.ancestors.slice(0,common?e.ancestors.indexOf(common):undefined);
    const sourceChain=chain(source),targetChain=chain(target);
    const startGates=sourceChain.map(id=>gate(id,target.point)),endGates=targetChain.map(id=>gate(id,source.point)).reverse();
    const ownOutlines=new Set([source.owner,target.owner,...[source.id,target.id].filter(id=>obstacles.has(id))]);
    const allowedBoundaries=new Set([...source.ancestors,...target.ancestors,...ownOutlines]);
    const solids=sortedObstacles.filter(o=>o.excludeEdge!==edge.id&&o.excludeEndpoint!==edge.source&&o.excludeEndpoint!==edge.target&&(o.kind==="solid"&&!ownOutlines.has(o.id)||o.kind==="boundary"&&!allowedBoundaries.has(o.id)))
      .map(o=>({id:o.id,box:inflated(o.box,policy.clearance)}));
    // Own terminal outlines still block the core, except for enclosing endpoints.
    for(const id of ownOutlines)if(!source.ancestors.includes(id)&&!target.ancestors.includes(id))solids.push({id,box:inflated(obstacles.get(id)!.box,policy.clearance)});
    const boundaries=sortedObstacles.filter(o=>o.kind==="boundary"&&allowedBoundaries.has(o.id)&&!ownOutlines.has(o.id));
    const clear=(a:Point,b:Point,leadOwners?:Set<string>)=>{
      const charge=()=>{if(++result.work.collisionChecks>64_000_000)fail("routing.limit.collisionChecks");};
      for(const o of solids){charge();if(leadOwners?.has(o.id))continue;if(segmentIntersectsBox(a,b,o.box)){obstruction=o.id;return false;}}
      for(const o of boundaries){charge();for(const crossing of boundaryCrossings(a,b,o.box))if(!gates.some(g=>g.owner===o.id&&equal(g.point,crossing))){obstruction=o.id;return false;}}
      return true;
    };
    const lead=(e:RouteEndpoint)=>{
      const magnitude=Math.hypot(e.normal.x,e.normal.y),nx=e.normal.x/magnitude,ny=e.normal.y/magnitude;
      let length=policy.stubLength;
      for(const o of solids)if(o.id===e.owner||o.id===e.id){
        let enter=0,leave=Infinity;
        for(const [at,d,min,max]of [[e.point.x,nx,o.box.x,o.box.x+o.box.width],[e.point.y,ny,o.box.y,o.box.y+o.box.height]]){
          if(Math.abs(d)<1e-12){if(at<min||at>max){leave=-1;break;}continue;}
          const a=(min-at)/d,b=(max-at)/d;enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));
        }
        if(leave>=enter&&leave>0&&enter<=length)length=Math.max(length,leave+.01);
      }
      if(length>128)fail("routing.terminal.clearanceLimit");
      return {x:coord(e.point.x+nx*length),y:coord(e.point.y+ny*length)};
    };
    const start=lead(source),end=lead(target);
    if(!clear(source.point,start,new Set([source.owner,source.id,`header:${source.owner}`]))||!clear(end,target.point,new Set([target.owner,target.id,`header:${target.owner}`])))fail("routing.terminal.obstructed");
    const manual=constraint?.waypoints.map(p=>({x:coord(p.x+request.frames[frame].x),y:coord(p.y+request.frames[frame].y)}))??[];
    for(const p of manual)if(solids.some(o=>inside(p,o.box)))fail("routing.constraint.obstructed");
    const pair=JSON.stringify([edge.source,edge.target]),lane=parallel.get(pair)??0;parallel.set(pair,lane+1);
    const extra:Point[]=[];
    if(edge.source===edge.target) {
      const b=obstacles.get(source.owner)!.box,d=policy.stubLength+policy.clearance+12+lane*8;
      extra.push({x:Math.max(start.x,end.x,b.x+b.width)+d,y:start.y},{x:Math.max(start.x,end.x,b.x+b.width)+d,y:b.y-d},{x:end.x,y:b.y-d});
    }else if(lane&&!manual.length&&!edge.branchGroup){
      const a=obstacles.get(source.owner)!.box,b=obstacles.get(target.owner)!.box,d=policy.stubLength+policy.clearance+lane*8;
      const candidates=[{x:(start.x+end.x)/2,y:Math.min(a.y,b.y)-d},{x:(start.x+end.x)/2,y:Math.max(a.y+a.height,b.y+b.height)+d},
        {x:Math.max(a.x+a.width,b.x+b.width)+d,y:(start.y+end.y)/2},{x:Math.min(a.x,b.x)-d,y:(start.y+end.y)/2}];
      const enclosing=common&&obstacles.get(common)?.kind==="boundary"?obstacles.get(common)!.box:undefined;
      const checkpoint=candidates.find(p=>{
        if(enclosing&&!inside(p,enclosing))return false;
        return !solids.some(o=>{if(++result.work.collisionChecks>64_000_000)fail("routing.limit.collisionChecks");return inside(p,o.box);});
      });
      if(!checkpoint)fail("routing.parallel.noFreeLane");
      extra.push(checkpoint!);
    }
    const checkpoints=[start,...startGates,...manual,...extra,...endGates,end];
    const xs=new Set<number>(),ys=new Set<number>();
    const add=(p:Point)=>{const x=coord(p.x),y=coord(p.y);if((!xs.has(x)&&xs.size===LIMIT.coordinates)||(!ys.has(y)&&ys.size===LIMIT.coordinates))fail("routing.limit.coordinates");xs.add(x);ys.add(y);};checkpoints.forEach(add);
    for(const o of solids){add({x:o.box.x,y:o.box.y});add({x:o.box.x+o.box.width,y:o.box.y+o.box.height});}
    for(const o of boundaries){add({x:o.box.x,y:o.box.y});add({x:o.box.x+o.box.width,y:o.box.y+o.box.height});}
    // Exterior lanes make cycles/self edges legal without a straight fallback.
    const all=[...checkpoints,...solids.flatMap(o=>[{x:o.box.x,y:o.box.y},{x:o.box.x+o.box.width,y:o.box.y+o.box.height}])];
    add({x:Math.min(...all.map(p=>p.x))-policy.stubLength,y:Math.min(...all.map(p=>p.y))-policy.stubLength});
    add({x:Math.max(...all.map(p=>p.x))+policy.stubLength,y:Math.max(...all.map(p=>p.y))+policy.stubLength});
    if(xs.size>LIMIT.coordinates||ys.size>LIMIT.coordinates)fail("routing.limit.coordinates");
    const x=[...xs].sort((a,b)=>a-b),y=[...ys].sort((a,b)=>a-b),xIndex=new Map(x.map((v,i)=>[v,i])),yIndex=new Map(y.map((v,i)=>[v,i]));
    let expansions=0;
    const search=(from:Point,to:Point):Point[]=>{
      if(equal(from,to))return [from];
      const q=new Queue(),costs=new Map<number,number>();
      const key=(xi:number,yi:number,dir:number)=>(yi*x.length+xi)*3+dir;
      const first={key:key(xIndex.get(from.x)!,yIndex.get(from.y)!,0),x:xIndex.get(from.x)!,y:yIndex.get(from.y)!,dir:0,cost:0,score:manhattan(from,to)};
      q.push(first);costs.set(first.key,0);
      for(let current=q.pop();current;current=q.pop()) {
        if(costs.get(current.key)!==current.cost)continue;
        if(++expansions>LIMIT.expansions||++result.work.expansions>LIMIT.total)fail("routing.limit.search");
        const at={x:x[current.x],y:y[current.y]};
        if(equal(at,to)){const out:Point[]=[];for(let state:SearchState|undefined=current;state;state=state.previous)out.push({x:x[state.x],y:y[state.y]});return out.reverse();}
        for(const [dx,dy,dir]of [[-1,0,1],[0,-1,2],[0,1,2],[1,0,1]]){
          const xi=current.x+dx,yi=current.y+dy;if(xi<0||yi<0||xi>=x.length||yi>=y.length)continue;
          const next={x:x[xi],y:y[yi]};if(!clear(at,next))continue;
          const cost=current.cost+manhattan(at,next)+(current.dir&&current.dir!==dir?20:0),k=key(xi,yi,dir);
          if(cost>=(costs.get(k)??Infinity))continue;
          if(costs.size>=LIMIT.expansions*4)fail("routing.limit.states");
          costs.set(k,cost);q.push({key:k,x:xi,y:yi,dir,cost,score:cost+manhattan(next,to),previous:current});
        }
      }
      return fail("routing.impossible");
    };
    const raw:Point[]=[source.point];
    for(let i=1;i<checkpoints.length;i++){const path=search(checkpoints[i-1],checkpoints[i]);raw.push(...(i===1?path:path.slice(1)));if(raw.length>LIMIT.expansions)fail("routing.limit.pathWork");}
    raw.push(target.point);
    const meaningful=[source.point,start,end,target.point,...manual,...portals,...extra],points:Point[]=[];
    for(const p of raw){if(points.length&&equal(points.at(-1)!,p))continue;while(points.length>1){const a=points.at(-2)!,b=points.at(-1)!;if(meaningful.some(m=>equal(m,b))||!((a.x===b.x&&b.x===p.x)||(a.y===b.y&&b.y===p.y)))break;points.pop();}points.push(p);}
    if(points.length>LIMIT.vertices||points.length<2||points.every(p=>equal(p,points[0])))fail("routing.limit.vertices");
    result.work.segments+=points.length-1;if(result.work.segments>LIMIT.segments)fail("routing.limit.segments");
    result.paths[edge.id]={edgeId:edge.id,frame,sourceTerminal:{...source.point},targetTerminal:{...target.point},points,gates,segments:points.slice(1).map((p,i)=>({id:JSON.stringify([context.generation,edge.id,i]),from:points[i],to:p}))};
  }
  const groups=new Map<string,{from:Point;to:Point;members:string[]}>();
  if(policy.trunks==="siblings")for(const edge of sorted)if(edge.branchGroup&&!Object.hasOwn(request.constraints,edge.id)) {
    for(const s of result.paths[edge.id].segments){
      const key=JSON.stringify([edge.branchGroup,edge.source,edge.styleKey,s.from,s.to]),group=groups.get(key);
      if(group)group.members.push(edge.id);else groups.set(key,{from:s.from,to:s.to,members:[edge.id]});
    }
  }
  for(const [key,g]of groups)if(g.members.length>1)result.sharedSegments.push({id:JSON.stringify([context.generation,key]),...g});
  const points=Object.values(result.paths).flatMap(p=>p.points);
  if(points.length){const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));result.extents={x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};}
  return result;
}
