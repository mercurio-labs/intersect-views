// Isolated visual prototype. No Model/Text queries or production scene contracts.
const NS = "http://www.w3.org/2000/svg";
const fields = {
  frame: ["children", "fill", "stroke", "radius", "padding", "cutCorner"],
  stack: ["children", "direction", "gap", "align"],
  overlay: ["children"],
  repeat: ["items", "child", "gap"],
  use: ["definition", "params"],
  text: ["text", "binding", "size", "weight", "italic", "color", "align", "wrap"],
  line: ["color", "dash"],
  path: ["d", "width", "height", "fill", "stroke", "strokeWidth"],
  rectangle: ["width", "height", "fill", "stroke", "radius"],
  ellipse: ["width", "height", "fill", "stroke"],
};
const base = ["kind", "id", "when"];
const own = (object, key) => Object.hasOwn(object, key);
function number(value, fallback = 0) {
  const n = value ?? fallback;
  if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 10000)
    throw new Error("Expected a finite graphical number within 10,000.");
  return n;
}
function color(value, fallback = "none") {
  const c = value ?? fallback;
  if (c !== "none" && (typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c)))
    throw new Error("Colors must be six-digit hex or none.");
  return c;
}
function element(name, attrs = {}) {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}
function value(input, context) {
  if (typeof input === "string" && input.startsWith("@")) {
    const key = input.slice(1);
    if (!own(context, key)) throw new Error(`Unknown fixture parameter: ${key}`);
    return context[key];
  }
  return input;
}
export function validateDefinitions(definitions) {
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions))
    throw new Error("Definitions must be an object.");
  const ids = Object.keys(definitions);
  if (!ids.length || ids.length > 64) throw new Error("Expected 1–64 definitions.");
  if (new TextEncoder().encode(JSON.stringify(definitions)).length > 131072)
    throw new Error("Preview definition input exceeds 128 KiB.");
  let parts = 0;
  function walk(p, depth, chain) {
    if (!p || typeof p !== "object" || Array.isArray(p) || !own(fields, p.kind))
      throw new Error(`Unsupported graphical part: ${p?.kind ?? "missing kind"}`);
    if (++parts > 4096 || depth > 16) throw new Error("Definition expansion limit exceeded.");
    if (typeof p.id !== "string" || !p.id || p.id.length > 80) throw new Error("Each part needs a bounded ID.");
    for (const key of Object.keys(p))
      if (![...base, ...fields[p.kind]].includes(key)) throw new Error(`Unknown ${p.kind} field: ${key}`);
    if (p.kind === "use") {
      if (!own(definitions, p.definition)) throw new Error(`Missing definition: ${p.definition}`);
      if (chain.includes(p.definition)) throw new Error(`Definition cycle: ${[...chain, p.definition].join(" → ")}`);
      if (p.params !== undefined && (!p.params || typeof p.params !== "object" || Array.isArray(p.params)))
        throw new Error("Use parameters must be an object.");
      walk(definitions[p.definition], depth + 1, [...chain, p.definition]);
    }
    if (p.children !== undefined) {
      if (!Array.isArray(p.children) || p.children.length > 64) throw new Error("Expected at most 64 children.");
      const names = new Set();
      for (const child of p.children) {
        if (names.has(child.id)) throw new Error(`Duplicate sibling part ID: ${child.id}`);
        names.add(child.id);
        walk(child, depth + 1, chain);
      }
    }
    if (["frame", "stack", "overlay"].includes(p.kind) && !Array.isArray(p.children))
      throw new Error(`${p.kind} requires children.`);
    if (p.kind === "repeat") walk(p.child, depth + 1, chain);
    if (p.kind === "path" && (typeof p.d !== "string" || p.d.length > 4096 || !/^[MLHVQCZmlhvqcz0-9eE., +\-]+$/.test(p.d)))
      throw new Error("Expected a bounded numeric path.");
    if (p.kind === "path" && [...p.d.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)].some(([n]) => !Number.isFinite(Number(n)) || Math.abs(Number(n)) > 10000))
      throw new Error("Path coordinates exceed the preview extent limit.");
  }
  for (const id of ids) walk(definitions[id], 0, [id]);
}
function lines(text, width, size, weight, italic, wrapping) {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("Text measurement unavailable.");
  ctx.font = `${italic ? "italic " : ""}${weight} ${size}px Segoe UI`;
  const measure = (s) => ctx.measureText(s).width;
  const result = [];
  for (const paragraph of text.replaceAll("\r\n", "\n").split("\n")) {
    if (!wrapping) { result.push(paragraph); continue; }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (measure(current ? `${current} ${word}` : word) <= width) {
        current = current ? `${current} ${word}` : word;
      } else {
        if (current) result.push(current);
        current = "";
        for (const ch of word) {
          if (current && measure(current + ch) > width) { result.push(current); current = ""; }
          current += ch;
        }
      }
    }
    result.push(current);
  }
  return result;
}
export function renderScene(definitions, scene, options) {
  validateDefinitions(definitions);
  const hits = new Map(), anchors = new Map();
  let count = 0;
  const frame = element("g"), wires = element("g"), bodies = element("g");
  frame.append(wires, bodies);
  const width = number(options.width), gap = 100, margin = 38;
  let bottom = 40;
  function hit(group, context, part, binding) {
    const id = `${context.instanceId}/${context.definition}/${part}`;
    hits.set(id, { instance: context.instanceId, definition: context.definition, part, binding: binding || "Unbound decoration" });
    group.dataset.hit = id;
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    group.setAttribute("aria-label", `${context.name ?? context.instanceId} · ${part}`);
  }
  function draw(p, context, available, path = "") {
    if (++count > 16000) throw new Error("Preview graphical part limit exceeded.");
    const group = element("g"), key = path ? `${path}/${p.id}` : p.id;
    const get = (k) => value(p[k], context);
    if (p.when !== undefined) {
      const visible = get("when");
      if (typeof visible !== "boolean") throw new Error("Visibility must be a Bool.");
      if (!visible) return { group, width: 0, height: 0 };
    }
    const result = (w, h) => ({ group, width: number(w), height: number(h) });
    if (p.kind === "use") {
      const forwarded = Object.fromEntries(Object.entries(p.params ?? {}).map(([k, v]) => [k, value(v, context)]));
      return draw(definitions[p.definition], { ...context, ...forwarded, definition: p.definition }, available, key);
    }
    if (p.kind === "text") {
      const text = get("text");
      if (typeof text !== "string" || new TextEncoder().encode(text).length > 4096 || text.includes("\t"))
        throw new Error("Text must be a String of at most 4,096 bytes without tabs.");
      const size = number(get("size"), 14), weight = get("weight") ?? 400;
      if (size < 8 || size > 40 || ![400, 500, 600, 700].includes(weight)) throw new Error("Invalid text size/weight.");
      const align = get("align") ?? "left";
      if (!["left", "center", "right"].includes(align)) throw new Error("Invalid text alignment.");
      const rows = lines(text, available, size, weight, get("italic"), get("wrap") ?? true);
      const x = align === "center" ? available / 2 : align === "right" ? available : 0;
      const el = element("text", { x, y: size, fill: color(get("color"), "#344c40"), "font-family": "Segoe UI", "font-size": size, "font-weight": weight, "text-anchor": align === "center" ? "middle" : align === "right" ? "end" : "start" });
      if (get("italic")) el.setAttribute("font-style", "italic");
      rows.forEach((row, i) => { const span = element("tspan", { x, dy: i ? size + 6 : 0 }); span.textContent = row; el.append(span); });
      group.append(el);
      const binding = get("binding");
      if (binding) {
        if (typeof binding !== "string") throw new Error("Fixture binding must be a String.");
        group.prepend(element("rect", { width: available, height: rows.length * (size + 6), fill: "transparent" }));
        hit(group, context, key, binding);
        group.dataset.textLines = rows.length;
        group.dataset.binding = binding;
      }
      return result(available, rows.length * (size + 6));
    }
    if (["frame", "stack", "overlay", "repeat"].includes(p.kind)) {
      const padding = p.kind === "frame" ? number(get("padding"), 17) : 0;
      if (padding < 0 || available - padding * 2 < (p.kind === "frame" ? 20 : 1)) throw new Error("Invalid content allocation.");
      let children = p.children ?? [];
      let contexts = children.map(() => context);
      if (p.kind === "repeat") {
        const items = get("items");
        if (!Array.isArray(items) || items.length > 64 || items.some((x) => !x || typeof x !== "object" || typeof x.id !== "string") || new Set(items.map((x) => x.id)).size !== items.length)
          throw new Error("Repeated fixture content needs unique stable IDs, at most 64 items.");
        children = items.map(() => p.child);
        contexts = items.map((item) => ({ ...context, ...item, slotItem: item.id }));
      }
      const horizontal = p.kind === "stack" && get("direction") === "row";
      if (p.kind === "stack" && !["row", "column", undefined].includes(get("direction"))) throw new Error("Invalid stack direction.");
      const gap = number(get("gap"), 8), interior = available - padding * 2;
      const alignment = get("align") ?? "start";
      if (!["start", "center"].includes(alignment)) throw new Error("Invalid stack alignment.");
      if (gap < 0) throw new Error("Negative gap.");
      const childWidth = horizontal ? (interior - gap * Math.max(0, children.length - 1)) / Math.max(1, children.length) : interior;
      let x = padding, y = padding, maxHeight = 0;
      children.forEach((child, i) => {
        const suffix = p.kind === "repeat" ? `${key}/${contexts[i].slotItem}` : key;
        const item = draw(child, contexts[i], childWidth, suffix);
        if (!item.height) return;
        item.group.setAttribute("transform", `translate(${!horizontal && alignment === "center" ? padding + (interior - item.width) / 2 : x},${y})`);
        group.append(item.group);
        maxHeight = Math.max(maxHeight, item.height);
        if (p.kind === "overlay") return;
        if (horizontal) x += childWidth + gap;
        else y += item.height + gap;
      });
      const height = p.kind === "overlay" || horizontal ? maxHeight + padding * 2 : Math.max(0, y - gap) + padding;
      if (p.kind === "frame") {
        const corner = number(get("cutCorner"), 0), radius = number(get("radius"), 6);
        if (corner < 0 || corner > Math.min(available, height) / 2 || radius < 0) throw new Error("Invalid frame corner geometry.");
        const style = { class: "body", fill: color(get("fill"), "#ffffff"), stroke: color(get("stroke"), "#496957"), "stroke-width": 1.4 };
        if (corner) {
          group.prepend(element("path", { ...style, d: `M0 0 H${available - corner} L${available} ${corner} V${height} H0 Z M${available - corner} 0 V${corner} H${available}` }));
        } else group.prepend(element("rect", { ...style, width: available, height, rx: radius }));
        hit(group, context, key, context.fixtureKey);
      }
      return result(available, height);
    }
    if (p.kind === "line") {
      group.append(element("path", { d: `M0 3 H${available}`, stroke: color(get("color"), "#b6cbbd"), "stroke-dasharray": get("dash") ? "5 4" : "none", fill: "none" }));
      return result(available, 7);
    }
    const w = number(get("width"), available), h = number(get("height"), 20);
    if (w <= 0 || h <= 0) throw new Error("Geometry dimensions must be positive.");
    const strokeWidth = number(get("strokeWidth"), 1.5);
    if (strokeWidth < 0 || strokeWidth > 50) throw new Error("Invalid stroke width.");
    const attrs = { fill: color(get("fill")), stroke: color(get("stroke"), "#496957"), "stroke-width": strokeWidth };
    if (p.kind === "rectangle") group.append(element("rect", { ...attrs, width: w, height: h, rx: number(get("radius"), 0) }));
    if (p.kind === "ellipse") group.append(element("ellipse", { ...attrs, cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 }));
    if (p.kind === "path") group.append(element("path", { ...attrs, d: p.d }));
    return result(w, h);
  }
  if (scene.rows.length > 6) throw new Error("Too many preview rows.");
  for (const row of scene.rows) {
    let rowHeight = 0;
    row.forEach((instance, i) => {
      if (!own(definitions, instance.definition)) throw new Error("Unknown instance definition.");
      const context = { ...instance.params, showDoc: options.documentation, instanceId: instance.id, definition: instance.definition };
      if (options.theme === "mono") { context.fill = "#ffffff"; context.ink = "#48564d"; }
      const node = draw(definitions[instance.definition], context, width);
      const x = margin + i * (width + gap), y = bottom;
      const group = element("g", { transform: `translate(${x},${y})`, "data-instance": instance.id, "data-width": width, "data-height": node.height });
      group.append(node.group);
      const portX = width, portY = Math.min(54, node.height / 2), angle = options.rotation;
      const port = draw(definitions.terminal, { ...context, definition: "terminal" }, 16, "port");
      const portGroup = element("g", { transform: `translate(${portX},${portY}) rotate(${angle}) translate(-8,-8)`, "data-terminal": instance.id });
      portGroup.append(port.group);
      group.append(portGroup);
      const radians = angle * Math.PI / 180;
      const anchor = { x: x + portX + 8 * Math.cos(radians), y: y + portY + 8 * Math.sin(radians) };
      portGroup.dataset.anchor = JSON.stringify(anchor);
      anchors.set(instance.id, { east: anchor, west: { x, y: y + Math.min(54, node.height / 2) } });
      bodies.append(group);
      rowHeight = Math.max(rowHeight, node.height);
    });
    bottom += rowHeight + 66;
  }
  for (const edge of scene.edges) {
    const start = anchors.get(edge.source)?.east, end = anchors.get(edge.target)?.west;
    if (!start || !end) throw new Error("Unresolved fixture endpoint.");
    const mid = (start.x + end.x) / 2;
    const route = element("path", { d: `M${start.x} ${start.y} H${mid} V${end.y} H${end.x}`, fill: "none", stroke: "#75877a", "stroke-width": 1.4, "data-edge": edge.id, "data-start": JSON.stringify(start), "data-end": JSON.stringify(end) });
    wires.append(route);
    const marker = draw(definitions[edge.marker ?? "diamond"], { instanceId: edge.id, definition: edge.marker ?? "diamond" }, 16, "marker");
    marker.group.setAttribute("transform", `translate(${start.x},${start.y}) translate(-8,-8)`);
    wires.append(marker.group);
    const label = element("text", { x: mid + 8, y: (start.y + end.y) / 2 - 9, fill: "#8b988e", "font-family": "Segoe UI", "font-size": 10 });
    label.textContent = edge.label;
    wires.append(label);
  }
  const columns = Math.max(...scene.rows.map((r) => r.length));
  const svg = element("svg", { viewBox: `0 0 ${margin * 2 + columns * width + (columns - 1) * gap} ${bottom - 20}`, role: "group", "aria-label": scene.title });
  svg.append(frame);
  return { svg, hits, parts: count };
}
