/** A detached route/label gesture. Preview never mutates the saved presentation. */
import type { GraphPresentation,Point } from "./protocol.ts";
import type { LabelPlacement,RouteConstraint } from "./routing-contract.ts";
import { validatePresentation } from "./validation.ts";
import { PresentationHistory,type PlacementState } from "./presentation-state.ts";
import { own,put } from "./records.ts";

export type PlacementMode={kind:"route";id:string;frame:string}|{kind:"label";id:string;frame:"owner"|"route"};
export class PlacementEditor {
  readonly mode:PlacementMode;
  private original:string;
  private fingerprint:string;
  private projection:string;
  private draft:PlacementState;
  private active=true;
  constructor(view:GraphPresentation,mode:PlacementMode){
    this.mode={...mode};this.fingerprint=view.packageFingerprint;this.projection=view.projection;
    this.draft=structuredClone({routeConstraints:view.routeConstraints,labelPlacements:view.labelPlacements});this.original=JSON.stringify(this.draft);
  }
  preview(view:GraphPresentation):GraphPresentation {
    this.check(view);const candidate={...structuredClone(view),...structuredClone(this.draft)};
    validatePresentation({schemaVersion:4,views:{candidate}});return candidate;
  }
  private check(view:GraphPresentation){
    if(!this.active||view.packageFingerprint!==this.fingerprint||view.projection!==this.projection||JSON.stringify({routeConstraints:view.routeConstraints,labelPlacements:view.labelPlacements})!==this.original)throw Error("Placement gesture context changed");
  }
  get route():RouteConstraint|undefined{return structuredClone(own(this.draft.routeConstraints,this.mode.id));}
  get label():LabelPlacement|undefined{return structuredClone(own(this.draft.labelPlacements,this.mode.id));}
  setRoute(view:GraphPresentation,points:Point[]) {
    if(this.mode.kind!=="route")throw Error("Route edit mode is not active");
    const next=structuredClone(this.draft);put(next.routeConstraints,this.mode.id,{frame:this.mode.frame,waypoints:structuredClone(points)});
    this.set(view,next);
  }
  setLabel(view:GraphPresentation,placement:LabelPlacement){
    if(this.mode.kind!=="label"||this.mode.frame!==placement.kind)throw Error("Label edit frame changed");
    const next=structuredClone(this.draft);put(next.labelPlacements,this.mode.id,structuredClone(placement));this.set(view,next);
  }
  reset(view:GraphPresentation){
    const next=structuredClone(this.draft);delete (this.mode.kind==="route"?next.routeConstraints:next.labelPlacements)[this.mode.id];this.set(view,next);
  }
  private set(view:GraphPresentation,next:PlacementState){
    this.check(view);validatePresentation({schemaVersion:4,views:{candidate:{...view,...next}}});this.draft=next;
  }
  accept(view:GraphPresentation,history:PresentationHistory){this.check(view);history.apply(view,this.draft);this.active=false;}
  cancel(){this.active=false;}
}
