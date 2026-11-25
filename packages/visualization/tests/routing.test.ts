import test from "node:test";
import assert from "node:assert/strict";
import { routeGraph, routeFrame, projectRoute, segmentIntersectsBox, validateRoutingRequest, validateRoutingResult, RoutingFailure, type RoutingRequest } from "../src/routing.ts";
import { defaultRoutingPolicy, ROOT_ROUTE_FRAME } from "../src/routing-contract.ts";

function fixture():RoutingRequest {
  return {schemaVersion:1,context:{revision:3,viewKey:"view",scopeIdentity:"scope:fixture",packageFingerprint:"0".repeat(64),generation:2},policy:defaultRoutingPolicy(),
    obstacles:[{id:"a",kind:"solid",box:{x:0,y:0,width:80,height:80}},{id:"b",kind:"solid",box:{x:400,y:0,width:80,height:80}},{id:"obstacle",kind:"solid",box:{x:180,y:0,width:80,height:100}}],
    endpoints:[{id:"a.port",owner:"a",point:{x:80,y:40},normal:{x:1,y:0},box:null,ancestors:[]},{id:"b.port",owner:"b",point:{x:400,y:40},normal:{x:-1,y:0},box:null,ancestors:[]}],
    edges:[{id:"edge",source:"a.port",target:"b.port",branchGroup:null,styleKey:"wire"}],frames:{[ROOT_ROUTE_FRAME]:{x:0,y:0}},constraints:{}};
}
test("routing avoids expanded measured content, uses actual terminals, and is deterministic",()=>{
  const r=fixture(),result=routeGraph(r),points=result.paths.edge.points;
  assert.deepEqual(points[0],r.endpoints[0].point);assert.deepEqual(points.at(-1),r.endpoints[1].point);
  assert.ok(points.some(p=>p.y<=-8||p.y>=108));
  for(let i=1;i<points.length;i++)assert.ok(points[i].x===points[i-1].x||points[i].y===points[i-1].y);
  assert.deepEqual(routeGraph(r),result);assert.ok(result.work.expansions>0);
});
test("routing order and distinct parallel edge paths do not depend on input order",()=>{
  const r=fixture();r.edges.push({...r.edges[0],id:"edge2"});
  const result=routeGraph(r);assert.notDeepEqual(result.paths.edge.points,result.paths.edge2.points);
  r.edges.reverse();r.obstacles.reverse();assert.deepEqual(routeGraph(r),result);
});

test("nested parallel lanes stay within the common boundary despite remote obstacles",()=>{
  const r=fixture();r.obstacles=r.obstacles.filter(o=>o.id!=="obstacle");
  r.obstacles.push({id:"parent",kind:"boundary",box:{x:-100,y:-100,width:700,height:400}},
    {id:"remote",kind:"solid",box:{x:2000,y:-2000,width:40,height:40}});
  for(const endpoint of r.endpoints)endpoint.ancestors=["parent"];
  r.frames.parent={x:-100,y:-100};r.edges.push({...r.edges[0],id:"parallel"},{...r.edges[0],id:"return",source:"b.port",target:"a.port"});
  const result=routeGraph(r);
  assert.notDeepEqual(result.paths.edge.points,result.paths.parallel.points);
  for(const path of Object.values(result.paths))for(const p of path.points)assert.ok(p.x>-100&&p.x<600&&p.y>-100&&p.y<300);
  r.edges.reverse();assert.deepEqual(routeGraph(r),result);
});

