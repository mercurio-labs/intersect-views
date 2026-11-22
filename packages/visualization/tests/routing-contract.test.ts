import test from "node:test";
import assert from "node:assert/strict";
import {defaultRoutingPolicy,validateRoutingPolicy,validateRouteConstraint,validateLabelPlacement} from "../src/routing-contract.ts";
test("routing policy is closed and bounds actual clearance/stub dependencies",()=>{
  validateRoutingPolicy(defaultRoutingPolicy());
  validateRoutingPolicy({algorithm:"orthogonal",clearance:64,stubLength:66,trunks:"siblings"});
  for(const value of [
    {algorithm:"spline",clearance:8,stubLength:18,trunks:"none"},
    {algorithm:"orthogonal",clearance:8,stubLength:18},
    {...defaultRoutingPolicy(),callback:"code"},
    {...defaultRoutingPolicy(),clearance:65},
    {...defaultRoutingPolicy(),stubLength:9},
    {...defaultRoutingPolicy(),clearance:NaN},
    {...defaultRoutingPolicy(),stubLength:Infinity},
  ])assert.throws(()=>validateRoutingPolicy(value));
});
test("manual waypoints cannot replace terminals or exceed their bounded frame",()=>{
  const waypoints=Array.from({length:32},(_,i)=>({x:i,y:i+2}));
  validateRouteConstraint({frame:"route:root",waypoints});
  for(const value of [
    {frame:"route:root",waypoints:[...waypoints,{x:0,y:0}]},
    {frame:"route:root",waypoints:[],source:"replacement"},
    {frame:"route:root",waypoints:[{x:1_000_001,y:0}]},
    {frame:"bad\nframe",waypoints:[]},
  ])assert.throws(()=>validateRouteConstraint(value));
});
test("labels use a logical owner or full-path frame and reject mixed forms",()=>{
  validateLabelPlacement({kind:"owner",dx:-20,dy:30});
  validateLabelPlacement({kind:"route",fraction:1,tangentOffset:12,normalOffset:-5});
  for(const value of [
    {kind:"owner",dx:1,dy:2,fraction:0.5},
    {kind:"route",fraction:0.5,normalOffset:2},
    {kind:"nearbySegment",fraction:0.5},
    {kind:"route",fraction:1.01,tangentOffset:0,normalOffset:0},
    {kind:"owner",dx:Infinity,dy:0},
  ])assert.throws(()=>validateLabelPlacement(value));
});
