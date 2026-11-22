/** Closed M14 routing/placement data. No semantic selection or routing algorithm. */
import { graphicObject, graphicArray, graphicId, graphicNumber } from "./graphics-contract.ts";
export const ROOT_ROUTE_FRAME = "route:root";
export const MAX_ROUTE_WAYPOINTS = 32;
export const MAX_ROUTED_EDGES = 2048;
export const ROUTING_EXTENT = 1_000_000;
export interface RoutingPolicy {
  algorithm: "orthogonal";
  clearance: number;
  stubLength: number;
  trunks: "none" | "siblings";
}
export interface RoutePoint { x:number; y:number }
export interface RouteConstraint { frame:string; waypoints:RoutePoint[] }
export type LabelPlacement = {kind:"owner";dx:number;dy:number}
  | {kind:"route";fraction:number;tangentOffset:number;normalOffset:number};
/** An explicit migration/authoring default, never an input-deserialization fallback. */
export function defaultRoutingPolicy():RoutingPolicy {
  return {algorithm:"orthogonal",clearance:8,stubLength:18,trunks:"none"};
}
export function validateRoutingPolicy(value:unknown):asserts value is RoutingPolicy {
  const o=graphicObject(value,["algorithm","clearance","stubLength","trunks"],"routing policy");
  graphicNumber(o.clearance);graphicNumber(o.stubLength);
  if(o.algorithm!=="orthogonal" || !["none","siblings"].includes(o.trunks as string)
    || o.clearance<0 || o.clearance>64 || o.stubLength<2 || o.stubLength>128
    || o.stubLength<o.clearance+2)throw Error("Invalid orthogonal routing policy");
}
export function validateRoutePoint(value:unknown):asserts value is RoutePoint {
  const o=graphicObject(value,["x","y"],"route point");graphicNumber(o.x);graphicNumber(o.y);
}
export function validateRouteConstraint(value:unknown):asserts value is RouteConstraint {
  const o=graphicObject(value,["frame","waypoints"],"route constraint");graphicId(o.frame);
  graphicArray(o.waypoints,MAX_ROUTE_WAYPOINTS).forEach(validateRoutePoint);
}
export function validateLabelPlacement(value:unknown):asserts value is LabelPlacement {
  const o=graphicObject(value);
  if(o.kind==="owner") {
    graphicObject(value,["kind","dx","dy"],"owner label placement");graphicNumber(o.dx);graphicNumber(o.dy);
  } else if(o.kind==="route") {
    graphicObject(value,["kind","fraction","tangentOffset","normalOffset"],"route label placement");
    graphicNumber(o.fraction);graphicNumber(o.tangentOffset);graphicNumber(o.normalOffset);
    if(o.fraction<0 || o.fraction>1)throw Error("Invalid full-path label fraction");
  } else throw Error("Invalid label placement kind");
}
