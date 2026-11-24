import type { RoutingPolicy, RouteConstraint, LabelPlacement } from "./routing-contract.ts";
export type { RoutingPolicy, RoutePoint, RouteConstraint, LabelPlacement } from "./routing-contract.ts";
import { own } from "./records.ts";
import type { GraphicInstance, GraphicRule, TextBlock, PresentationContext } from "./graphics-contract.ts";
export type { GraphicInstance, GraphicRule, TextBlock, PresentationContext } from "./graphics-contract.ts";
/** Intersect visualization client. package.
 * Language-neutral protocol mirrored from intersect-views. No SysML imports. */
export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}
export interface Binding {
  key: string;
  elementId: string;
  context: string[];
  uri: string;
  range: Range;
  readOnly: boolean;
}
export interface Owner {
  key: string;
  label: string;
}
export interface View {
  key: string;
  name: string;
  kind: string;
  binding: Binding;
  owners: Owner[];
  details: Field[];
  problems: string[];
}
export interface Field {
  label: string;
  binding: Binding;
}
export interface Compartment {
  id: string;
  label: string;
  rows: Row[];
}
export interface Row {
  id: string;
  label: Label;
  binding: Binding;
}
export interface Port {
  graphic: GraphicInstance | null;
  text: Record<string, TextBlock>;
  id: string;
  rule: string;
  label: Label;
  side: string;
  binding: Binding;
}
export interface Node {
  graphic: GraphicInstance | null;
  text: Record<string, TextBlock>;
  id: string;
  rule: string;
  styleClass: string;
  expand: ExpandOption[];
  collapsed: boolean;
  notation: string;
  title: Label;
  subtitle: Label;
  binding: Binding;
  compartments: Compartment[];
  children: Node[];
  regions: RegionSet | null;
  ports: Port[];
}
export interface Edge {
  startMarker: GraphicInstance | null;
  endMarker: GraphicInstance | null;
  text: Record<string, TextBlock>;
  id: string;
  rule: string;
  styleClass: string;
  notation: string;
  label: Label;
  source: string;
  target: string;
  branchGroup: string | null;
  binding: Binding;
}
export interface Tool {
  id: string;
  label: string;
  icon: string;
  gesture: "select" | "place" | "action";
  command: string;
  parameters: Record<string, unknown>;
  inputs: { id: string; label: string; default: string }[];
}
export interface Palette {
  schemaVersion: 1;
  id: string;
  label: string;
  groups: { id: string; label: string; entries: Tool[] }[];
}
export interface EndpointProxy { id:string;displayOwner:string;binding:Binding;label:Label }
export interface GraphScene {
  schemaVersion: 7;
  form: "graph";
  ruleSet: string;
  revision: number;
  layout: LayoutHints;
  routing: RoutingPolicy;
  endpointProxies: EndpointProxy[];
  view: View;
  nodes: Node[];
  edges: Edge[];
  palette: Palette;
  problems: string[];
}
export interface SceneResponse {
  presentation: PresentationContext;
  scene: Scene;
  capabilities: { toolId: string; enabled: boolean; reason: string }[];
}
export interface SourcePatch {
  uri: string;
  range: Range;
  original: string;
  replacement: string;
  beforeHash: string;
  afterHash: string;
}
export interface PreparedEdit {
  schemaVersion: 1;
  token: string;
  baseRevision: number;
  nextRevision: number;
  patches: SourcePatch[];
  created: string;
}
export interface TargetResponse {
  revision: number;
  viewKey: string;
  toolId: string;
  source: string | null;
  symbols: string[];
}
export interface Rejection {
  code: string;
  message: string;
  feature?: string;
  elementKey?: string;
}
export interface Point {
  x: number;
  y: number;
}
export interface Geometry extends Point {
  width: number;
  height: number;
}
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
export interface SavedPosition {x:number;y:number;width?:number;height?:number}
export interface GraphPresentation {
  packageFingerprint: string;
  projection: string;
  form: "graph";
  positions: Record<string, SavedPosition>;
  symbolOverrides: import("./symbol-properties-contract.ts").SymbolOverrides;
  routeConstraints: Record<string, RouteConstraint>;
  labelPlacements: Record<string, LabelPlacement>;
  viewport: Viewport;
}
export interface LanePresentation {
  packageFingerprint: string;
  projection: string;
  form: "laneGraph";
  laneOrder: string[];
  viewport: Viewport;
}
export interface Presentation {
  schemaVersion: 5;
  views: Record<string, GraphPresentation | LanePresentation>;
}
export function graphPresentation(
  p: Presentation,
  key: string,
): GraphPresentation | undefined {
  const saved = own(p.views, key);
  if (saved && saved.form !== "graph")
    throw Error("Saved view form changed; export or reset its layout");
  return saved;
}
export interface Layout {
  revision: number;
  viewKey: string;
  nodes: Record<string, Geometry>;
  ports: Record<string, Point>;
  edges: Record<string, Point[]>;
  regions: Record<string, Geometry>;
  minimum: Record<string, { width: number; height: number }>;
  preferred?:Record<string,{width:number;height:number}>;
  routing?: import("./routing.ts").RoutingResult;
  outsets?:Record<string,{left:number;top:number;right:number;bottom:number}>;
}

