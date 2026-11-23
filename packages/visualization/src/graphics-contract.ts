import {validateProperties,validateStyle,evaluatedStyle,checkPropertyValue,type SymbolProperty,type GraphicStyle,type SymbolOverrides,validateSymbolOverrides} from "./symbol-properties-contract.ts";
import { slot as validateStringSlot } from "./validation.ts";
/** M12 checked graphical vocabulary, mirrored by intersect-views/graphics.rs. */
export type GraphicValue = boolean | number | string;
export type ParameterType =
  | { kind: "string"; default: string }
  | { kind: "bool"; default: boolean }
  | { kind: "number"; default: number }
  | { kind: "choice"; values: string[]; default: string };
export type ValueExpression = { kind: "constant"; value: GraphicValue } | { kind: "parameter"; name: string };
export type NumericExpression = number | { op: "parameter"; name: string } | { op: "width" } | { op: "height" } | {op:"slotWidth";slot:string} | {op:"slotHeight";slot:string} | {op:"select";condition:BooleanExpression;ifTrue:NumericExpression;ifFalse:NumericExpression} | { op: "add" | "subtract" | "multiply" | "divide" | "min" | "max"; left: NumericExpression; right: NumericExpression };
export type BooleanExpression = boolean | { op: "parameter"; name: string } | { op: "equal"; name: string; value: GraphicValue };
export type Paint = string | { parameter: string };
export type GraphicRole = "node" | "port" | "marker";
export type ContentType = "text" | "compartments" | "children" | "regions";
export type ContentSource = { kind: "title" | "subtitle" | "label" | "compartments" | "children" | "regions" } | { kind: "text"; name: string };
export interface GraphicInstance {
  definition: string;
  parameters: Record<string, GraphicValue>;
  sourceParameters?:string[];
  slots: Record<string, ContentSource>;
}
export interface SymbolLibrary { schemaVersion: 1; id: string; imports: string[]; definitions: SymbolDefinition[] }
export interface SymbolDefinition {
  id: string;
  version: string;
  role: GraphicRole;
  parameters: Record<string, ParameterType>;
  slots: Record<string, ContentType>;
  size?: GraphicSize;
  properties?:SymbolProperty[];
  root: GraphicPart;
  connectionAnchor: string | null;
}
export interface GraphicSize { minimumWidth:NumericExpression; preferredWidth:NumericExpression; minimumHeight:NumericExpression; preferredHeight:NumericExpression }
export type GraphicDash = "solid" | "dashed" | "dotted";
export interface GraphicPart { id: string; when: BooleanExpression | null; anchors: GraphicAnchor[]; content: GraphicContent; style?:GraphicStyle }
export interface GraphicAnchor { id: string; x: NumericExpression; y: NumericExpression; dx: NumericExpression; dy: NumericExpression }
export type Alignment = "start" | "center" | "end";
export type GraphicContent =
  | { kind: "frame"; padding: number; radius: number; fill: Paint; stroke: Paint; strokeWidth: number; dash?:GraphicDash; children: GraphicPart[] }
  | { kind: "stack"; direction: "row" | "column"; align: Alignment; gap: number; children: GraphicPart[] }
  | { kind: "overlay"; children: GraphicPart[] }
  | { kind: "geometry"; geometry: GraphicGeometry; fill: Paint; stroke: Paint; strokeWidth: number; dash?:GraphicDash }
  | { kind: "text"; slot: string; size: number; weight: number; italic: boolean; align: Alignment; wrap: boolean; color: Paint }
  | { kind: "content"; slot: string }
  | { kind: "use"; definition: string; parameters: Record<string, ValueExpression>; slots: Record<string, string> }
  | { kind: "transform"; x: NumericExpression; y: NumericExpression; rotate: NumericExpression; scaleX: NumericExpression; scaleY: NumericExpression; child: GraphicPart };
export type GraphicGeometry =
  | { kind: "rectangle"; width: NumericExpression; height: NumericExpression; radius: number }
  | { kind: "ellipse"; width: NumericExpression; height: NumericExpression }
  | { kind: "polyline"; width: NumericExpression; height: NumericExpression; points: { x: NumericExpression; y: NumericExpression }[]; closed: boolean }
  | { kind: "path"; width: NumericExpression; height: NumericExpression; commands: PathCommand[] };
export type PathCommand =
  | { kind: "move"; x: NumericExpression; y: NumericExpression }
  | { kind: "line"; x: NumericExpression; y: NumericExpression }
  | { kind: "quadratic"; cx: NumericExpression; cy: NumericExpression; x: NumericExpression; y: NumericExpression }
  | { kind: "cubic"; cx1: NumericExpression; cy1: NumericExpression; cx2: NumericExpression; cy2: NumericExpression; x: NumericExpression; y: NumericExpression }
  | { kind: "close" };
