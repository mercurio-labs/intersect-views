/** Opt-in visual parameters. No JSON paths, semantic fields or executable editors. */
import {
  accepts,
  graphicObject,
  graphicArray,
  graphicId,
  graphicNumber,
  graphicColor,
  type GraphicValue,
  type GraphicPart,
  type GraphicContent,
  type SymbolDefinition,
} from "./graphics-contract.ts";
import { logicalId } from "./logical-id.ts";
export type PropertyEditor =
  | { kind: "color" }
  | { kind: "bool" }
  | { kind: "choice" }
  | { kind: "number"; minimum: number; maximum: number };
export interface SymbolProperty {
  id: string;
  parameter: string;
  label: string;
  group: string;
  description: string;
  editor: PropertyEditor;
  editable: boolean;
}
export type StyleProperty =
  | "fillEnabled"
  | "fill"
  | "stroke"
  | "strokeWidth"
  | "dash"
  | "radius"
  | "textColor"
  | "fontSize"
  | "fontWeight"
  | "italic"
  | "alignment"
  | "wrap";
export type GraphicStyle = Partial<
  Record<StyleProperty, { parameter: string }>
>;
export type SymbolOverrides = Record<string, Record<string, GraphicValue>>;
export interface PropertyTarget {
  target: string;
  key: string;
  definition: string;
  version: string;
  path: string;
  descriptor: SymbolProperty;
  inherited: GraphicValue;
  current: GraphicValue;
  origin: "package" | "rule" | "owner" | "local";
  editable: boolean;
  reason: string;
  choices?: string[];
}
const encoder = new TextEncoder();
const targetBytes = new WeakMap<PropertyTarget[], number>();
export function propertyKey(
  d: SymbolDefinition,
  path: string,
  p: SymbolProperty,
) {
  return logicalId("property", [d.id, d.version, path, p.id, p.parameter]);
}
export function checkPropertyValue(
  d: SymbolDefinition,
  p: SymbolProperty,
  value: GraphicValue,
): void {
  const parameter = d.parameters[p.parameter];
  if (!parameter || !accepts(parameter, value))
    throw Error(`Property ${p.id} has the wrong value type`);
  const e = p.editor,
    valid =
      e.kind === "color"
        ? parameter.kind === "string" &&
          typeof value === "string" &&
          graphicColor(value)
        : e.kind === "number"
          ? parameter.kind === "number" &&
            typeof value === "number" &&
            value >= e.minimum &&
            value <= e.maximum
          : e.kind === "bool"
            ? parameter.kind === "bool" && typeof value === "boolean"
            : parameter.kind === "choice" && typeof value === "string";
  if (!valid) throw Error(`Property ${p.id} violates its editor bounds/type`);
}
function references(value: unknown, name: string): boolean {
  if (Array.isArray(value)) return value.some((v) => references(v, name));
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.parameter === name ||
    (v.name === name &&
      (["parameter", "equal"].includes(v.op as string) ||
        v.kind === "parameter")) ||
    Object.values(v).some((v) => references(v, name))
  );
}
function visualUses(part: GraphicPart, name: string): number {
  const value = structuredClone(part) as unknown as Record<string, any>;
  let count = Object.values(part.style ?? {}).filter(
    (v) => v.parameter === name,
  ).length;
  delete value.style;
  const c = value.content,
    fields = ["frame", "geometry"].includes(c.kind)
      ? ["fill", "stroke"]
      : c.kind === "text"
        ? ["color"]
        : [];
  for (const field of fields)
    if (c[field]?.parameter === name) {
      delete c[field];
      count++;
    }
  delete c.children;
  delete c.child;
  if (references(value, name))
    throw Error(
      "A visual property parameter cannot control visibility, anchors, geometry, forwarding or semantic content; declare it on the consuming definition",
    );
  const original = part.content;
  if (
    original.kind === "frame" ||
    original.kind === "stack" ||
    original.kind === "overlay"
  )
    for (const p of original.children) count += visualUses(p, name);
  else if (original.kind === "transform")
    count += visualUses(original.child, name);
  return count;
}
export function validateProperties(d: SymbolDefinition): void {
  const ids = new Set<string>(),
    params = new Set<string>();
  for (const v of graphicArray(d.properties ?? [], 32)) {
    const p = graphicObject(v, [
      "id",
      "parameter",
      "label",
      "group",
      "description",
      "editor",
      "editable",
    ]) as unknown as SymbolProperty;
    graphicId(p.id);
    graphicId(p.parameter);
    for (const [value, limit] of [
      [p.label, 256],
      [p.group, 128],
      [p.description, 2048],
    ] as const)
      if (
        typeof value !== "string" ||
        !value ||
        encoder.encode(value).length > limit ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(value)
      )
        throw Error("Invalid property display text");
    if (
      typeof p.editable !== "boolean" ||
      ids.has(p.id) ||
      params.has(p.parameter)
    )
      throw Error("Duplicate/invalid property descriptor");
    ids.add(p.id);
    params.add(p.parameter);
    const e = graphicObject(p.editor);
    if (e.kind === "number") {
      graphicObject(e, ["kind", "minimum", "maximum"]);
      graphicNumber(e.minimum);
      graphicNumber(e.maximum);
      if (e.minimum > e.maximum) throw Error("Reversed property number bounds");
    } else if (["color", "bool", "choice"].includes(e.kind as string))
      graphicObject(e, ["kind"]);
    else throw Error("Unsupported property editor");
    if (!Object.hasOwn(d.parameters, p.parameter))
      throw Error("Property references an undeclared parameter");
    checkPropertyValue(d, p, d.parameters[p.parameter].default);
    if (d.size && references(d.size, p.parameter))
      throw Error("Visual property controls authored sizing expressions");
    if (!visualUses(d.root, p.parameter))
      throw Error("Property parameter has no visual consumer");
  }
}
const numbers: Partial<Record<StyleProperty, [number, number]>> = {
  strokeWidth: [0, 100],
  radius: [0, 128],
  fontSize: [6, 96],
  fontWeight: [100, 900],
};
const choices: Partial<Record<StyleProperty, string[]>> = {
  dash: ["solid", "dashed", "dotted"],
  alignment: ["start", "center", "end"],
};
export function validateStyle(part: GraphicPart, d: SymbolDefinition): void {
  if (part.style === undefined) return;
  const style = graphicObject(part.style),
    c = part.content;
  for (const [key, value] of Object.entries(style)) {
    const ref = graphicObject(value, ["parameter"]);
    graphicId(ref.parameter);
    const p = d.properties?.find((p) => p.parameter === ref.parameter);
    if (!p) throw Error("Style parameter needs a declared visual property");
    const appearance = c.kind === "frame" || c.kind === "geometry",
      text = c.kind === "text",
      k = key as StyleProperty;
    const allowed = [
      "fillEnabled",
      "fill",
      "stroke",
      "strokeWidth",
      "dash",
    ].includes(k)
      ? appearance
      : k === "radius"
        ? c.kind === "frame" ||
          (c.kind === "geometry" && c.geometry.kind === "rectangle")
        : [
              "textColor",
              "fontSize",
              "fontWeight",
              "italic",
              "alignment",
              "wrap",
            ].includes(k)
          ? text
          : false;
    const type = d.parameters[p.parameter],
      range = numbers[k],
      choice = choices[k];
    const valid = range
      ? p.editor.kind === "number" &&
        p.editor.minimum >= range[0] &&
        p.editor.maximum <= range[1]
      : choice
        ? p.editor.kind === "choice" &&
          type.kind === "choice" &&
          type.values.every((v) => choice.includes(v))
        : ["fill", "stroke", "textColor"].includes(k)
          ? p.editor.kind === "color"
          : p.editor.kind === "bool";
    if (!allowed || !valid)
      throw Error(`Style property ${key} has an incompatible consumer/editor`);
  }
}
export function evaluatedStyle(
  part: GraphicPart,
  values: Record<string, GraphicValue>,
): void {
  for (const [key, ref] of Object.entries(part.style ?? {})) {
    const v = Object.hasOwn(values, ref.parameter)
        ? values[ref.parameter]
        : undefined,
      k = key as StyleProperty,
      range = numbers[k],
      choice = choices[k];
    const valid = range
      ? typeof v === "number" &&
        Number.isFinite(v) &&
        v >= range[0] &&
        v <= range[1]
      : choice
        ? typeof v === "string" && choice.includes(v)
        : ["fill", "stroke", "textColor"].includes(k)
          ? typeof v === "string" && graphicColor(v)
          : typeof v === "boolean";
    if (!valid) throw Error(`Invalid evaluated style property ${key}`);
  }
}
export function applyGraphicStyle(
  part: GraphicPart,
  values: Record<string, GraphicValue>,
): GraphicContent {
  if (!part.style) return part.content;
  evaluatedStyle(part, values);
  const c = { ...part.content },
    style = part.style;
  for (const [key, ref] of Object.entries(style)) {
    const v = values[ref.parameter];
    if (key === "fillEnabled") {
      if (!v && (c.kind === "frame" || c.kind === "geometry")) c.fill = "none";
      continue;
    }
    if (
      key === "radius" &&
      c.kind === "geometry" &&
      c.geometry.kind === "rectangle"
    ) {
      c.geometry = { ...c.geometry, radius: v as number };
      continue;
    }
    const field =
      (
        {
          textColor: "color",
          fontSize: "size",
          fontWeight: "weight",
          alignment: "align",
        } as Record<string, string>
      )[key] ?? key;
    (c as unknown as Record<string, unknown>)[field] = v;
  }
  // Fill enabled is authoritative regardless of lexical field ordering.
  if (
    style.fillEnabled &&
    values[style.fillEnabled.parameter] === false &&
    (c.kind === "frame" || c.kind === "geometry")
  )
    c.fill = "none";
  return c;
}
export function validateSymbolOverrides(
  value: unknown,
): asserts value is SymbolOverrides {
  const owners = graphicObject(value);
  if (Object.keys(owners).length > 20000)
    throw Error("Symbol property target limit");
  let count = 0,
    bytes = 0;
  for (const [id, v] of Object.entries(owners)) {
    graphicId(id);
    const props = graphicObject(v);
    if (Object.keys(props).length > 32)
      throw Error("Symbol property count limit");
    bytes += encoder.encode(id).length;
    if (bytes > 1048576) throw Error("Symbol property value budget");
    for (const [key, value] of Object.entries(props)) {
      if (!/^property:[a-f0-9]{64}$/.test(key))
        throw Error("Malformed qualified property identity");
      if (typeof value === "number") graphicNumber(value);
      else if (typeof value !== "boolean" && typeof value !== "string")
        throw Error("Invalid property value type");
      if (
        typeof value === "string" &&
        (encoder.encode(value).length > 4096 ||
          /[\u0000-\u001f\u007f-\u009f]/u.test(value))
      )
        throw Error("Invalid property string");
      bytes +=
        encoder.encode(key).length +
        (typeof value === "string" ? encoder.encode(value).length : 16) +
        64;
      if (++count > 64000 || bytes > 1048576)
        throw Error("Symbol property value budget");
    }
  }
}
/** Resolve only declared visual parameters. Rule-provided values are protected. */
export function resolveProperties(
  d: SymbolDefinition,
  target: string,
  path: string,
  values: Record<string, GraphicValue>,
  source: Set<string>,
  overrides: SymbolOverrides,
  targets: PropertyTarget[],
  names?: Set<string>,
  owner?: string,
): Record<string, GraphicValue> {
  if (!d.properties?.some((p) => !names || names.has(p.parameter)))
    return values;
  const result = { ...values },
    local = Object.hasOwn(overrides, target) ? overrides[target] : {},
    known = new Set<string>();
  for (const p of d.properties ?? []) {
    if (names && !names.has(p.parameter)) continue;
    const key = propertyKey(d, path, p);
    known.add(key);
    const editable = p.editable && !source.has(p.parameter),
      present = Object.hasOwn(local, key),
      inherited = values[p.parameter];
    checkPropertyValue(d, p, inherited);
    if (present) {
      if (!editable)
        throw Error(`Property ${p.label} is protected by its source rule`);
      checkPropertyValue(d, p, local[key]);
      result[p.parameter] = local[key];
    }
    const inheritedOwner =
      owner !== undefined &&
      Object.hasOwn(overrides, owner) &&
      Object.hasOwn(overrides[owner], key);
    const bytes =
      (targetBytes.get(targets) ?? 0) +
      encoder.encode(
        target +
          key +
          d.id +
          path +
          p.label +
          p.group +
          p.description +
          String(inherited) +
          String(result[p.parameter]),
      ).length +
      128;
    if (targets.length >= 64000 || bytes > 16 * 1024 * 1024)
      throw Error("Evaluated property metadata budget exceeded");
    targetBytes.set(targets, bytes);
    targets.push({
      choices:
        d.parameters[p.parameter].kind === "choice"
          ? (d.parameters[p.parameter] as { values: string[] }).values
          : undefined,
      target,
      key,
      definition: d.id,
      version: d.version,
      path,
      descriptor: p,
      inherited,
      current: result[p.parameter],
      origin: present
        ? "local"
        : source.has(p.parameter)
          ? "rule"
          : inheritedOwner
            ? "owner"
            : "package",
      editable,
      reason: !p.editable
        ? "The definition declares this property read only"
        : source.has(p.parameter)
          ? "Value supplied by a source rule; edit its source instead"
          : "",
    });
  }
  // Other reuse paths on this same symbol are checked at their own consumers.
  return result;
}

