/** M9 lane contracts in the strict version 5 scene/rule unions. */
import type {
  Binding,
  Label,
  Palette,
  Scope,
  View,
  LabelRule,
} from "./protocol.ts";

export interface SemanticAxis {
  direction: "horizontal" | "vertical";
  semantic: true;
}
export interface Lane {
  id: string;
  rule: string;
  label: Label;
  binding: Binding;
  container: string;
}
export interface LaneStep {
  id: string;
  rule: string;
  label: Label;
  binding: Binding;
  lane: string;
  rank: number;
  unordered: boolean;
  predecessors: string[];
}
export interface LaneSpan {
  id: string;
  step: string;
  end: string;
  lanes: string[];
}
export interface LaneGraphScene {
  schemaVersion: 7;
  form: "laneGraph";
  ruleSet: string;
  revision: number;
  view: View;
  palette: Palette;
  problems: string[];
  axis: SemanticAxis;
  lanes: Lane[];
  /** Combined selector order; `order` contains the stable topological order. */
  steps: LaneStep[];
  spans: LaneSpan[];
  order: string[];
}
export interface LaneTargetsRequest {
  revision: number;
  viewKey: string;
  toolId: string;
  step: string;
  lane: string;
  before: string | null;
  end: string | null;
  scope?: Scope;
  palette?: Palette;
}
export interface LaneTargetResponse {
  revision: number;
  viewKey: string;
  toolId: string;
  step: string;
  lane: string;
  before: string | null;
  end: string | null;
  enabled: boolean;
  reason: string;
}

export interface LaneGraphRuleSet {
  schemaVersion: 8;
  projection: import("./rendering.ts").ProjectionPolicy;
  form: "laneGraph";
  id: string;
  label: string;
  language: string;
  laneGraph: {
    container: { match: string; lanes: string; steps: string };
    lane: { id: string; label: LabelRule };
    step: {
      id: string;
      label: LabelRule;
      lane: string;
      after: string;
      end: string;
      across: string;
    };
    axis: SemanticAxis;
    edit?: { tool: string; command: string; accepts: string };
  };
}