export interface PresentationContext { fingerprint: string; libraries: SymbolLibrary[] }
import type { LabelPart, LabelRule, Slot, Scene } from "./protocol.ts";
import { label, labelRule } from "./graph-validation.ts";
export interface TextBlock { runs: { id: string; parts: LabelPart[] }[] }
export interface GraphicRule {
  definition: string;
  parameters: Record<string, { kind: "constant"; value: GraphicValue } | { kind: "string"; value: Slot } | { kind: "bool"; function: string }>;
  slots: Record<string, ContentSource>;
  text: Record<string, { runs: { id: string; label: LabelRule }[] }>;
}
export const BUILTIN_PRESENTATION = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const builtinPresentation = (): PresentationContext => ({ fingerprint: BUILTIN_PRESENTATION, libraries: [] });
export function validateGraphicInstance(value: unknown): asserts value is GraphicInstance {
  const v=optionalObject(value,["definition","parameters","slots"],["sourceParameters"]);graphicId(v.definition);
  const parameters=graphicObject(v.parameters),slots=graphicObject(v.slots);
  if(Object.keys(parameters).length>32||Object.keys(slots).length>32)throw Error("Graphic instance argument limit");
  if(v.sourceParameters!==undefined){const source=graphicArray(v.sourceParameters,32);source.forEach(graphicId);if(new Set(source).size!==source.length||source.some(n=>typeof n!=="string"||!Object.hasOwn(parameters,n)))throw Error("Invalid source parameter provenance");}
  for(const [key,v] of Object.entries(parameters)){graphicId(key);scalar(v);if(typeof v==="string"&&!accepts({kind:"string",default:""},v))throw Error("Invalid graphical String value");}
  for(const [key,v] of Object.entries(slots)){graphicId(key);validateContentSource(v);}
}
export function validateTextBlock(value: unknown, owner: unknown, add: (id: unknown, endpoint: boolean) => void): { parts: number; bytes: number } {
  const block = graphicObject(value, ["runs"]);
  let parts = 0, bytes = 0;
  const runs = new Set<string>();
  for (const r of graphicArray(block.runs, 64)) {
    const run = graphicObject(r, ["id", "parts"]); graphicId(run.id);
    if (runs.has(run.id)) throw Error("Duplicate local text run ID"); runs.add(run.id);
    const ps = graphicArray(run.parts, 32);
    for (const v of ps) {
      const p = graphicObject(v, ["id", "text", "binding", "editTool"]);
      graphicId(p.id);if(runs.has(p.id))throw Error("Duplicate TextBlock logical part");runs.add(p.id);
      if (typeof p.text !== "string" || /[\r\t]/u.test(p.text) || p.editTool !== null) throw Error("Invalid TextBlock text/edit");
      bytes += new TextEncoder().encode(p.text).length;
    }
    parts += label({ parts: ps.map((v) => ({ ...(v as LabelPart), text: (v as LabelPart).text.replaceAll("\n", " ") })) }, owner, add, new Set());
  }
  return { parts, bytes };
}
export function validateGraphicRule(value: unknown): asserts value is GraphicRule {
  const v = graphicObject(value, ["definition", "parameters", "slots", "text"]); graphicId(v.definition);
  const params = graphicObject(v.parameters), slots = graphicObject(v.slots), blocks = graphicObject(v.text);
  if ([params, slots, blocks].some((m) => Object.keys(m).length > 32)) throw Error("Graphic rule argument limit");
  for (const [key, value] of Object.entries(params)) {
    graphicId(key); const p = graphicObject(value);
    if (p.kind === "constant") { graphicObject(p, ["kind", "value"]); scalar(p.value); if (typeof p.value === "string" && !accepts({kind:"string",default:""},p.value)) throw Error("Invalid String constant"); }
    else if (p.kind === "bool") { graphicObject(p, ["kind", "function"]); graphicId(p.function); }
    else if (p.kind === "string") {
      graphicObject(p, ["kind", "value"]);
      validateStringSlot(p.value);
    }
    else throw Error("Unknown graphic parameter rule");
  }
  for (const [key, value] of Object.entries(slots)) { graphicId(key); const s = validateContentSource(value); if (s.kind === "text" && !Object.hasOwn(blocks, s.name)) throw Error("Missing text block rule"); }
  for (const [key, value] of Object.entries(blocks)) {
    graphicId(key); const b = graphicObject(value, ["runs"]), ids = new Set<string>();
    for (const value of graphicArray(b.runs, 64)) {
      const run = graphicObject(value, ["id", "label"]); graphicId(run.id);
      if (ids.has(run.id)) throw Error("Duplicate text run ID"); ids.add(run.id);
      const normalized = JSON.parse(JSON.stringify(run.label), (key, v) => key === "text" && typeof v === "string" ? v.replaceAll("\r\n", "\n").replaceAll("\n", " ") : v);
      if (labelRule(normalized).length) throw Error("TextBlock edits require existing Label targets");
    }
  }
}
export function validatePresentationContext(input: unknown, scene: Scene): asserts input is PresentationContext {
  const v = graphicObject(input, ["fingerprint", "libraries"]);
  if (typeof v.fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(v.fingerprint)) throw Error("Invalid presentation fingerprint");
  const definitions = new GraphicDefinitions(graphicArray(v.libraries, 64));
  let parts = 0, commands = 0;
  const instance = (value: GraphicInstance | null, role: GraphicRole, text: Record<string, TextBlock>) => {
    if (value === null) return;
    const g = definitions.instance(value, role), cost = definitions.cost(g.definition);
    parts += cost.parts; commands += cost.pathCommands;
    if (parts > 50_000 || commands > 65_536) throw Error("Scene graphical budget exceeded");
    for (const source of Object.values(g.slots)) if (source.kind === "text" && !Object.hasOwn(text, source.name)) throw Error("Missing evaluated text block");
  };
  if (scene.form === "graph") {
    const nodes = (ns: import("./protocol.ts").Node[]) => { for (const n of ns) {
      instance(n.graphic, "node", n.text);
      if (n.graphic && ((n.children.length && !Object.values(n.graphic.slots).some((s) => s.kind === "children")) || (n.regions?.items.length && !Object.values(n.graphic.slots).some((s) => s.kind === "regions")))) throw Error("Unmapped graphical children/regions");
      for (const p of n.ports) instance(p.graphic, "port", p.text);
      nodes(n.children); for (const r of n.regions?.items ?? []) nodes(r.children);
    } }; nodes(scene.nodes);
    for (const e of scene.edges) { instance(e.startMarker, "marker", e.text); instance(e.endMarker, "marker", e.text); }
  }
}