export function requirePropertyCapability(
  library: { definitions: { properties?: SymbolProperty[] }[] },
  requires: string[],
) {
  if (
    library.definitions.some((d) => d.properties?.length) &&
    !requires.includes("views.symbolProperties.v1")
  )
    throw Error("Property descriptors require views.symbolProperties.v1");
}

/** All authored reuse paths, including presently hidden parts, qualify owner keys. */
export function authoredPropertyKeys(
  definitions: import("./graphics-contract.ts").GraphicDefinitions,
  definition: string,
  instancePath?: string,
): Set<string> {
  const keys = new Set<string>();
  let work = 0;
  const visit = (d: SymbolDefinition, path: string) => {
    for (const p of d.properties ?? []) keys.add(propertyKey(d, path, p));
    part(d.root, path);
  };
  const part = (p: GraphicPart, prefix: string) => {
    if (++work > 50000) throw Error("Property qualification work limit");
    const path = `${prefix}/${p.id}`,
      c = p.content;
    if (c.kind === "use") {
      const d = definitions.definition(c.definition);
      visit(d, `${path}/${d.id}`);
    } else if (c.kind === "transform") part(c.child, path);
    else if (c.kind === "frame" || c.kind === "stack" || c.kind === "overlay")
      for (const child of c.children) part(child, path);
  };
  const d = definitions.definition(definition);
  visit(d, instancePath ? `${instancePath}/${d.id}` : d.id);
  return keys;
}