test("automatic decorated attachments reserve fixed sibling terminals without changing their normals",()=>{
  const r=fixture();r.obstacles=r.obstacles.filter(o=>o.id!=="obstacle");
  r.obstacles[0].box={x:0,y:0,width:360,height:169};r.obstacles.push({id:"a.fixed",kind:"solid",box:{x:352,y:48,width:16,height:16}});
  r.endpoints[0]={id:"a",owner:"a",point:{x:180,y:84.5},normal:{x:1,y:0},box:r.obstacles[0].box,ancestors:[],decorationRadius:27};
  r.endpoints.push({id:"a.fixed",owner:"a",point:{x:360,y:56},normal:{x:Math.SQRT1_2,y:Math.SQRT1_2},box:null,ancestors:[]});r.edges[0].source="a";
  const result=routeGraph(r);assert.notEqual(result.paths.edge.sourceTerminal.y,84.5);
  assert.deepEqual(r.endpoints[2].normal,{x:Math.SQRT1_2,y:Math.SQRT1_2});
  const invalid=structuredClone(r);invalid.endpoints[0].decorationRadius=-1;assert.throws(()=>validateRoutingRequest(invalid),/Negative decoration radius/);
  const foreign=fixture();foreign.obstacles.push({id:"decoration",kind:"solid",box:{x:80,y:25,width:20,height:20},excludeEndpoint:"missing"});assert.throws(()=>validateRoutingRequest(foreign),/Foreign excluded endpoint/);
});
test("a transformed non-cardinal terminal keeps its measured normal lead",()=>{
  const r=fixture();r.endpoints[0].normal={x:1,y:1};
  const points=routeGraph(r).paths.edge.points;
  assert.ok(Math.abs((points[1].x-points[0].x)-(points[1].y-points[0].y))<1e-8);
  for(let i=2;i<points.length;i++)assert.ok(points[i].x===points[i-1].x||points[i].y===points[i-1].y);
});
test("manual points are hard constraints and stale/obstructed constraints preserve input",()=>{
  const r=fixture();r.constraints.edge={frame:ROOT_ROUTE_FRAME,waypoints:[{x:130,y:180}]};
  assert.ok(routeGraph(r).paths.edge.points.some(p=>p.x===130&&p.y===180));
  r.constraints.edge.waypoints=[{x:200,y:50}];const bytes=JSON.stringify(r);
  assert.throws(()=>routeGraph(r),(e:unknown)=>e instanceof RoutingFailure&&e.code==="routing.constraint.obstructed");assert.equal(JSON.stringify(r),bytes);
  r.frames.other={x:0,y:0};r.constraints.edge.frame="other";
  assert.throws(()=>routeGraph(r),/frameChanged/);
});
test("self edges have a nondegenerate exterior loop and cycles remain legal",()=>{
  const r=fixture();r.edges=[{...r.edges[0],target:"a.port"}];const p=routeGraph(r).paths.edge.points;
  assert.deepEqual(p[0],p.at(-1));assert.ok(p.length>=5);assert.ok(p.some(v=>v.y<0));
  r.edges=[{...r.edges[0],target:"b.port"},{...r.edges[0],id:"back",source:"b.port",target:"a.port"}];assert.equal(Object.keys(routeGraph(r).paths).length,2);
});
test("nested outline crossings are explicit gates and an unrelated container stays blocked",()=>{
  const r=fixture();r.obstacles.push({id:"container",kind:"boundary",box:{x:-40,y:-60,width:180,height:220}});r.endpoints[0].ancestors=["container"];r.frames.container={x:-40,y:-60};
  const path=routeGraph(r).paths.edge;assert.equal(path.gates.length,1);const gate=path.gates[0];assert.equal(gate.owner,"container");assert.ok(path.points.some(p=>p.x===gate.point.x&&p.y===gate.point.y));
  r.obstacles.push({id:"unrelated",kind:"boundary",box:{x:280,y:-20,width:50,height:100}});const result=routeGraph(r);assert.ok(result.paths.edge.points.some(p=>p.y<=-28||p.y>=108));
});
test("only a declared compatible branch group shares segment hits",()=>{
  const r=fixture();r.policy.trunks="siblings";r.edges.push({...r.edges[0],id:"edge2"});
  assert.equal(routeGraph(r).sharedSegments.length,0);
  r.edges.forEach(e=>e.branchGroup="branch:1");const shared=routeGraph(r).sharedSegments;assert.ok(shared.length>0);assert.deepEqual(shared[0].members,["edge","edge2"]);
  r.edges[1].styleKey="other";assert.equal(routeGraph(r).sharedSegments.length,0);
  r.edges[1].styleKey="wire";r.constraints.edge2={frame:ROOT_ROUTE_FRAME,waypoints:[]};assert.equal(routeGraph(r).sharedSegments.length,0);
});
test("full-path label frames use following tangent and earliest projected fraction",()=>{
  const points=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100},{x:0,y:0}];
  assert.deepEqual(routeFrame(points,.25),{x:100,y:0,tx:0,ty:1});assert.deepEqual(routeFrame(points,1),{x:0,y:0,tx:0,ty:-1});
  assert.deepEqual(projectRoute(points,{x:0,y:0}),{fraction:0,tangentOffset:0,normalOffset:0});
  assert.deepEqual(projectRoute(points,{x:110,y:50}),{fraction:.375,tangentOffset:0,normalOffset:-10});
});
test("invalid or excessive routing input is refused before routing allocation",()=>{
  const r=fixture();validateRoutingRequest(r);
  for(const mutate of [(r:RoutingRequest)=>r.endpoints[0].normal={x:0,y:0},(r:RoutingRequest)=>r.edges[0].target="missing",(r:RoutingRequest)=>r.obstacles[0].box.x=Infinity,(r:RoutingRequest)=>r.edges=Array.from({length:2049},(_,i)=>({...r.edges[0],id:`e${i}`}))]){const bad=fixture();mutate(bad);assert.throws(()=>validateRoutingRequest(bad));}
  const crowded=fixture();crowded.obstacles=Array.from({length:260},(_,i)=>({id:`o${i}`,kind:"solid" as const,box:{x:1000+i*3,y:1000+i*3,width:1,height:1}})).concat(crowded.obstacles);
  assert.throws(()=>routeGraph(crowded),/routing.limit.coordinates/);
});

