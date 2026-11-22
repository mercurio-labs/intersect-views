/** Strict, language-neutral M13 rendering contracts. */
import type { Binding, GraphRuleSet, RuleSet } from "./protocol.ts";
import { object, text, list, integer, binding, validateRuleSet } from "./validation.ts";
import { graphicId } from "./graphics-contract.ts";
import { defaultRoutingPolicy } from "./routing-contract.ts";
export type ProjectionPolicy = { kind: "nested" } | { kind: "containmentTree"; edgeRole: string; edgeNotation: string };
export interface RenderingRegistry { schemaVersion: 1; id: string; registrations: {id:string;ruleSetId:string;projectionPolicy:ProjectionPolicy}[] }
export interface RenderingSelection { registrationId:string;ruleSetId:string;packageFingerprint:string;projectionPolicy:ProjectionPolicy;origin:"explicit"|"inherited"|"default";originBinding:Binding;canonicalRendering:Binding|null }
export interface RenderingResolution { schemaVersion:1;revision:number;viewKey:string;status:"resolved"|"unsupported"|"unmanaged";selection:RenderingSelection|null;diagnostics:{code:string;message:string;binding:Binding}[] }
function registrationId(value:unknown): asserts value is string { graphicId(value);if(!value.includes(".") || value.split(".").some(p=>!p))throw Error("Unqualified rendering registration"); }
export function validateProjection(value:unknown, graph:boolean): asserts value is ProjectionPolicy {
  const p=object(value,["kind"], ["edgeRole","edgeNotation"]);
  if(p.kind==="nested") object(value,["kind"]);
  else if(p.kind==="containmentTree" && graph) {object(value,["kind","edgeRole","edgeNotation"]);graphicId(p.edgeRole);graphicId(p.edgeNotation);}
  else throw Error("Unsupported projection policy");
}
export function migrateRulesV6(value:unknown): RuleSet {
  const p=structuredClone(value) as Record<string,unknown>;
  if(!p || p.schemaVersion!==6 || "projection" in p) throw Error("Expected an unmodified v6 rule envelope");
  p.schemaVersion=7;p.projection={kind:"nested"};return previewRulesV7(p).candidate;
}
/** A detached candidate: the caller must review package compatibility before saving. */
export function previewRulesV7(value:unknown): {candidate:RuleSet;from:7;to:8;routingAdded:boolean;packageCompatibilityReviewRequired:true} {
  const p=structuredClone(value) as Record<string,unknown>;
  if(!p || p.schemaVersion!==7 || "routing" in p)throw Error("Expected an unmodified v7 rule envelope");
  const routingAdded=p.form==="graph";
  p.schemaVersion=8;
  if(routingAdded)p.routing=defaultRoutingPolicy();
  validateRuleSet(p);
  return {candidate:p,from:7,to:8,routingAdded,packageCompatibilityReviewRequired:true};
}
export function validateRenderingRegistry(value:unknown,rules:GraphRuleSet[]): asserts value is RenderingRegistry {
 const v=object(value,["schemaVersion","id","registrations"]);graphicId(v.id);
 const registrations=list(v.registrations),ids=new Set<string>();
 if(v.schemaVersion!==1 || !registrations.length || registrations.length>128)throw Error("Unsupported rendering registry version/limit");
 for(const entry of registrations){const r=object(entry,["id","ruleSetId","projectionPolicy"]);registrationId(r.id);graphicId(r.ruleSetId);validateProjection(r.projectionPolicy,true);
 if(ids.has(r.id))throw Error("Duplicate/unqualified rendering registration");ids.add(r.id);
 const rule=rules.find(rule=>rule.id===r.ruleSetId);if(!rule || JSON.stringify(Object.entries(rule.projection).sort())!==JSON.stringify(Object.entries(r.projectionPolicy).sort()))throw Error("Missing rule or incompatible projection policy");
 }
}
export function validateRenderingResolution(value:unknown): asserts value is RenderingResolution {
 const v=object(value,["schemaVersion","revision","viewKey","status","selection","diagnostics"]);
 integer(v.revision);text(v.viewKey,true);const diagnostics=list(v.diagnostics);
 if(v.schemaVersion!==1 || !["resolved","unsupported","unmanaged"].includes(v.status as string) || diagnostics.length>32 || (v.status==="resolved")!==(v.selection!==null) || (v.status==="unsupported")!==(diagnostics.length>0))throw Error("Invalid rendering resolution status/version/limit");
 if(v.selection!==null){const s=object(v.selection,["registrationId","ruleSetId","packageFingerprint","projectionPolicy","origin","originBinding","canonicalRendering"]);
 registrationId(s.registrationId);graphicId(s.ruleSetId);validateProjection(s.projectionPolicy,true);binding(s.originBinding);
 if(typeof s.packageFingerprint!=="string" || !/^[a-f0-9]{64}$/.test(s.packageFingerprint) || !["explicit","inherited","default"].includes(s.origin as string) || (s.origin==="default")!==(s.canonicalRendering===null))throw Error("Invalid rendering selection");
 if(s.canonicalRendering!==null)binding(s.canonicalRendering);
 }
 for(const item of diagnostics){const d=object(item,["code","message","binding"]);graphicId(d.code);text(d.message);if(!d.message.length || new TextEncoder().encode(d.message).length>4096)throw Error("Rendering diagnostic message limit");binding(d.binding);}
}