/** Rendering/style definitions are independent from palette definitions. */
import type { NotationProfile } from "./notation.ts";
export type { NotationProfile } from "./notation.ts";
export { validateNotation } from "./notation.ts";
export const defaultNotation: NotationProfile = {
  schemaVersion: 1,
  id: "intersect.standard-structure",
  shapes: {
    definition: { shape: "rectangle", fill: "definition", stroke: "neutral" },
    usage: { shape: "rectangle", fill: "usage", stroke: "neutral" },
    structure: {
      shape: "rounded",
      fill: "usage",
      stroke: "neutral",
      radius: 5,
    },
    package: { shape: "rectangle", fill: "package", stroke: "neutral" },
  },
};

export function parsePresentation(text: string): Presentation {
  const p: unknown = JSON.parse(text);
  validatePresentation(p);
  return p;
}
import { validatePresentation } from "./validation.ts";
export {
  validateScene,
  validateSceneResponse,
  validateScope,
  validateViewDocument,
  validateRuleSet,
  validatePresentation,
  validateTargets,
} from "./validation.ts";

export interface ExpandOption {
  id: string;
  label: string;
}
export interface LayoutHints {
  strategy: "layered" | "outline" | "sequence";
  direction: "RIGHT" | "LEFT" | "UP" | "DOWN";
}
export interface Scope {
  schemaVersion: 1;
  ops: ScopeOp[];
}
export type ScopeOp =
  | { op: "addSeed" | "hide" | "removeSeed"; element: string }
  | { op: "expand"; element: string; relation: string; hops: number }
  | { op: "collapse"; element: string; context: string[] };
export interface ViewDocument {
  schemaVersion: 1;
  key: string;
  name: string;
  ruleSet: string;
  scope: Scope;
}
export type Slot = string | { text: string } | {sourceText:true};
export interface SymbolRule {
  graphic?: GraphicRule;
  id: string;
  match: string;
  emit: "node" | "port";
  notation?: string;
  title?: LabelRule;
  subtitle?: LabelRule;
  label?: LabelRule;
  side?: Slot;
  styleClass?: Slot;
  compartments?: { id: string; label: string; rows: string; rowLabel: LabelRule }[];
  ports?: { select: string; rule: string };
  children?: { select: string };
  regions?: RegionRule;
  expand?: { id: string; label: string; select: string }[];
  create?: { tool: string; command: string; accepts: string }[];
}
export type EdgeRule = {
  startMarker?: GraphicRule;
  endMarker?: GraphicRule;
  id: string;
  per: string;
  notation: string;
  label: LabelRule;
  anchor: "owner" | "root";
  rootOnly?: boolean;
  connect?: { command: string; sourceAccepts: string; targetAccepts: string };
} & (
  | { kind: "element"; select: string; sourcePath: string; targetPath: string }
  | { kind: "reference"; targets: string }
);
export interface GraphRuleSet {
  schemaVersion: 8;
  projection: import("./rendering.ts").ProjectionPolicy;
  id: string;
  label: string;
  language: string;
  form: "graph";
  layout: LayoutHints;
  routing: RoutingPolicy;
  symbols: SymbolRule[];
  edges: EdgeRule[];
}

export interface AxisEntry {
  id: string;
  label: string;
  binding: Binding;
}
export type GridScalar = "string" | "integer" | "boolean" | "reference";
export interface ProjectionColumn {
  id: string;
  label: string;
  scalar: GridScalar;
  many: boolean;
}
export type GridValue =
  | { kind: "string"; value: string }
  | { kind: "integer"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "reference"; label: string; binding: Binding }
  | { kind: "list"; items: GridValue[] };