const encoder = new TextEncoder();
export function graphicObject(v: unknown, keys?: string[], label = "graphic object"): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error(`Invalid ${label}`);
  const o = v as Record<string, unknown>;
  if (keys && (Object.keys(o).length !== keys.length || keys.some((k) => !Object.hasOwn(o, k)))) throw Error(`Unknown/missing ${label} fields`);
  return o;
}
function optionalObject(value:unknown, required:string[], optional:string[]):Record<string,unknown> {
  const o=graphicObject(value);for(const key of Object.keys(o))if(!required.includes(key)&&!optional.includes(key))throw Error("Unknown graphical field");
  for(const key of required)if(!Object.hasOwn(o,key))throw Error("Missing graphical field");return o;
}
function sizingDependency(e:NumericExpression,width:boolean):void {
  if(typeof e==="number")return;
  if(e.op==="height" || (width&&(e.op==="width"||e.op==="slotHeight")))throw Error("Cyclic sizing/wrapping constraint");
  if(e.op==="select"){sizingDependency(e.ifTrue,width);sizingDependency(e.ifFalse,width);}
  else if("left" in e){sizingDependency(e.left,width);sizingDependency(e.right,width);}
}
function dash(value:unknown):void {if(value!==undefined && !["solid","dashed","dotted"].includes(value as string))throw Error("Invalid graphical dash token");}
export function graphicArray(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw Error("Graphic array limit/type");
  return v;
}
export function graphicId(v: unknown): asserts v is string {
  if (typeof v !== "string" || !v || encoder.encode(v).length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(v)) throw Error("Invalid graphical identity");
}
export function graphicNumber(v: unknown): asserts v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1_000_000) throw Error("Invalid graphical number/extent");
}
export const graphicColor = (v: string): boolean => v === "none" || /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
function scalar(v: unknown): asserts v is GraphicValue {
  if (typeof v === "number") graphicNumber(v);
  else if (typeof v !== "boolean" && typeof v !== "string") throw Error("Invalid graphical scalar");
}
function evaluatedNumber(expr: NumericExpression, values: Record<string, GraphicValue>): number | undefined {
  if (typeof expr === "number") return expr;
  if (expr.op === "width" || expr.op === "height" || expr.op === "slotWidth" || expr.op === "slotHeight") return undefined;
  if (expr.op === "parameter") { const n = values[expr.name]; if (typeof n !== "number") throw Error("Missing evaluated numeric parameter"); return n; }
  if(expr.op==="select") {
    const c=expr.condition, v=typeof c==="boolean"?c:c.op==="equal"?values[c.name]===c.value:values[c.name];
    if(typeof v!=="boolean")throw Error("Missing evaluated Bool parameter");
    return evaluatedNumber(v?expr.ifTrue:expr.ifFalse,values);
  }
  const a = evaluatedNumber(expr.left, values), b = evaluatedNumber(expr.right, values);
  if (expr.op === "divide" && b === 0) throw Error("Division by zero in evaluated graphics");
  if (a === undefined || b === undefined) return undefined;
  const n = expr.op === "add" ? a+b : expr.op === "subtract" ? a-b : expr.op === "multiply" ? a*b : expr.op === "divide" ? a/b : expr.op === "min" ? Math.min(a,b) : Math.max(a,b);
  graphicNumber(n); return n;
}
export function accepts(p: ParameterType, value: GraphicValue): boolean {
  switch (p.kind) {
    case "string": return typeof value === "string" && encoder.encode(value).length <= 4096 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
    case "bool": return typeof value === "boolean";
    case "number": return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
    case "choice": return typeof value === "string" && p.values.includes(value);
  }
}
const contentTypes = ["text", "compartments", "children", "regions"];
function parameter(d: SymbolDefinition, name: unknown): ParameterType {
  if (typeof name !== "string" || !Object.hasOwn(d.parameters, name)) throw Error(`Unknown graphic parameter ${String(name)}`);
  return d.parameters[name];
}
function numeric(v: unknown, d: SymbolDefinition, height: boolean, depth = 0): asserts v is NumericExpression {
  if (depth > 16) throw Error("Graphical expression depth limit");
  if (typeof v === "number") { graphicNumber(v); return; }
  const o = graphicObject(v);
  if (o.op === "parameter") {
    graphicObject(v, ["op", "name"]);
    if (parameter(d, o.name).kind !== "number") throw Error("Numeric expression needs Number");
  } else if (o.op === "width" || o.op === "height") {
    graphicObject(v, ["op"]);
    if (o.op === "height" && !height) throw Error("Measurement depends on unresolved height");
  } else if(o.op==="slotWidth" || o.op==="slotHeight") {
    graphicObject(v,["op","slot"]); if(typeof o.slot!=="string" || !Object.hasOwn(d.slots,o.slot))throw Error("Unknown measured graphical slot");
  } else if(o.op==="select") {
    graphicObject(v,["op","condition","ifTrue","ifFalse"]);condition(o.condition,d);
    numeric(o.ifTrue,d,height,depth+1);numeric(o.ifFalse,d,height,depth+1);
  } else if (["add", "subtract", "multiply", "divide", "min", "max"].includes(o.op as string)) {
    graphicObject(v, ["op", "left", "right"]);
    numeric(o.left, d, height, depth + 1); numeric(o.right, d, height, depth + 1);
  } else throw Error("Invalid numeric expression");
}
function condition(v: unknown, d: SymbolDefinition): asserts v is BooleanExpression {
  if (typeof v === "boolean") return;
  const o = graphicObject(v);
  if (o.op === "parameter") {
    graphicObject(v, ["op", "name"]);
    if (parameter(d, o.name).kind !== "bool") throw Error("Condition needs Bool");
  } else if (o.op === "equal") {
    graphicObject(v, ["op", "name", "value"]); scalar(o.value);
    if (!accepts(parameter(d, o.name), o.value)) throw Error("Invalid condition value");
  } else throw Error("Invalid condition");
}
function paint(v: unknown, d: SymbolDefinition): asserts v is Paint {
  if (typeof v === "string" && graphicColor(v)) return;
  const o = graphicObject(v, ["parameter"]);
  if (!["string", "choice"].includes(parameter(d, o.parameter).kind)) throw Error("Invalid graphical paint parameter");
}
function compatible(a: ParameterType, b: ParameterType): boolean {
  if (a.kind === "choice") return b.kind === "string" || (b.kind === "choice" && a.values.every((v) => b.values.includes(v)));
  return a.kind === b.kind;
}
function sourceType(s: ContentSource): ContentType {
  return ["compartments", "children", "regions"].includes(s.kind) ? s.kind as ContentType : "text";
}
export function validateContentSource(v: unknown): ContentSource {
  const o = graphicObject(v);
  if (o.kind === "text") { graphicObject(v, ["kind", "name"]); graphicId(o.name); }
  else if (["title", "subtitle", "label", "compartments", "children", "regions"].includes(o.kind as string)) graphicObject(v, ["kind"]);
  else throw Error("Invalid content source");
  return v as ContentSource;
}
export interface GraphicCost { parts: number; pathCommands: number }
export function addGraphicCost(a: GraphicCost, b: GraphicCost): void {
  a.parts += b.parts; a.pathCommands += b.pathCommands;
  if (a.parts > 50_000 || a.pathCommands > 65_536) throw Error("Expanded graphical scene limit exceeded");
}
export class GraphicDefinitions {
  readonly definitions = new Map<string, SymbolDefinition>();
  readonly propertyOverrides:SymbolOverrides;
  constructor(input: unknown,overrides:SymbolOverrides={}) {
    validateSymbolOverrides(overrides);this.propertyOverrides=overrides;
    const libraries = graphicArray(input, 64), ids = new Set<string>();
    for (const item of libraries) {
      const lib = graphicObject(item, ["schemaVersion", "id", "imports", "definitions"]);
      graphicId(lib.id);
      if (lib.schemaVersion !== 1 || ids.has(lib.id)) throw Error("Invalid/duplicate symbol library");
      ids.add(lib.id);
      const imports = graphicArray(lib.imports, 64); imports.forEach(graphicId);
      for (const value of graphicArray(lib.definitions, 256)) {
        const def = optionalObject(value, ["id", "version", "role", "parameters", "slots", "root", "connectionAnchor"],["size","properties"]);
        graphicId(def.id); graphicId(def.version);
        if (!def.id.startsWith(`${lib.id}/`) || !def.id.slice(lib.id.length + 1) || def.id.slice(lib.id.length + 1).includes("/") || this.definitions.has(def.id)) throw Error("Duplicate/unqualified definition");
        if (!["node", "port", "marker"].includes(def.role as string)) throw Error("Invalid graphical role");
        const parameters = graphicObject(def.parameters), slots = graphicObject(def.slots);
        if (Object.keys(parameters).length > 32 || Object.keys(slots).length > 32) throw Error("Parameter/slot limit");
        for (const [name, v] of Object.entries(parameters)) {
          graphicId(name);
          const p = graphicObject(v);
          if (p.kind === "choice") {
            graphicObject(v, ["kind", "values", "default"]);
            const values = graphicArray(p.values, 64);
            if (!values.length || new Set(values).size !== values.length || values.some((s) => typeof s !== "string" || encoder.encode(s).length > 4096 || /[\u0000-\u001f\u007f-\u009f]/u.test(s))) throw Error("Invalid Choice parameter");
          } else if (["string", "bool", "number"].includes(p.kind as string)) graphicObject(v, ["kind", "default"]);
          else throw Error("Invalid parameter type");
          scalar(p.default);
          if (!accepts(v as ParameterType, p.default)) throw Error("Invalid parameter default");
        }
        for (const [name, type] of Object.entries(slots)) { graphicId(name); if (!contentTypes.includes(type as string) || (def.role !== "node" && type !== "text")) throw Error("Invalid slot type/role"); }
        if (def.connectionAnchor !== null) graphicId(def.connectionAnchor);
        else if (def.role !== "node") throw Error("Port/marker requires connection anchor");
        this.definitions.set(def.id, value as SymbolDefinition);
      }
    }
    if (this.definitions.size > 256) throw Error("Symbol definition limit");
    for (const item of libraries) {
      const lib = item as SymbolLibrary;
      if (lib.imports.some((id) => !ids.has(id) || id === lib.id)) throw Error("Missing/self symbol import");
      for (const d of lib.definitions) {
        if(d.size!==undefined){
          const size=graphicObject(d.size,["minimumWidth","preferredWidth","minimumHeight","preferredHeight"]);
          for(const [name,value]of Object.entries(size)){numeric(value,d,false);sizingDependency(value,name.endsWith("Width"));}
        }
        const parts = new Set<string>(), anchors = new Set<string>();
        this.part(d.root, d, lib, parts, anchors, 0);
        const used=new Map<string,number>(), use=(slot:string)=>used.set(slot,(used.get(slot)??0)+1);
        const visit=(p:GraphicPart)=>{const c=p.content;
          if(c.kind==="text"||c.kind==="content")use(c.slot);
          else if(c.kind==="use")Object.values(c.slots).forEach(use);
          else if(c.kind==="frame"||c.kind==="stack"||c.kind==="overlay")c.children.forEach(visit);
          else if(c.kind==="transform")visit(c.child);
        };visit(d.root);
        for(const [slot,type]of Object.entries(d.slots))if(!used.get(slot)||(type!=="text"&&(used.get(slot)??0)>1))throw Error(`Unused or multiply-owned graphical slot ${slot}`);
        if (parts.size > 256) throw Error("Authored graphical part limit");
      }
    }
    for (const [id, d] of this.definitions) {
      this.cost(id);validateProperties(d);
      const defaults=Object.fromEntries(Object.entries(d.parameters).map(([name,p])=>[name,p.default]));
      this.evaluatedPaints(d.root,defaults);this.evaluatedSize(d,defaults);this.evaluatedGeometry(d.root,defaults);
      const anchors = this.anchorNames(d.root);
      if (d.connectionAnchor !== null && !anchors.has(d.connectionAnchor)) throw Error("Missing connection anchor");
    }
  }
  definition(id: string): SymbolDefinition {
    const d = this.definitions.get(id);
    if (!d) throw Error(`Unknown symbol definition ${id}`);
    return d;
  }
  private part(input: unknown, d: SymbolDefinition, lib: SymbolLibrary, ids: Set<string>, anchors: Set<string>, depth: number): void {
    if (depth > 16) throw Error("Graphical part depth limit");
    const p = optionalObject(input, ["id", "when", "anchors", "content"],["style"]); graphicId(p.id);validateStyle(p as unknown as GraphicPart,d);
    if (ids.has(p.id)) throw Error("Duplicate graphical part ID"); ids.add(p.id);
    if (p.when !== null) condition(p.when, d);
    for (const v of graphicArray(p.anchors, 32)) {
      const a = graphicObject(v, ["id", "x", "y", "dx", "dy"]); graphicId(a.id);
      if (anchors.has(a.id)) throw Error("Duplicate local anchor ID"); anchors.add(a.id);
      for (const key of ["x", "y", "dx", "dy"]) numeric(a[key], d, true);
    }
    const c = graphicObject(p.content); let children: unknown[] = [];
    switch (c.kind) {
      case "frame":
        optionalObject(c, ["kind", "padding", "radius", "fill", "stroke", "strokeWidth", "children"],["dash"]);dash(c.dash);
        if(typeof c.strokeWidth!=="number" || c.strokeWidth>100)throw Error("Invalid stroke width");
        for (const n of [c.padding, c.radius, c.strokeWidth]) { graphicNumber(n); if (n < 0) throw Error("Negative frame geometry"); }
        paint(c.fill, d); paint(c.stroke, d); children = graphicArray(c.children, 256); break;
      case "stack":
        graphicObject(c, ["kind", "direction", "align", "gap", "children"]); graphicNumber(c.gap);
        if (c.gap < 0 || !["row", "column"].includes(c.direction as string) || !["start", "center", "end"].includes(c.align as string)) throw Error("Invalid stack");
        children = graphicArray(c.children, 256); break;
      case "overlay": graphicObject(c, ["kind", "children"]); children = graphicArray(c.children, 256); break;
      case "transform":
        graphicObject(c, ["kind", "x", "y", "rotate", "scaleX", "scaleY", "child"]);
        for (const key of ["x", "y", "rotate", "scaleX", "scaleY"]) numeric(c[key], d, false);
        if (c.scaleX === 0 || c.scaleY === 0) throw Error("Singular transform");
        children = [c.child]; break;
      case "text":
        graphicObject(c, ["kind", "slot", "size", "weight", "italic", "align", "wrap", "color"]); graphicNumber(c.size);
        if (typeof c.slot !== "string" || !Object.hasOwn(d.slots, c.slot) || d.slots[c.slot] !== "text" || c.size < 6 || c.size > 96 || ![400, 500, 600, 700].includes(c.weight as number) || typeof c.italic !== "boolean" || typeof c.wrap !== "boolean" || !["start", "center", "end"].includes(c.align as string)) throw Error("Invalid text part");
        paint(c.color, d); break;
      case "content": graphicObject(c, ["kind", "slot"]); if (typeof c.slot !== "string" || !Object.hasOwn(d.slots, c.slot)) throw Error("Unknown content slot"); break;
      case "use": {
        graphicObject(c, ["kind", "definition", "parameters", "slots"]); graphicId(c.definition);
        const target = this.definition(c.definition), sourceLibrary = c.definition.slice(0, c.definition.lastIndexOf("/"));
        if (sourceLibrary !== lib.id && !lib.imports.includes(sourceLibrary)) throw Error("Explicit symbol library import required");
        if (target.role !== d.role) throw Error("Incompatible reused graphic role");
        const params = graphicObject(c.parameters), slots = graphicObject(c.slots);
        for (const [name, input] of Object.entries(params)) {
          const expected = parameter(target, name), v = graphicObject(input);
          if (v.kind === "constant") { graphicObject(v, ["kind", "value"]); scalar(v.value); if (!accepts(expected, v.value)) throw Error("Invalid forwarded value"); }
          else if (v.kind === "parameter") { graphicObject(v, ["kind", "name"]); if (!compatible(parameter(d, v.name), expected)) throw Error("Invalid forwarded parameter"); }
          else throw Error("Invalid value expression");
        }
        if (Object.keys(slots).length !== Object.keys(target.slots).length) throw Error("Forwarded slot count mismatch");
        for (const [name, source] of Object.entries(slots)) if (!Object.hasOwn(target.slots, name) || typeof source !== "string" || !Object.hasOwn(d.slots, source) || target.slots[name] !== d.slots[source]) throw Error("Invalid forwarded slot");
        break;
      }
      case "geometry": {
        optionalObject(c, ["kind", "geometry", "fill", "stroke", "strokeWidth"],["dash"]);dash(c.dash); paint(c.fill, d); paint(c.stroke, d); graphicNumber(c.strokeWidth);
        if (c.strokeWidth < 0 || c.strokeWidth > 100) throw Error("Invalid stroke width");
        const g = graphicObject(c.geometry);
        if (g.kind === "rectangle") { graphicObject(g, ["kind", "width", "height", "radius"]); graphicNumber(g.radius); if (g.radius < 0) throw Error("Negative radius"); }
        else if (g.kind === "ellipse") graphicObject(g, ["kind", "width", "height"]);
        else if (g.kind === "polyline") {
          graphicObject(g, ["kind", "width", "height", "points", "closed"]); const points = graphicArray(g.points, 2048);
          if (points.length < 2 || typeof g.closed !== "boolean") throw Error("Invalid polyline");
          for (const v of points) { const pt = graphicObject(v, ["x", "y"]); numeric(pt.x, d, true); numeric(pt.y, d, true); }
        } else if (g.kind === "path") {
          graphicObject(g, ["kind", "width", "height", "commands"]); const commands = graphicArray(g.commands, 2048);
          if (!commands.length || graphicObject(commands[0]).kind !== "move") throw Error("Path must begin with move");
          for (const v of commands) {
            const cmd = graphicObject(v); let fields: string[];
            if (cmd.kind === "move" || cmd.kind === "line") fields = ["x", "y"];
            else if (cmd.kind === "quadratic") fields = ["cx", "cy", "x", "y"];
            else if (cmd.kind === "cubic") fields = ["cx1", "cy1", "cx2", "cy2", "x", "y"];
            else if (cmd.kind === "close") fields = [];
            else throw Error("Invalid path command");
            graphicObject(v, ["kind", ...fields]); fields.forEach((key) => numeric(cmd[key], d, true));
          }
        } else throw Error("Unknown geometry");
        for (const key of ["width", "height"]) { numeric(g[key], d, false); if (typeof g[key] === "number" && g[key] <= 0) throw Error("Nonpositive geometry"); }
        break;
      }
      default: throw Error("Unsupported graphical content");
    }
    for (const child of children) this.part(child, d, lib, ids, anchors, depth + 1);
  }
  instance(input: unknown, role: GraphicRole): GraphicInstance {
    validateGraphicInstance(input);
    const v = optionalObject(input, ["definition", "parameters", "slots"],["sourceParameters"]); graphicId(v.definition);
    const d = this.definition(v.definition), parameters = graphicObject(v.parameters), slots = graphicObject(v.slots);
    if (d.role !== role || Object.keys(parameters).length !== Object.keys(d.parameters).length || Object.keys(slots).length !== Object.keys(d.slots).length) throw Error("Graphic instance role/arguments mismatch");
    for(const p of d.properties??[])checkPropertyValue(d,p,parameters[p.parameter] as GraphicValue);
    for (const [name, v] of Object.entries(parameters)) { scalar(v); if (!accepts(parameter(d, name), v)) throw Error(`Invalid graphical parameter ${name}`); }
    const contentOwners=new Set<string>();
    for (const [name, v] of Object.entries(slots)) {
      const source = validateContentSource(v);
      const type=sourceType(source); if(type!=="text"&&contentOwners.has(type))throw Error("Multiple slots claim the same semantic content");contentOwners.add(type);
      if (!Object.hasOwn(d.slots, name) || d.slots[name] !== sourceType(source) || (role !== "node" && source.kind !== "label" && source.kind !== "text") || (role === "node" && source.kind === "label")) throw Error("Invalid graphical slot mapping");
    }
    this.evaluatedPaints(d.root, parameters as Record<string, GraphicValue>);
    this.evaluatedSize(d,parameters as Record<string,GraphicValue>);
    this.evaluatedGeometry(d.root, parameters as Record<string, GraphicValue>);
    return input as GraphicInstance;
  }
  private evaluatedPaints(part: GraphicPart, values: Record<string, GraphicValue>): void {
    evaluatedStyle(part,values);
    const check = (paint: Paint) => {
      const value = typeof paint === "string" ? paint : Object.hasOwn(values, paint.parameter) ? values[paint.parameter] : undefined;
      if (typeof value !== "string" || !graphicColor(value)) throw Error("Invalid evaluated graphical paint");
    };
    const c = part.content;
    if (c.kind === "frame" || c.kind === "geometry") { check(c.fill); check(c.stroke); }
    if (c.kind === "text") check(c.color);
    if (c.kind === "frame" || c.kind === "stack" || c.kind === "overlay") for (const child of c.children) this.evaluatedPaints(child, values);
    else if (c.kind === "transform") this.evaluatedPaints(c.child, values);
    else if (c.kind === "use") {
      const d = this.definition(c.definition), forwarded: Record<string, GraphicValue> = Object.create(null);
      for (const [name, parameter] of Object.entries(d.parameters)) forwarded[name] = parameter.default;
      for (const [name, expr] of Object.entries(c.parameters)) {
        const value = expr.kind === "constant" ? expr.value : values[expr.name];
        if (!accepts(d.parameters[name], value)) throw Error("Invalid forwarded graphical value"); forwarded[name] = value;
      }
      for(const p of d.properties??[])checkPropertyValue(d,p,forwarded[p.parameter]);
      this.evaluatedPaints(d.root, forwarded);
    }
  }
  private evaluatedSize(d:SymbolDefinition,values:Record<string,GraphicValue>):void {
    if(!d.size)return;
    for(const [min,preferred]of [[d.size.minimumWidth,d.size.preferredWidth],[d.size.minimumHeight,d.size.preferredHeight]]){
      const a=evaluatedNumber(min,values),b=evaluatedNumber(preferred,values);
      if((a!==undefined&&a<=0)||(b!==undefined&&b<=0)||(a!==undefined&&b!==undefined&&b<a))throw Error("Unsatisfiable graphical size constraints");
    }
  }
  private evaluatedGeometry(part: GraphicPart, values: Record<string, GraphicValue>): void {
    const number = (e: NumericExpression) => evaluatedNumber(e,values);
    for (const a of part.anchors) { number(a.x);number(a.y); if(number(a.dx)===0 && number(a.dy)===0) throw Error("Zero evaluated anchor direction"); }
    const c=part.content;
    if(c.kind==="frame"||c.kind==="stack"||c.kind==="overlay") for(const child of c.children) this.evaluatedGeometry(child,values);
    else if(c.kind==="transform") {
      number(c.x);number(c.y);number(c.rotate);
      for(const e of [c.scaleX,c.scaleY]) { const n=number(e);if(n!==undefined && Math.abs(n)<1e-9)throw Error("Singular evaluated graphical transform"); }
      this.evaluatedGeometry(c.child,values);
    } else if(c.kind==="geometry") {
      const g=c.geometry;
      for(const e of [g.width,g.height]) { const n=number(e);if(n!==undefined && n<=0)throw Error("Nonpositive evaluated geometry"); }
      if(g.kind==="polyline") for(const p of g.points) { number(p.x);number(p.y); }
      else if(g.kind==="path") for(const p of g.commands) if(p.kind!=="close") {
        number(p.x);number(p.y); if(p.kind==="quadratic") {number(p.cx);number(p.cy);} if(p.kind==="cubic"){number(p.cx1);number(p.cy1);number(p.cx2);number(p.cy2);}
      }
    } else if(c.kind==="use") {
      const d=this.definition(c.definition), forwarded:Record<string,GraphicValue>=Object.create(null);
      for(const [name,p] of Object.entries(d.parameters))forwarded[name]=p.default;
      for(const [name,e] of Object.entries(c.parameters))forwarded[name]=e.kind==="constant"?e.value:values[e.name];
      this.evaluatedSize(d,forwarded);this.evaluatedGeometry(d.root,forwarded);
    }
  }
  cost(id: string, path: string[] = []): GraphicCost {
    if (path.length > 8 || path.includes(id)) throw Error("Graphical reuse cycle/depth limit");
    const walk = (p: GraphicPart): GraphicCost => {
      const result: GraphicCost = { parts: 1, pathCommands: 0 }, c = p.content;
      if (c.kind === "frame" || c.kind === "stack" || c.kind === "overlay") for (const p of c.children) addGraphicCost(result, walk(p));
      else if (c.kind === "transform") addGraphicCost(result, walk(c.child));
      else if (c.kind === "use") addGraphicCost(result, this.cost(c.definition, [...path, id]));
      else if (c.kind === "geometry" && c.geometry.kind === "path") result.pathCommands = c.geometry.commands.length;
      else if (c.kind === "geometry" && c.geometry.kind === "polyline") result.pathCommands = c.geometry.points.length;
      return result;
    };
    return walk(this.definition(id).root);
  }
  private anchorNames(part: GraphicPart): Set<string> {
    const result = new Set(part.anchors.map((a) => a.id));
    const extend = (more: Iterable<string>) => {
      for (const name of more) { if (result.has(name)) throw Error("Duplicate expanded anchor"); result.add(name); }
    };
    const c = part.content;
    if (c.kind === "frame" || c.kind === "stack" || c.kind === "overlay") for (const p of c.children) extend(this.anchorNames(p));
    else if (c.kind === "transform") extend(this.anchorNames(c.child));
    else if (c.kind === "use") extend([...this.anchorNames(this.definition(c.definition).root)].map((name) => `${part.id}/${name}`));
    return result;
  }
}
