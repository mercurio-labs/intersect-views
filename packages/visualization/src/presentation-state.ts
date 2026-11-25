/** Detached migration and bounded presentation history. Never calls a language host. */
import type { Presentation, GraphPresentation } from "./protocol.ts";
import { validatePresentation, object } from "./validation.ts";
import { own } from "./records.ts";
import { graphicObject } from "./graphics-contract.ts";

export interface PresentationMapping {
  viewKey:string; oldFingerprint:string; oldProjection:string;
  decision:{kind:"compatible" | "compatible-package-upgrade";fingerprint:string;projection:string}|{kind:"reset"};
}
export type PresentationV4={schemaVersion:4;views:Record<string,Omit<GraphPresentation,"symbolOverrides">|import("./protocol.ts").LanePresentation>};
export function validatePresentationV4(value:unknown):asserts value is PresentationV4 {
 const old=structuredClone(value) as any;object(old,["schemaVersion","views"]);if(old.schemaVersion!==4)throw Error("Expected an unmodified v4 presentation");
 for(const v of Object.values<any>(graphicObject(old.views))){if(v.form==="graph"){object(v,["form","positions","viewport","packageFingerprint","projection","routeConstraints","labelPlacements"]);for(const g of Object.values<any>(graphicObject(v.positions)))object(g,["x","y","width","height"]);v.symbolOverrides={};}}old.schemaVersion=5;validatePresentation(old);
}
export function previewPresentationV4(value:unknown,mappings:PresentationMapping[]):{candidate:Presentation;from:4;to:5;resetViews:string[]} {
  validatePresentationV4(value);
  const candidate = structuredClone(value) as unknown as Presentation;
  candidate.schemaVersion = 5;
  if (mappings.length !== Object.keys(candidate.views).length || mappings.length > 128)
    throw Error("Every saved view needs an explicit compatibility or reset decision");
  const seen = new Set<string>();
  const resetViews: string[] = [];
  for (const { viewKey, oldFingerprint, oldProjection, decision } of mappings) {
    if (seen.has(viewKey)) throw Error("Duplicate presentation mapping");
    seen.add(viewKey);
    const view = own(candidate.views, viewKey);
    if (!view || view.packageFingerprint !== oldFingerprint || view.projection !== oldProjection)
      throw Error("Presentation compatibility identity changed");
    if (decision.kind === "reset") {
      delete candidate.views[viewKey];
      resetViews.push(viewKey);
      continue;
    }
    if (view.projection !== decision.projection ||
        (decision.kind !== "compatible-package-upgrade" &&
          (decision.kind !== "compatible" || view.packageFingerprint !== decision.fingerprint)))
      throw Error("Changed package or projection needs an explicit compatibility decision");
    // Only the embedding language can approve an upgrade between exact package
    // identities. A v4 file has no styles, so there are no property keys to map.
    view.packageFingerprint = decision.fingerprint;
    if (view.form === "graph") view.symbolOverrides = {};
  }
  validatePresentation(candidate);
  return { candidate, from: 4, to: 5, resetViews };
}
/** Carry a current-format layout to another package identity. Geometry and
 *  styles are kept as saved; the canvas still checks them against the scene. */