export interface GridMember {
  id: string;
  label: string;
  binding: Binding;
}
export interface GridCell {
  id: string;
  row: string;
  column: string;
  origin: "query" | "relation" | "derived";
  value: GridValue;
  binding: Binding;
  members: GridMember[];
}
export type Grid =
  | {
      kind: "table";
      rows: AxisEntry[];
      columns: ProjectionColumn[];
      cells: GridCell[];
    }
  | {
      kind: "matrix";
      rows: AxisEntry[];
      columns: AxisEntry[];
      cells: GridCell[];
    };
export interface GridScene {
  schemaVersion: 7;
  form: "grid";
  ruleSet: string;
  revision: number;
  view: View;
  palette: Palette;
  problems: string[];
  grid: Grid;
}
export type Scene = GraphScene | GridScene | LaneGraphScene;
export type GraphSceneResponse = Omit<SceneResponse, "scene"> & {
  scene: GraphScene;
};
export type GridSceneResponse = Omit<SceneResponse, "scene"> & {
  scene: GridScene;
};
export interface GridTargetResponse {
  revision: number;
  viewKey: string;
  toolId: string;
  row: string;
  column: string;
  member: string | null;
  enabled: boolean;
  reason: string;
}
export type QueryExpression =
  | { op: "field" | "count"; path: string }
  | { op: "literal"; value: unknown };
export type QueryPredicate =
  | { op: "is_null"; expression: QueryExpression }
  | {
      op: "compare";
      left: QueryExpression;
      comparison: "eq" | "ne" | "lt" | "le" | "gt" | "ge";
      right: QueryExpression;
    }
  | { op: "and" | "or"; predicates: QueryPredicate[] }
  | { op: "not"; predicate: QueryPredicate }
  | { op: "any" | "all"; path: string; predicate: QueryPredicate };
export interface GridQuery {
  from: string;
  select: { name: string; expression: QueryExpression }[];
  filter?: QueryPredicate | null;
  order_by?: { expression: QueryExpression; descending?: boolean }[];
}
export interface GridAxisRule {
  query: GridQuery;
  label: string;
}
export interface GridCellRule {
  related: string;
  members?: { select: string; column: string; label: string };
  edit?: {
    create?: {
      tool: string;
      command: string;
      rowAccepts: string;
      columnAccepts: string;
    };
    delete?: { tool: string; command: string; accepts: string };
  };
}
export interface GridRuleSet {
  schemaVersion: 8;
  projection: import("./rendering.ts").ProjectionPolicy;
  id: string;
  label: string;
  language: string;
  form: "grid";
  grid:
    | {
        kind: "table";
        query: GridQuery;
        rowLabel: string;
        columns: { id: string; label: string; value: string }[];
      }
    | {
        kind: "matrix";
        rows: GridAxisRule;
        columns: GridAxisRule;
        cells: GridCellRule;
      };
}
export type RuleSet = GraphRuleSet | GridRuleSet | LaneGraphRuleSet;
export { validateGridTargets } from "./grid-validation.ts";

export interface Label {
  parts: LabelPart[];
}
export interface LabelPart {
  id: string;
  text: string;
  binding: Binding | null;
  editTool: string | null;
}
export interface RegionSet {
  direction: "row" | "column";
  items: Region[];
}
export interface Region {
  id: string;
  rule: string;
  label: Label;
  binding: Binding;
  collapsed: boolean;
  children: Node[];
}
export type LabelRule = Slot | { parts: PartRule[] };
export interface PartRule {
  id: string;
  subject:
    | { kind: "self" }
    | { kind: "none" }
    | { kind: "select"; select: string };
  text: Slot;
  when?: string;
  edit?: { tool: string; command: string; accepts: string };
}
export interface RegionRule {
  id: string;
  select: string;
  label: LabelRule;
  children: { select: string };
  direction: "row" | "column";
}
export interface LabelTargetResponse {
  revision: number;
  viewKey: string;
  toolId: string;
  part: string;
  enabled: boolean;
  reason: string;
}
export function labelText(label: Label): string {
  return label.parts.map((p) => p.text).join("");
}

export { validateLabelTargets } from "./graph-validation.ts";

import type { LaneGraphScene, LaneGraphRuleSet } from "./lane-protocol.ts";
export type * from "./lane-protocol.ts";

export { validateRenderingResolution, validateRenderingRegistry, migrateRulesV6 } from "./rendering.ts";
export type { ProjectionPolicy, RenderingResolution, RenderingSelection, RenderingRegistry } from "./rendering.ts";
