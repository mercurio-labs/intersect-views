import {applyGraphicStyle,resolveProperties,authoredPropertyKeys,propertyKey,type PropertyTarget} from "./symbol-properties-contract.ts";
/** Pure, bounded M12 measurement/arrangement. The caller supplies measured text
 * and scene content; no semantic query or browser I/O occurs here. */
import {
  GraphicDefinitions, accepts, graphicColor, graphicNumber,
  type GraphicPart, type GraphicContent, type GraphicInstance, type GraphicValue,
  type NumericExpression, type BooleanExpression, type Paint, type GraphicAnchor,
  type SymbolDefinition, type Alignment, type PathCommand,
} from "./graphics-contract.ts";
import type { Binding, LabelPart, Label } from "./protocol.ts";
import type { LabelPlacement } from "./routing-contract.ts";
import { logicalId } from "./logical-id.ts";

export interface TextRun { id: string; parts: LabelPart[] }
export interface TextBlock { runs: TextRun[] }
export interface GraphicRect { x: number; y: number; width: number; height: number }
export interface GraphicConnection { x: number; y: number; dx: number; dy: number }
export interface GraphicTextFragment {
  part: LabelPart; owner: string; binding: Binding; slot: string;
  text: string; rect: GraphicRect; size: number; weight: number; italic: boolean; color: string;
}
export interface GraphicContentLayout { width: number; height: number; markup: string; fragments: GraphicTextFragment[] }
export interface GraphicDrawing extends GraphicContentLayout {
  left: number;
  top: number;
  anchors: Record<string, GraphicConnection>;
  content: Record<string, GraphicRect>;
  parts: number;
  commands: number;
  labels: Record<string,GraphicLabelFrame>;
  geometry:GraphicRect[];
  propertyTargets:PropertyTarget[];
}
export interface GraphicLabelFrame {
  id:string;owner:string;slot:string;binding:Binding;rect:GraphicRect;
  /** Original authored text frame; local offsets are applied before its transforms. */
  frame:Matrix;
}
export interface TextContent { kind: "text"; block: TextBlock; owner: string; binding: Binding; slot: string }
export interface BoxContent { kind: "box"; width: number; height: number }
export interface CompartmentsContent {
  kind: "compartments";
  owner: string;
  binding: Binding;
  items: { id: string; label: string; rows: { id: string; label: Label; binding: Binding }[] }[];
}
export type BoundGraphicContent = TextContent | BoxContent | CompartmentsContent;
export type MeasureText = (text: string, size: number, weight: number, italic: boolean) => number;
export type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
export function graphicEscape(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function point(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
export function transformRect(m: Matrix, r: GraphicRect): GraphicRect {
  const points = [point(m, r.x, r.y), point(m, r.x + r.width, r.y), point(m, r.x, r.y + r.height), point(m, r.x + r.width, r.y + r.height)];
  const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y));
  return { x, y, width: Math.max(...points.map((p) => p.x)) - x, height: Math.max(...points.map((p) => p.y)) - y };
}
function n(expr: NumericExpression, params: Record<string, GraphicValue>, width: number, height: number, slot?: (name:string,axis:"width"|"height")=>number): number {
  if (typeof expr === "number") return expr;
  if (expr.op === "parameter") {
    if (!Object.hasOwn(params, expr.name) || typeof params[expr.name] !== "number") throw Error("Missing numeric graphical parameter");
    return params[expr.name] as number;
  }
  if (expr.op === "width") return width;
  if (expr.op === "height") return height;
  if(expr.op==="slotWidth"||expr.op==="slotHeight"){if(!slot)throw Error("Missing slot measurement");return slot(expr.slot,expr.op==="slotWidth"?"width":"height");}
  if(expr.op==="select")return n(visible(expr.condition,params)?expr.ifTrue:expr.ifFalse,params,width,height,slot);
  const a = n(expr.left, params, width, height,slot), b = n(expr.right, params, width, height,slot);
  let result: number;
  switch (expr.op) {
    case "add": result = a + b; break;
    case "subtract": result = a - b; break;
    case "multiply": result = a * b; break;
    case "divide": if (!b) throw Error("Division by zero in graphical expression"); result = a / b; break;
    case "min": result = Math.min(a, b); break;
    case "max": result = Math.max(a, b); break;
  }
  graphicNumber(result); return result;
}
function visible(expr: BooleanExpression | null, params: Record<string, GraphicValue>): boolean {
  if (expr === null) return true;
  if (typeof expr === "boolean") return expr;
  if (!Object.hasOwn(params, expr.name)) throw Error("Missing graphical condition parameter");
  if (expr.op === "equal") return params[expr.name] === expr.value;
  if (typeof params[expr.name] !== "boolean") throw Error("Invalid Bool condition parameter");
  return params[expr.name] as boolean;
}
function paint(p: Paint, params: Record<string, GraphicValue>): string {
  const value = typeof p === "string" ? p : Object.hasOwn(params, p.parameter) ? params[p.parameter] : undefined;
  if (typeof value !== "string" || !graphicColor(value)) throw Error("Invalid evaluated graphical paint");
  return value;
}
const blank = (): GraphicDrawing => ({ left:0, top:0, width: 0, height: 0, markup: "", fragments: [], anchors: Object.create(null), content: Object.create(null), labels:Object.create(null), geometry:[], propertyTargets:[], parts: 0, commands: 0 });
export function compose(a:Matrix,b:Matrix):Matrix {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
function move(d: GraphicDrawing, x: number, y: number): GraphicDrawing {
  const result = { ...d, left:d.left+x, top:d.top+y, markup: `<g transform="translate(${x},${y})">${d.markup}</g>`, fragments: d.fragments.map((f) => ({...f, rect: {...f.rect, x:f.rect.x+x, y:f.rect.y+y}})), anchors: Object.create(null), content: Object.create(null) };
  for (const [key, a] of Object.entries(d.anchors)) result.anchors[key] = { ...a, x: a.x + x, y: a.y + y };
  for (const [key, r] of Object.entries(d.content)) result.content[key] = { ...r, x: r.x + x, y: r.y + y };
  result.labels=Object.fromEntries(Object.entries(d.labels).map(([id,label])=>[id,{...label,rect:{...label.rect,x:label.rect.x+x,y:label.rect.y+y},frame:compose([1,0,0,1,x,y],label.frame)}]));
  result.geometry=d.geometry.map(r=>({...r,x:r.x+x,y:r.y+y}));
  return result;
}
function merge(target: GraphicDrawing, child: GraphicDrawing): void {
  target.markup += child.markup;
  target.fragments.push(...child.fragments);
  target.geometry.push(...child.geometry);
  for(const [id,label]of Object.entries(child.labels)) {
    if(Object.hasOwn(target.labels,id))throw Error("Duplicate logical label block");target.labels[id]=label;
  }
  for (const [key, anchor] of Object.entries(child.anchors)) {
    if (Object.hasOwn(target.anchors, key)) throw Error("Duplicate expanded anchor");
    target.anchors[key] = anchor;
  }
  for (const [key, box] of Object.entries(child.content)) {
    if (Object.hasOwn(target.content, key)) throw Error("Content slot used more than once");
    target.content[key] = box;
  }
  target.parts += child.parts; target.commands += child.commands;
  if (target.parts > 50_000 || target.commands > 65_536) throw Error("Expanded graphical layout limit");
}
export function measureBlock(content: TextContent, width: number, style: { size: number; weight: number; italic: boolean; align: Alignment; wrap: boolean; color: string }, measure: MeasureText): GraphicContentLayout {
  if (width < 1) throw Error("Text slot has no allocated width");
  const fragments: GraphicTextFragment[] = [];
  const lines: GraphicTextFragment[][] = [[]];
  const lineHeight = style.size + 6;
  let x = 0, y = 0;
  const next = () => { x = 0; y += lineHeight; lines.push([]); };
  const add = (part: LabelPart, text: string) => {
    const w = Math.max(text ? measure(text, style.size, style.weight, style.italic) : 6, 0.1);
    const fragment: GraphicTextFragment = { part, owner: content.owner, binding: content.binding, slot: content.slot, text, rect: { x, y, width: w, height: lineHeight }, ...style };
    lines[lines.length - 1].push(fragment); fragments.push(fragment); x += w;
    if (fragments.length > 50_000) throw Error("Text fragment limit exceeded");
  };
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  content.block.runs.forEach((run, runIndex) => {
    if (runIndex) next();
    for (const part of run.parts) {
      if (!part.text) { if (part.binding) add(part, ""); continue; }
      const before=fragments.length;
      for (const token of part.text.split(/(\n|[^\S\n]+)/u).filter((s) => s.length)) {
        if (token === "\n") { next(); continue; }
        const w = measure(token, style.size, style.weight, style.italic);
        if (style.wrap && x && x + w > width) next();
        if (style.wrap && w > width) {
          let pending = "";
          for (const { segment } of segmenter.segment(token)) {
            if (pending && measure(pending + segment, style.size, style.weight, style.italic) > width) { add(part, pending); next(); pending = ""; }
            pending += segment;
          }
          if (pending) add(part, pending);
        } else add(part, token);
      }
      if(part.binding && fragments.length===before)add(part, "");
    }
  });
  let markup = "";
  for (const line of lines) {
    const extent = line.reduce((sum, f) => sum + f.rect.width, 0);
    const offset = style.align === "center" ? Math.max(0, (width - extent) / 2) : style.align === "end" ? Math.max(0, width - extent) : 0;
    for (const f of line) {
      f.rect.x += offset;
      markup += `<g class="diagram-label-part" data-label-part="${graphicEscape(f.part.id)}"${f.part.binding ? ` tabindex="0" role="button" aria-label="${graphicEscape(f.part.text || f.slot)}"` : ""}><rect class="label-hit" x="${f.rect.x}" y="${f.rect.y}" width="${f.rect.width}" height="${f.rect.height}"/><text xml:space="preserve" x="${f.rect.x}" y="${f.rect.y + style.size}" fill="${f.color}" style="font:${style.italic ? "italic " : ""}${style.weight} ${style.size}px system-ui">${graphicEscape(f.text)}</text></g>`;
    }
  }
  return { width:Math.max(width,...fragments.map(f=>f.rect.x+f.rect.width)), height: content.block.runs.length ? y + lineHeight : 0, markup, fragments };
}
/** Intrinsic slot width is independent of wrapping; height is measured only
 * after width allocation, using the standard content profile (14px body/11px heading). */
function slotMetric(value:BoundGraphicContent|undefined,width:number,axis:"width"|"height",measure:MeasureText):number {
  if(!value)throw Error("Missing measured slot");
  if(value.kind==="box")return value[axis];
  const block=(text:TextContent,size=14,weight=400,italic=false)=>measureBlock(text,Math.max(1,width),{size,weight,italic,align:"start",wrap:axis==="height",color:"#334538"},measure);
  if(value.kind==="text"){
    const layout=block(value);
    return axis==="height"?layout.height:Math.max(0,...layout.fragments.map(f=>f.rect.x+f.rect.width));
  }
  let extent=0;
  for(const item of value.items){
    const header:TextContent={kind:"text",owner:value.owner,binding:value.binding,slot:"compartment.heading",block:{runs:[{id:item.id,parts:[{id:item.id,text:item.label,binding:null,editTool:null}]}]}};
    const h=block(header,11,400,true);
    const widths=[...h.fragments.map(f=>f.rect.x+f.rect.width)];let height=h.height+15;
    for(const row of item.rows){const layout=block({kind:"text",owner:row.id,binding:row.binding,slot:"row.label",block:{runs:[{id:row.id,parts:row.label.parts}]}});height+=layout.height+4;widths.push(...layout.fragments.map(f=>f.rect.x+f.rect.width));}
    extent=axis==="height"?extent+height:Math.max(extent,...widths);
  }
  return extent;
}
function allocation(d:SymbolDefinition,params:Record<string,GraphicValue>,contents:Record<string,BoundGraphicContent>,measure:MeasureText,width?:number,height?:number):{width:number;height?:number} {
  if(!d.size)return{width:width??360,height};
  const evaluate=(e:NumericExpression,w:number)=>n(e,params,w,0,(key,axis)=>slotMetric(contents[key],w,axis,measure));
  const min=evaluate(d.size.minimumWidth,1),preferred=evaluate(d.size.preferredWidth,1);
  if(min<=0||preferred<min)throw Error("Unsatisfiable graphical width constraints");
  const w=Math.max(width??preferred,min), minH=evaluate(d.size.minimumHeight,w),preferredH=evaluate(d.size.preferredHeight,w);
  if(minH<=0||preferredH<minH)throw Error("Unsatisfiable graphical height constraints");
  return{width:w,height:Math.max(height??preferredH,minH)};
}
export function layoutGraphic(definitions: GraphicDefinitions, instance: GraphicInstance, owner: string, slots: Record<string, BoundGraphicContent>, width: number | undefined, measure: MeasureText, allocatedHeight?: number,placements:Record<string,LabelPlacement>={},instancePath?:string,ownerKeys?:Set<string>): GraphicDrawing {
  const definition = definitions.definition(instance.definition);
  definitions.instance(instance, definition.role);
  const propertyTargets:PropertyTarget[]=[],initialPath=instancePath?`${instancePath}/${definition.id}`:definition.id,source=new Set(instance.sourceParameters??Object.keys(instance.parameters));
  const initialParameters=resolveProperties(definition,owner,initialPath,instance.parameters,source,definitions.propertyOverrides,propertyTargets);
  const assigned=allocation(definition,initialParameters,slots,measure,width,allocatedHeight);width=assigned.width;allocatedHeight=assigned.height;
  graphicNumber(width);
  if (width <= 0) throw Error("Nonpositive symbol allocation");
  if(allocatedHeight!==undefined){graphicNumber(allocatedHeight);if(allocatedHeight<=0)throw Error("Nonpositive height allocation");}
  let visited = 0, pathCommands = 0;const visualConsumers=new Set<string>();
  const evalPart = (part: GraphicPart, d: SymbolDefinition, params: Record<string, GraphicValue>, contents: Record<string, BoundGraphicContent>, available: number, prefix: string, heightAllocation?: number,sourceParameters:Set<string>=source,propertyPath:string=initialPath): GraphicDrawing => {
    const path = `${prefix}/${part.id}`;
    try {
    if (++visited > 50_000) throw Error("Expanded graphical part limit");
    if (!visible(part.when, params)) return blank();
    const result = blank();
    result.parts = 1;
    let c = part.content;
    const number=(expr:NumericExpression,w:number,h:number)=>n(expr,params,w,h,(key,axis)=>slotMetric(contents[key],w,axis,measure));
    const child = (p: GraphicPart, w = available) => evalPart(p, d, params, contents, w, path,undefined,sourceParameters,propertyPath);
    const textSlot = (key: string): TextContent => {
      const slot = Object.hasOwn(contents, key) ? contents[key] : undefined;
      if (!slot || slot.kind !== "text") throw Error(`Missing text content ${key}`);
      return slot;
    };
    const bindText=(layout:GraphicContentLayout,content:TextContent,identityPath=path,origin={x:0,y:0})=>{
      const id=logicalId("label",[owner,identityPath,content.slot]),placement=Object.hasOwn(placements,id)?placements[id]:undefined;
      if(placement&&placement.kind!=="owner")throw Error("Authored text requires owner placement");
      const dx=placement?.dx??0,dy=placement?.dy??0;
      graphicNumber(dx);graphicNumber(dy);
      layout.markup=`<g data-bound-label-block="${id}" transform="translate(${dx},${dy})">${layout.markup}</g>`;
      layout.fragments=layout.fragments.map(f=>({...f,rect:{...f.rect,x:f.rect.x+dx,y:f.rect.y+dy}}));
      const x=layout.fragments.length?Math.min(...layout.fragments.map(f=>f.rect.x)):dx,y=layout.fragments.length?Math.min(...layout.fragments.map(f=>f.rect.y)):dy;
      result.labels[id]={id,owner,slot:content.slot,binding:content.binding,frame:[1,0,0,1,origin.x,origin.y],rect:{x:x+origin.x,y:y+origin.y,width:Math.max(x,...layout.fragments.map(f=>f.rect.x+f.rect.width))-x,height:Math.max(y,...layout.fragments.map(f=>f.rect.y+f.rect.height))-y}};
      return layout;
    };
    let textParameters=params;
    if(c.kind==="text"){
      const content=textSlot(c.slot),id=logicalId("label",[owner,path,content.slot]),names=new Set(Object.values(part.style??{}).map(ref=>ref.parameter));
      if(typeof c.color!=="string")names.add(c.color.parameter);
      textParameters=resolveProperties(d,id,propertyPath,params,sourceParameters,definitions.propertyOverrides,propertyTargets,names,owner);
    }
    const visualNames=new Set(Object.values(part.style??{}).map(ref=>ref.parameter));
    for(const field of ["fill","stroke","color"]){const paint=(c as unknown as Record<string,unknown>)[field];if(paint&&typeof paint==="object"&&"parameter"in paint)visualNames.add(String(paint.parameter));}
    for(const p of d.properties??[])if(visualNames.has(p.parameter))visualConsumers.add(propertyKey(d,propertyPath,p));
    c=applyGraphicStyle(part,textParameters);
    if (c.kind === "use") {
      const target = definitions.definition(c.definition), forwardedSource=new Set<string>();let forwarded: Record<string, GraphicValue> = Object.create(null);const forwardedSlots: Record<string, BoundGraphicContent> = Object.create(null);
      for (const [name, p] of Object.entries(target.parameters)) forwarded[name] = p.default;
      for (const [key, value] of Object.entries(c.parameters)) {
        if (value.kind === "parameter" && !Object.hasOwn(params, value.name)) throw Error("Missing forwarded parameter");
        forwarded[key] = value.kind === "constant" ? value.value : params[value.name];
        if(value.kind==="parameter"&&sourceParameters.has(value.name))forwardedSource.add(key);
        if (!accepts(target.parameters[key], forwarded[key])) throw Error("Invalid evaluated forwarded value");
      }
      for (const [name, source] of Object.entries(c.slots)) {
        if (!Object.hasOwn(contents, source)) throw Error("Missing forwarded slot");
        forwardedSlots[name] = contents[source];
      }
      const nextPath=`${path}/${target.id}`;forwarded=resolveProperties(target,owner,nextPath,forwarded,forwardedSource,definitions.propertyOverrides,propertyTargets);
      const assigned=allocation(target,forwarded,forwardedSlots,measure,available,heightAllocation);
      const reused = evalPart(target.root, target, forwarded, forwardedSlots, assigned.width, nextPath,assigned.height,forwardedSource,nextPath);
      reused.anchors = Object.fromEntries(Object.entries(reused.anchors).map(([key, anchor]) => [`${part.id}/${key}`, anchor]));
      merge(result, reused); result.left=reused.left;result.top=reused.top;result.width = reused.width; result.height = reused.height;
    } else if (c.kind === "text") {
      const layout = bindText(measureBlock(textSlot(c.slot), available, { size: c.size, weight: c.weight, italic: c.italic, align: c.align, wrap: c.wrap, color: paint(c.color, textParameters) }, measure),textSlot(c.slot));
      Object.assign(result, { ...layout, parts: result.parts + layout.fragments.length });
    } else if (c.kind === "content") {
      const value = Object.hasOwn(contents, c.slot) ? contents[c.slot] : undefined;
      if (!value) throw Error(`Missing content slot ${c.slot}`);
      if (value.kind === "box") {
        result.width = Math.max(available, value.width); result.height = value.height;
        result.content[c.slot] = { x: 0, y: 0, width: result.width, height: result.height };
      } else if (value.kind === "text") {
        const layout = bindText(measureBlock(value, available, { size: 14, weight: 400, italic: false, align: "start", wrap: true, color: "#334538" }, measure),value);
        Object.assign(result, { ...layout, parts: result.parts + layout.fragments.length });
      } else {
        let y = 0;
        for (const item of value.items) {
          const heading: LabelPart = { id: `graphic-heading:${item.id}`, text: item.label, binding: null, editTool: null };
          const contents: TextContent = { kind: "text", owner: value.owner, binding: value.binding, slot: "compartment.heading", block: { runs: [{ id: item.id, parts: [heading] }] } };
          result.markup += `<path d="M0 ${y} H${available}" stroke="#a3b4a8" fill="none"/>`;
          const header = measureBlock(contents, available, { size: 11, weight: 400, italic: true, align: "center", wrap: true, color: "#617665" }, measure);
          result.markup += `<g transform="translate(0,${y + 5})">${header.markup}</g>`;
          result.fragments.push(...header.fragments.map(f=>({...f,rect:{...f.rect,y:f.rect.y+y+5}}))); y += header.height + 10;
          for (const row of item.rows) {
            const content:TextContent={kind:"text",owner:row.id,binding:row.binding,slot:"row.label",block:{runs:[{id:"row",parts:row.label.parts}]}};
            const layout = bindText(measureBlock(content, available, { size: 14, weight: 400, italic: false, align: "start", wrap: true, color: "#334538" }, measure),content,`${path}/row:${row.id}`,{x:0,y});
            result.markup += `<g class="diagram-field" transform="translate(0,${y})">${layout.markup}</g>`;
            result.fragments.push(...layout.fragments.map(f=>({...f,rect:{...f.rect,y:f.rect.y+y}}))); result.parts += layout.fragments.length; y += layout.height + 4;
          }
          y += 5;
        }
        result.width = available; result.height = y;
      }
    } else if (c.kind === "frame" || c.kind === "stack" || c.kind === "overlay") {
      const padding = c.kind === "frame" ? c.padding : 0, gap = c.kind === "stack" ? c.gap : 0;
      const inside = available - padding * 2, row = c.kind === "stack" && c.direction === "row";
      if (inside <= 0) throw Error("Symbol has no content allocation");
      const layouts = c.children.map((p) => child(p, row ? Math.max(1, (inside - gap * Math.max(0, c.children.length - 1)) / Math.max(1, c.children.length)) : inside));
      const active = layouts.filter((l) => l.height || l.width);
      let x = padding, y = padding, maxW = 0, maxH = 0;
      for (const layout of active) {
        const align = c.kind === "stack" ? c.align : "start";
        const offset = !row && align === "center" ? Math.max(0, (inside - layout.width) / 2) : !row && align === "end" ? Math.max(0, inside - layout.width) : 0;
        const overlay=c.kind==="overlay";
        merge(result, move(layout, x + offset - (overlay?0:layout.left), y - (overlay?0:layout.top)));
        if(overlay){result.left=Math.min(result.left,layout.left);result.top=Math.min(result.top,layout.top);}
        maxW = Math.max(maxW, x + offset + (overlay?layout.left:0) + layout.width); maxH = Math.max(maxH, y + (overlay?layout.top:0) + layout.height);
        if (c.kind !== "overlay") { if (row) x += layout.width + gap; else y += layout.height + gap; }
      }
      result.width = Math.max(c.kind === "overlay" ? 0 : available, maxW + padding)-result.left;
      result.height = Math.max(0, maxH + padding)-result.top;
      if(c.kind==="frame")result.height=Math.max(result.height,heightAllocation??0);
      if (c.kind === "frame") {
        const ink=part.style?.strokeWidth?c.strokeWidth/2:0;result.geometry.push({x:-ink,y:-ink,width:result.width+ink*2,height:result.height+ink*2});
        result.markup = `<rect class="node-body" width="${result.width}" height="${result.height}" rx="${c.radius}" style="fill:${paint(c.fill, params)};stroke:${paint(c.stroke, params)};stroke-width:${c.strokeWidth};stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:${c.dash==="dashed"?"8 5":c.dash==="dotted"?"2 4":"none"}"/>${result.markup}`;
      }
    } else if (c.kind === "transform") {
      const inner = child(c.child), angle = number(c.rotate, available, inner.height) * Math.PI / 180;
      const sx = number(c.scaleX, available, inner.height), sy = number(c.scaleY, available, inner.height);
      if (Math.abs(sx) < 1e-9 || Math.abs(sy) < 1e-9) throw Error("Singular graphical transform");
      const tx = number(c.x, available, inner.height), ty = number(c.y, available, inner.height);
      const matrix: Matrix = [Math.cos(angle) * sx, Math.sin(angle) * sx, -Math.sin(angle) * sy, Math.cos(angle) * sy, 0, 0];
      const bounds = transformRect(matrix, { x: inner.left, y: inner.top, width: inner.width, height: inner.height });
      matrix[4] = tx - bounds.x; matrix[5] = ty - bounds.y;
      result.left=Math.min(0,tx);result.top=Math.min(0,ty);
      result.width = Math.max(0, tx + bounds.width)-result.left; result.height = Math.max(0, ty + bounds.height)-result.top;
      result.markup = `<g transform="matrix(${matrix.join(" ")})">${inner.markup}</g>`;
      result.fragments.push(...inner.fragments.map((f) => ({...f, rect:transformRect(matrix,f.rect)}))); result.parts += inner.parts; result.commands += inner.commands;
      result.labels=Object.fromEntries(Object.entries(inner.labels).map(([id,label])=>[id,{...label,frame:compose(matrix,label.frame),rect:transformRect(matrix,label.rect)}]));
      result.geometry=inner.geometry.map(r=>transformRect(matrix,r));
      for (const [key, a] of Object.entries(inner.anchors)) {
        const at = point(matrix, a.x, a.y), direction = point(matrix, a.x + a.dx, a.y + a.dy);
        result.anchors[key] = { ...at, dx: direction.x - at.x, dy: direction.y - at.y };
      }
      for (const [key, r] of Object.entries(inner.content)) result.content[key] = transformRect(matrix, r);
    } else if (c.kind === "geometry") {
      const g = c.geometry, w = number(g.width, available, 0), h = number(g.height, available, 0);
      if (w <= 0 || h <= 0) throw Error("Nonpositive evaluated geometry");
      result.width = w; result.height = h;
      const ink=part.style?.strokeWidth?c.strokeWidth/2:0;result.geometry.push({x:-ink,y:-ink,width:w+ink*2,height:h+ink*2});
      const style = `style="fill:${paint(c.fill, params)};stroke:${paint(c.stroke, params)};stroke-width:${c.strokeWidth};stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:${c.dash==="dashed"?"8 5":c.dash==="dotted"?"2 4":"none"}"`;
      if (g.kind === "rectangle") result.markup = `<rect width="${w}" height="${h}" rx="${g.radius}" ${style}/>`;
      else if (g.kind === "ellipse") result.markup = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${style}/>`;
      else if (g.kind === "polyline") {
        result.markup = `<${g.closed ? "polygon" : "polyline"} points="${g.points.map((p) => `${number(p.x, w, h)},${number(p.y, w, h)}`).join(" ")}" ${style}/>`;
        result.commands = g.points.length;
      } else {
        const command = (p: PathCommand) => {
          if (p.kind === "close") return "Z";
          const xy = `${number(p.x, w, h)} ${number(p.y, w, h)}`;
          if (p.kind === "move") return `M${xy}`;
          if (p.kind === "line") return `L${xy}`;
          if (p.kind === "quadratic") return `Q${number(p.cx, w, h)} ${number(p.cy, w, h)} ${xy}`;
          return `C${number(p.cx1, w, h)} ${number(p.cy1, w, h)} ${number(p.cx2, w, h)} ${number(p.cy2, w, h)} ${xy}`;
        };
        result.markup = `<path d="${g.commands.map(command).join(" ")}" ${style}/>`;
        result.commands = g.commands.length;
      }
      pathCommands += result.commands;
      if (pathCommands > 65_536) throw Error("Rendered path command limit");
    }
    for (const a of part.anchors) {
      const connection: GraphicConnection = { x: result.left+number(a.x, result.width, result.height), y: result.top+number(a.y, result.width, result.height), dx: number(a.dx, result.width, result.height), dy: number(a.dy, result.width, result.height) };
      if (!Math.hypot(connection.dx, connection.dy)) throw Error("Anchor direction is zero");
      if (Object.hasOwn(result.anchors, a.id)) throw Error("Duplicate expanded named anchor");
      result.anchors[a.id] = connection;
    }
    for (const num of [result.width, result.height]) graphicNumber(num);
    const hitId = JSON.stringify([owner, d.id, path]);
    result.markup = `<g data-graphic-part="${graphicEscape(hitId)}">${result.markup}</g>`;
    return result;
    } catch(error) { throw Error(`Definition ${d.id}, part ${path}: ${error instanceof Error?error.message:String(error)}`); }
  };
  let result = evalPart(definition.root, definition, initialParameters, slots, width, initialPath,allocatedHeight,source,initialPath);
  for(const t of propertyTargets)if(t.target===owner&&t.editable&&!visualConsumers.has(t.key)){t.editable=false;t.reason="Visual consumer is not visible in this occurrence";}
  result.propertyTargets=propertyTargets;
  const localOwner=Object.hasOwn(definitions.propertyOverrides,owner)?definitions.propertyOverrides[owner]:undefined;
  if(localOwner){const keys=ownerKeys??authoredPropertyKeys(definitions,definition.id,instancePath);for(const key of Object.keys(localOwner))if(!keys.has(key))throw Error('Property identity is unavailable on this occurrence');}
  for(const id of Object.keys(result.labels)){const local=Object.hasOwn(definitions.propertyOverrides,id)?definitions.propertyOverrides[id]:undefined;if(local){const keys=new Set(propertyTargets.filter(t=>t.target===id).map(t=>t.key));for(const key of Object.keys(local))if(!keys.has(key))throw Error('Property identity is unavailable on this bound text block');}}

  if(result.left||result.top)result=move(result,-result.left,-result.top);
  if(definition.size){result.width=Math.max(result.width,width);result.height=Math.max(result.height,allocatedHeight??0);}
  if (definition.connectionAnchor && !Object.hasOwn(result.anchors, definition.connectionAnchor)) throw Error("Connection anchor was hidden by a condition");
  return result;
}