export function previewPresentationPackageUpgrade(value:unknown,mappings:PresentationMapping[]):{candidate:Presentation;from:5;to:5;resetViews:string[]} {
  const candidate = structuredClone(value) as Presentation;
  validatePresentation(candidate);
  if (mappings.length !== Object.keys(candidate.views).length || mappings.length > 128)
    throw Error("Every saved view needs an explicit compatibility or reset decision");
  const seen = new Set<string>();
  const resetViews: string[] = [];
  for (const { viewKey, oldFingerprint, oldProjection, decision } of mappings) {
    if (seen.has(viewKey)) throw Error("Duplicate presentation mapping");
    seen.add(viewKey);
    const view = own(candidate.views, viewKey);
    if (!view || view.packageFingerprint !== oldFingerprint || view.projection !== oldProjection)
      throw Error("Presentation compatibility identity changed");
    if (decision.kind === "reset") {
      delete candidate.views[viewKey];
      resetViews.push(viewKey);
      continue;
    }
    if (view.projection !== decision.projection ||
        (decision.kind === "compatible" && view.packageFingerprint !== decision.fingerprint))
      throw Error("Changed package or projection needs an explicit compatibility decision");
    // Only the embedding language can approve an upgrade between exact package identities.
    view.packageFingerprint = decision.fingerprint;
  }
  validatePresentation(candidate);
  return { candidate, from: 5, to: 5, resetViews };
}
export function previewPresentationV3(value:unknown,mappings:PresentationMapping[]):{candidate:PresentationV4;from:3;to:4;resetViews:string[]} {
  const p=structuredClone(value) as Record<string,unknown>;
  object(p,["schemaVersion","views"]);
  if(p.schemaVersion!==3)throw Error("Expected an unmodified v3 presentation");
  const views=graphicObject(p.views),used=new Set<string>(),resetViews:string[]=[];
  if(mappings.length!==Object.keys(views).length||mappings.length>128)throw Error("Every saved view needs an explicit compatibility or reset decision");
  p.schemaVersion=4;
  // Validate the entire old envelope after adding only the two required fields.
  // A mapping cannot make malformed old content acceptable by dropping that view.
  for(const value of Object.values(views)){
    if((value as {form?:string})?.form==="graph"){
      const v=object(value,["form","positions","viewport","packageFingerprint","projection"]);
      v.routeConstraints={};v.labelPlacements={};
    }
  }
  validatePresentationV4(p);
  for(const mapping of mappings){
    if(used.has(mapping.viewKey))throw Error("Duplicate presentation mapping");used.add(mapping.viewKey);
    const view=own(p.views,mapping.viewKey);
    if(!view||view.packageFingerprint!==mapping.oldFingerprint||view.projection!==mapping.oldProjection)throw Error("Presentation compatibility identity changed");
    if(mapping.decision.kind==="reset"){delete p.views[mapping.viewKey];resetViews.push(mapping.viewKey);}
    else if(mapping.decision.kind==="compatible"){
      view.packageFingerprint=mapping.decision.fingerprint;view.projection=mapping.decision.projection;
    }else throw Error("Unsupported presentation compatibility decision");
  }
  validatePresentationV4(p);return {candidate:p as unknown as PresentationV4,from:3,to:4,resetViews};
}

export type PlacementState=Pick<GraphPresentation,"routeConstraints"|"labelPlacements">;
interface Entry {before:PlacementState;after:PlacementState}
export class PresentationHistory {
  private entries:Entry[]=[];
  private cursor=0;
  private fingerprint:string;
  private projection:string;
  constructor(view:GraphPresentation){this.fingerprint=view.packageFingerprint;this.projection=view.projection;}
  private check(view:GraphPresentation){
    if(view.packageFingerprint!==this.fingerprint||view.projection!==this.projection)throw Error("Presentation history context changed; reset it explicitly");
  }
  private snapshot(view:GraphPresentation):PlacementState{return structuredClone({routeConstraints:view.routeConstraints,labelPlacements:view.labelPlacements});}
  apply(view:GraphPresentation,next:PlacementState):void {
    this.check(view);
    const candidate={...structuredClone(view),...structuredClone(next)};
    validatePresentation({schemaVersion:5,views:{candidate}});
    const before=this.snapshot(view),after=this.snapshot(candidate);
    if(JSON.stringify(before)===JSON.stringify(after))return;
    this.entries.splice(this.cursor);this.entries.push({before,after});
    if(this.entries.length>64)this.entries.shift();this.cursor=this.entries.length;
    view.routeConstraints=after.routeConstraints;view.labelPlacements=after.labelPlacements;
  }
  undo(view:GraphPresentation):boolean {
    this.check(view);if(this.cursor===0)return false;
    const state=structuredClone(this.entries[this.cursor-1].before);
    view.routeConstraints=state.routeConstraints;view.labelPlacements=state.labelPlacements;this.cursor--;return true;
  }
  redo(view:GraphPresentation):boolean {
    this.check(view);if(this.cursor===this.entries.length)return false;
    const state=structuredClone(this.entries[this.cursor].after);
    view.routeConstraints=state.routeConstraints;view.labelPlacements=state.labelPlacements;this.cursor++;return true;
  }
  get canUndo(){return this.cursor>0;}
  get canRedo(){return this.cursor<this.entries.length;}
}