// Results cross a worker boundary and must retain the same finite work/geometry bounds.
test("routing boundary rejects foreign exclusions, negative label extents and excessive work",()=>{
  const request=fixture();request.obstacles.push({id:"foreign",kind:"solid",box:{x:700,y:0,width:20,height:20},excludeEdge:"missing"});
  assert.throws(()=>validateRoutingRequest(request),/Foreign excluded edge/);
  const result=routeGraph(fixture());result.work.collisionChecks=64_000_001;assert.throws(()=>validateRoutingResult(result),/Invalid routing work total/);
  result.work.collisionChecks=0;result.labelFrames.caption={owner:"edge",kind:"route",box:{x:0,y:0,width:-1,height:14},frame:[1,0,0,1,0,0]};
  assert.throws(()=>validateRoutingResult(result),/Invalid label frame box/);
});

test("an outward fixed port lead may leave its own header clearance envelope",()=>{
  const r=fixture();r.obstacles=r.obstacles.filter(o=>o.id!=="obstacle");r.obstacles.push({id:"header:a",kind:"solid",box:{x:0,y:0,width:100,height:60}});r.endpoints[0].point={x:100,y:40};
  const result=routeGraph(r);assert.deepEqual(result.paths.edge.sourceTerminal,{x:100,y:40});assert.ok(result.paths.edge.points[1].x>100);
});

test("column partition gates avoid the target region heading",()=>{
  const r=fixture();r.obstacles=r.obstacles.filter(o=>o.id!=="obstacle");r.obstacles[1].box={x:0,y:300,width:100,height:100};r.endpoints[1].point={x:100,y:350};r.endpoints[1].normal={x:1,y:0};
  r.obstacles.push({id:"first",kind:"boundary",box:{x:-40,y:-60,width:180,height:220}},{id:"second",kind:"boundary",box:{x:-40,y:240,width:180,height:220}},{id:"header:second",kind:"solid",box:{x:-40,y:240,width:180,height:30}});
  r.endpoints[0].ancestors=["first"];r.endpoints[1].ancestors=["second"];r.frames.first={x:-40,y:-60};r.frames.second={x:-40,y:240};
  const path=routeGraph(r).paths.edge,gate=path.gates.find(g=>g.owner==="second")!;assert.ok(gate.point.y>278);
  for(const segment of path.segments)assert.equal(segmentIntersectsBox(segment.from,segment.to,{x:-48,y:232,width:196,height:46}),false);
});

