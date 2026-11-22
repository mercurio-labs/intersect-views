/** Strict data-only SVG notation. Colors are tokens or hex, never markup/URLs. */
export interface NodeStyle {
  shape: "rectangle" | "rounded" | "ellipse" | "diamond";
  fill: string;
  stroke: string;
  radius?: number;
}
export interface EdgeStyle {
  line: "solid" | "dashed" | "dotted";
  stroke: string;
  startMarker: "none" | "arrow" | "triangle";
  endMarker: "none" | "arrow" | "triangle";
}
export interface NotationProfile {
  schemaVersion: 1;
  id: string;
  shapes: Record<string, NodeStyle>;
  edges?: Record<string, EdgeStyle>;
  styleClasses?: Record<
    string,
    { node?: Partial<NodeStyle>; edge?: Partial<EdgeStyle> }
  >;
  icons?: Record<string, string>;
}
const colors =
  /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|neutral|usage|definition|package|transparent)$/;
const object = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid notation object");
  return v;
};
function keys(
  v: Record<string, any>,
  allowed: string[],
  required: string[] = [],
) {
  if (
    Object.keys(v).some((k) => !allowed.includes(k)) ||
    required.some((k) => !(k in v))
  )
    throw new Error("Invalid notation fields");
}
function style(v: unknown, node: boolean, partial = false) {
  const o = object(v),
    allowed = node
      ? ["shape", "fill", "stroke", "radius"]
      : ["line", "stroke", "startMarker", "endMarker"];
  keys(o, allowed, partial ? [] : allowed.filter((k) => k !== "radius"));
  for (const [k, x] of Object.entries(o)) {
    if (k === "fill" || k === "stroke") {
      if (typeof x !== "string" || !colors.test(x))
        throw new Error("Invalid notation color");
    } else if (k === "radius") {
      if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 100)
        throw new Error("Invalid radius");
    } else {
      const choices =
        k === "shape"
          ? ["rectangle", "rounded", "ellipse", "diamond"]
          : k === "line"
            ? ["solid", "dashed", "dotted"]
            : ["none", "arrow", "triangle"];
      if (!choices.includes(x)) throw new Error("Invalid notation style");
    }
  }
}
export function validateNotation(
  value: unknown,
): asserts value is NotationProfile {
  const p = object(value);
  keys(
    p,
    ["schemaVersion", "id", "shapes", "edges", "styleClasses", "icons"],
    ["schemaVersion", "id", "shapes"],
  );
  if (p.schemaVersion !== 1 || typeof p.id !== "string" || !p.id.trim())
    throw new Error("Invalid notation identity");
  for (const mapName of ["shapes", "edges", "styleClasses", "icons"])
    if (mapName in p) {
      const map = object(p[mapName]);
      if (Object.keys(map).length > 256) throw new Error("Notation map limit");
      for (const [id, v] of Object.entries(map)) {
        if (!id.trim()) throw new Error("Empty notation key");
        if (mapName === "shapes" || mapName === "edges")
          style(v, mapName === "shapes");
        else if (mapName === "icons") {
          if (typeof v !== "string" || !v.trim() || [...v].length > 16)
            throw new Error("Invalid icon");
        } else {
          const o = object(v);
          keys(o, ["node", "edge"]);
          if ("node" in o) style(o.node, true, true);
          if ("edge" in o) style(o.edge, false, true);
        }
      }
    }
}
export function color(value: string): string {
  return (
    (
      {
        neutral: "var(--blue, #64748b)",
        usage: "color-mix(in srgb, var(--bg, white) 91%, #99bee9)",
        definition: "color-mix(in srgb, var(--bg, white) 88%, #c7dcad)",
        package: "color-mix(in srgb, var(--bg, white) 85%, #ecd6a1)",
      } as Record<string, string>
    )[value] ?? value
  );
}