test("a sibling port label blocking a lead fails strictly and relaxes only that edge on request",()=>{
  // Stacked east ports: the lower port's caption sits on the upper port's stub.
  const r=fixture();r.obstacles=r.obstacles.filter(o=>o.id!=="obstacle");
  r.obstacles.push({id:"text:a.lower:0",kind:"solid",box:{x:84,y:30,width:60,height:20}});
  r.endpoints.push({id:"a.lower",owner:"a",point:{x:80,y:60},normal:{x:1,y:0},box:null,ancestors:[]},{id:"b.lower",owner:"b",point:{x:400,y:70},normal:{x:-1,y:0},box:null,ancestors:[]});
  r.edges.push({id:"clean",source:"a.lower",target:"b.lower",branchGroup:null,styleKey:"wire"});
  assert.throws(()=>routeGraph(r),(e:unknown)=>e instanceof RoutingFailure&&e.code==="routing.terminal.obstructed"&&e.edgeIds[0]==="edge"&&e.partIds[0]==="text:a.lower:0");
  const result=routeGraph(r,undefined,{degrade:true});
  assert.deepEqual(result.degraded,[{edgeId:"edge",code:"routing.terminal.obstructed",relaxation:"labels"}]);
  for(const id of ["edge","clean"]){const points=result.paths[id].points;assert.ok(points.length>=2);for(let i=1;i<points.length;i++)assert.ok(points[i].x===points[i-1].x||points[i].y===points[i-1].y);}
  // The relaxed edge still avoids real symbols; the untouched edge is identical to its strict route.
  const alone=fixture();alone.obstacles=r.obstacles.filter(o=>o.id!=="text:a.lower:0");alone.endpoints=r.endpoints;alone.edges=r.edges;
  assert.deepEqual(result.paths.clean.points,routeGraph(alone).paths.clean.points);
  validateRoutingResult(result);assert.deepEqual(routeGraph(r,undefined,{degrade:true}),result);
});
test("an enclosed terminal paints a direct orthogonal route and reports the relaxation",()=>{
  const r=fixture();r.obstacles.push({id:"wall",kind:"solid",box:{x:340,y:-200,width:30,height:480}},{id:"cap",kind:"solid",box:{x:340,y:-230,width:400,height:30}},
    {id:"floor",kind:"solid",box:{x:340,y:280,width:400,height:30}},{id:"back",kind:"solid",box:{x:710,y:-230,width:30,height:540}});
  assert.throws(()=>routeGraph(r),RoutingFailure);
  const result=routeGraph(r,undefined,{degrade:true}),points=result.paths.edge.points;
  assert.equal(result.degraded?.length,1);assert.equal(result.degraded![0].edgeId,"edge");assert.equal(result.degraded![0].relaxation,"obstacles");
  assert.deepEqual(points[0],r.endpoints[0].point);assert.deepEqual(points.at(-1),r.endpoints[1].point);
  for(let i=1;i<points.length;i++)assert.ok(points[i].x===points[i-1].x||points[i].y===points[i-1].y);
  validateRoutingResult(result);
});
test("a saved manual route stays a hard constraint and a clean request reports no relaxation",()=>{
  const r=fixture();assert.equal(routeGraph(r,undefined,{degrade:true}).degraded,undefined);
  r.constraints.edge={frame:ROOT_ROUTE_FRAME,waypoints:[{x:220,y:40}]};
  assert.throws(()=>routeGraph(r,undefined,{degrade:true}),(e:unknown)=>e instanceof RoutingFailure&&e.code==="routing.constraint.obstructed");
  const bad=routeGraph(fixture(),undefined,{degrade:true}) as unknown as Record<string,unknown>;bad.degraded=[];
  assert.throws(()=>validateRoutingResult(bad),/Empty routing degradation list/);
  bad.degraded=[{edgeId:"edge",code:"routing.impossible",relaxation:"none"}];assert.throws(()=>validateRoutingResult(bad),/Invalid routing degradation/);
});
