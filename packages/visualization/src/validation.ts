import { validateRoutingPolicy, validateRouteConstraint, validateLabelPlacement } from "./routing-contract.ts";
import type { Binding } from "./protocol.ts";
import { validateProjection } from "./rendering.ts";
import { validateGraphicRule, validateTextBlock, validatePresentationContext, validateGraphicInstance, graphicId, graphicObject } from "./graphics-contract.ts";
import { validateLaneScene, validateLaneRules } from "./lane-validation.ts";
import { label, labelRule } from "./graph-validation.ts";
import { validateGridScene, validateGridRules } from "./grid-validation.ts";
/** Structural checks only, shared fixtures with the Rust wire contract. */
import type {
  Scene,
  SceneResponse,
  Scope,
  ViewDocument,
  RuleSet,
  Presentation,
  PreparedEdit,
  TargetResponse,
} from "./protocol.ts";
type ObjectValue = Record<string, unknown>;
export function validateTargets(
  value: unknown,
): asserts value is TargetResponse {
  const v = object(value, [
    "revision",
    "viewKey",
    "toolId",
    "source",
    "symbols",
  ]);
  integer(v.revision);
  text(v.viewKey, true);
  text(v.toolId, true);
  if (v.source !== null) text(v.source, true);
  const ids = list(v.symbols),
    seen = new Set<string>();
  if (ids.length > 1500) throw new Error("Targets exceed node and port limits");
  for (const id of ids) {
    text(id, true);
    if (seen.has(id)) throw new Error("Duplicate target symbol");
    seen.add(id);
  }
}
export function validatePreparedEdit(
  value: unknown,
): asserts value is PreparedEdit {
  const p = object(value, [
    "schemaVersion",
    "token",
    "baseRevision",
    "nextRevision",
    "patches",
    "created",
  ]);
  if (p.schemaVersion !== 1) throw new Error("Invalid prepared version");
  text(p.token, true);
  text(p.created);
  integer(p.baseRevision);
  integer(p.nextRevision);
  if ((p.nextRevision as number) <= (p.baseRevision as number))
    throw new Error("Invalid candidate revision");
  const patches = list(p.patches),
    seen = new Set<string>();
  if (!patches.length) throw new Error("Empty prepared edit");
  for (const patch of patches) {
    const v = object(patch, [
      "uri",
      "range",
      "original",
      "replacement",
      "beforeHash",
      "afterHash",
    ]);
    text(v.uri, true);
    text(v.original);
    text(v.replacement);
    if (seen.has(v.uri))
      throw new Error("More than one patch per buffer is unsupported");
    seen.add(v.uri);
    for (const h of [v.beforeHash, v.afterHash])
      if (typeof h !== "string" || !/^[a-f0-9]{64}$/.test(h))
        throw new Error("Invalid buffer hash");
    const r = object(v.range, ["start", "end"]);
    for (const pos of [r.start, r.end]) {
      const x = object(pos, ["line", "character"]);
      integer(x.line);
      integer(x.character);
    }
  }
}
export function object(
  value: unknown,
  required: string[],
  optional: string[] = [],
): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a contract object");
  const result = value as ObjectValue,
    allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(result, key)) ||
    Object.keys(result).some((key) => !allowed.has(key))
  )
    throw new Error("Missing or unknown contract field");
  return result;
}
export function text(
  value: unknown,
  nonempty = false,
): asserts value is string {
  if (typeof value !== "string" || (nonempty && !value))
    throw new Error("Expected a contract string");
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected a contract array");
  return value;
}
export function integer(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error("Invalid portable JSON integer");
}
export function binding(value: unknown) {
  const b = object(value, [
    "key",
    "elementId",
    "context",
    "uri",
    "range",
    "readOnly",
  ]);
  for (const key of ["key", "elementId", "uri"]) text(b[key], true);
  for (const context of list(b.context)) text(context, true);
  if (typeof b.readOnly !== "boolean")
    throw new Error("Invalid read-only flag");
  const range = object(b.range, ["start", "end"]),
    start = object(range.start, ["line", "character"]),
    end = object(range.end, ["line", "character"]);
  for (const p of [start, end]) {
    integer(p.line);
    integer(p.character);
  }
  if (
    (end.line as number) < (start.line as number) ||
    (end.line === start.line &&
      (end.character as number) < (start.character as number))
  )
    throw new Error("Invalid UTF-16 source range");
}
function field(value: unknown, row = false) {
  const f = object(value, ["label", "binding", ...(row ? ["id"] : [])]);
  if (row) text(f.id, true);
  text(f.label);
  binding(f.binding);
}
export function validateScene(value: unknown): asserts value is Scene {
  if ((value as { form?: string })?.form === "laneGraph") {
    validateLaneScene(value);
    return;
  }
  if ((value as { form?: string })?.form === "grid") {
    validateGridScene(value);
    return;
  }
  const scene = object(value, [
    "schemaVersion",
    "form",
    "ruleSet",
    "revision",
    "view",
    "nodes",
    "edges",
    "palette",
    "problems",
    "layout", "routing", "endpointProxies",
  ]);
  validateRoutingPolicy(scene.routing);
  if (scene.schemaVersion !== 7) throw new Error("Unsupported scene version");
  if (scene.form !== "graph") throw new Error("Unsupported scene form");
  validateSceneEnvelope(scene);
  const layout = object(scene.layout, ["strategy", "direction"]);
  if (
    layout.strategy !== "layered" ||
    !["RIGHT", "LEFT", "UP", "DOWN"].includes(layout.direction as string)
  )
    throw new Error("Unsupported layout hints");
  const ids = new Set<string>(),
    endpoints = new Set<string>();
  const collapsedOwners = new Map<string, Binding>();
  let nodes = 0,
    ports = 0,
    rows = 0,
    regions = 0,
    parts = 0, textBytes = 0;
  const actions = new Set(
    (
      scene.palette as {
        groups: { entries: { id: string; gesture: string }[] }[];
      }
    ).groups.flatMap((g) =>
      g.entries.filter((t) => t.gesture === "action").map((t) => t.id),
    ),
  );
  const checkLabel = (v: unknown, b: unknown) => {
    parts += label(v, b, add, actions);
    if (parts > 20000) throw new Error("Graph label parts limit");
  };
  const textMap = (value: unknown, owner: unknown) => {
    const blocks = graphicObject(value);
    if (Object.keys(blocks).length > 32) throw Error("TextBlock map limit");
    for (const [key,block] of Object.entries(blocks)) {
      graphicId(key);
      const size = validateTextBlock(block, owner, add); parts += size.parts; textBytes += size.bytes;
      if (parts > 20_000 || textBytes > 1_048_576) throw Error("Scene text budget exceeded");
    }
  };
  const graphic = (value: unknown) => {
    if (value === null) return;
    validateGraphicInstance(value);
  };
  const add = (id: unknown, endpoint: boolean) => {
    text(id, true);
    if (ids.has(id)) throw new Error("Duplicate scene identity");
    ids.add(id);
    if (endpoint) endpoints.add(id);
  };
  function node(value: unknown, depth: number) {
    if (++nodes > 500 || depth > 16)
      throw new Error("Scene node or nesting budget exceeded");
    const n = object(value, [
      "id",
      "rule",
      "styleClass",
      "expand",
      "collapsed",
      "notation",
      "title",
      "subtitle",
      "binding",
      "compartments",
      "children",
      "regions",
      "ports", "graphic", "text",
    ]);
    add(n.id, true);
    text(n.rule, true);
    text(n.styleClass);
    if (typeof n.collapsed !== "boolean")
      throw new Error("Invalid collapsed flag");
    const expansions = new Set<string>();
    for (const value of list(n.expand)) {
      const option = object(value, ["id", "label"]);
      text(option.id, true);
      text(option.label, true);
      if (expansions.has(option.id)) throw new Error("Duplicate expand option");
      expansions.add(option.id);
    }
    binding(n.binding);
    if(n.collapsed)collapsedOwners.set(n.id as string,n.binding as Binding);
    text(n.notation);
    checkLabel(n.title, n.binding);
    checkLabel(n.subtitle, n.binding);
    graphic(n.graphic); textMap(n.text, n.binding);
    for (const item of list(n.ports)) {
      if (++ports > 1000) throw new Error("Scene port budget exceeded");
      const p = object(item, ["id", "rule", "label", "side", "binding", "graphic", "text"]);
      text(p.rule, true);
      add(p.id, true);
      binding(p.binding);
      checkLabel(p.label, p.binding);
      graphic(p.graphic); textMap(p.text, p.binding);
      if (!["NORTH", "SOUTH", "WEST", "EAST"].includes(p.side as string))
        throw new Error("Unsupported port side");
    }
    for (const item of list(n.compartments)) {
      const c = object(item, ["id", "label", "rows"]);
      add(c.id, false);
      text(c.label);
      for (const row of list(c.rows)) {
        if (++rows > 5000) throw new Error("Scene row budget exceeded");
        const r = row as ObjectValue;
        add(r.id, false);
        const checked = object(row, ["id", "label", "binding"]);
        binding(checked.binding);
        checkLabel(checked.label, checked.binding);
      }
    }
    const membership = new Set<string>();
    for (const child of list(n.children)) {
      const id = (child as { binding: { elementId: string } }).binding
        ?.elementId;
      if (membership.has(id)) throw new Error("Duplicate membership");
      membership.add(id);
      node(child, depth + 1);
    }
    if (n.regions !== null) {
      const set = object(n.regions, ["direction", "items"]),
        items = list(set.items);
      if (
        !["row", "column"].includes(set.direction as string) ||
        items.length > 16
      )
        throw new Error("Region direction/per-node limit");
      for (const value of items) {
        if (++regions > 256 || depth + 1 > 16)
          throw new Error("Region count/depth limit");
        const r = object(value, [
          "id",
          "rule",
          "label",
          "binding",
          "collapsed",
          "children",
        ]);
        add(r.id, false);
        text(r.rule, true);
        binding(r.binding);
        if(r.collapsed)collapsedOwners.set(r.id as string,r.binding as Binding);
        if (membership.has((r.binding as { elementId: string }).elementId))
          throw new Error("Region/node collision");
        checkLabel(r.label, r.binding);
        if (
          typeof r.collapsed !== "boolean" ||
          (r.collapsed && list(r.children).length)
        )
          throw new Error("Invalid collapsed region");
        for (const child of list(r.children)) {
          const id = (child as { binding: { elementId: string } }).binding
            ?.elementId;
          if (membership.has(id)) throw new Error("graph.region.membership");
          membership.add(id);
          node(child, depth + 2);
        }
      }
    }
    if (
      n.collapsed &&
      (list(n.children).length ||
        list(n.ports).length ||
        (n.regions !== null &&
          list((n.regions as { items: unknown }).items).length))
    )
      throw new Error("Collapsed node has hidden content");
  }
  for (const root of list(scene.nodes)) node(root, 0);
  const proxies=list(scene.endpointProxies);
  if(proxies.length>1500 || endpoints.size+proxies.length>1500)throw Error("Scene endpoint proxy budget exceeded");
  for(const value of proxies) {
    const proxy=object(value,["id","displayOwner","binding","label"]);
    add(proxy.id,true);text(proxy.displayOwner,true);binding(proxy.binding);
    const bound=proxy.binding as Binding;
    let nearest:string|undefined,depth=-1,ambiguous=false;
    for(const [id,owner] of collapsedOwners) {
      const n=owner.context.length;
      if(bound.context.length>n && owner.context.every((key,i)=>key===bound.context[i]) && bound.context[n]===owner.key) {
        if(n>depth){nearest=id;depth=n;ambiguous=false;}
        else if(n===depth)ambiguous=true;
      }
    }
    if(ambiguous || nearest!==proxy.displayOwner)throw Error("Proxy has no unique nearest visible collapsed owner");
    checkLabel(proxy.label,bound);
    if((proxy.label as import("./protocol.ts").Label).parts.some(p=>p.editTool!==null))throw Error("Endpoint proxy cannot carry a semantic edit target");
  }
  const branchSources=new Map<string,string>();
  const edges = list(scene.edges);
  if (edges.length > 2000) throw new Error("Scene edge budget exceeded");
  for (const item of edges) {
    const edge = object(item, [
      "id",
      "rule",
      "styleClass",
      "notation",
      "label",
      "source",
      "target",
      "binding", "startMarker", "endMarker", "text", "branchGroup",
    ]);
    add(edge.id, false);
    text(edge.rule, true);
    if(edge.branchGroup!==null) {
      text(edge.branchGroup,true);text(edge.source,true);
      const previous=branchSources.get(edge.branchGroup);
      if(scene.routing.trunks!=="siblings" || (previous!==undefined && previous!==edge.source))throw Error("Invalid branch group policy or common source");
      branchSources.set(edge.branchGroup,edge.source);
    }
    text(edge.styleClass);
    text(edge.notation);
    binding(edge.binding);
    checkLabel(edge.label, edge.binding);
    graphic(edge.startMarker); graphic(edge.endMarker); textMap(edge.text, edge.binding);
    if (
      !endpoints.has(edge.source as string) ||
      !endpoints.has(edge.target as string)
    )
      throw new Error("Unbound scene edge");
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 8 * 1024 * 1024)
    throw new Error("Graph encoded scene limit");
}
/** Common wire checks shared by graph and grid without fabricating a form. */
export function validateSceneEnvelope(scene: Record<string, unknown>) {
  if (scene.schemaVersion !== 7) throw new Error("Unsupported scene version");
  text(scene.ruleSet, true);
  integer(scene.revision);
  const view = object(scene.view, [
    "key",
    "name",
    "kind",
    "binding",
    "owners",
    "details",
    "problems",
  ]);
  for (const key of ["key", "name", "kind"]) text(view[key], true);
  binding(view.binding);
  const owners = new Set<string>();
  for (const item of list(view.owners)) {
    const owner = object(item, ["key", "label"]);
    text(owner.key, true);
    text(owner.label, true);
    if (owners.has(owner.key)) throw new Error("Duplicate view owner");
    owners.add(owner.key);
  }
  for (const detail of list(view.details)) field(detail);
  for (const problem of [...list(view.problems), ...list(scene.problems)])
    text(problem);
  const palette = object(scene.palette, [
    "schemaVersion",
    "id",
    "label",
    "groups",
  ]);
  if (palette.schemaVersion !== 1)
    throw new Error("Unsupported palette version");
  text(palette.id, true);
  text(palette.label, true);
  const groups = list(palette.groups),
    paletteIds = new Set<string>();
  let tools = 0;
  const addPalette = (id: unknown) => {
    text(id, true);
    if (paletteIds.has(id)) throw new Error("Duplicate palette identity");
    paletteIds.add(id);
  };
  if (groups.length > 32) throw new Error("Palette group budget exceeded");
  for (const item of groups) {
    const group = object(item, ["id", "label", "entries"]);
    addPalette(group.id);
    text(group.label, true);
    for (const entry of list(group.entries)) {
      if (++tools > 256) throw new Error("Palette tool budget exceeded");
      const tool = object(
        entry,
        ["id", "label", "icon", "gesture", "command"],
        ["parameters", "inputs"],
      );
      addPalette(tool.id);
      text(tool.label, true);
      text(tool.icon);
      text(tool.command, true);
      if (!["select", "place", "action"].includes(tool.gesture as string))
        throw new Error("Unsupported palette gesture");
      if (
        tool.parameters !== undefined &&
        (!tool.parameters ||
          typeof tool.parameters !== "object" ||
          Array.isArray(tool.parameters))
      )
        throw new Error("Invalid tool parameters");
      const inputs = tool.inputs === undefined ? [] : list(tool.inputs),
        ids = new Set<string>();
      if (inputs.length > 16) throw new Error("Palette input budget exceeded");
      for (const item of inputs) {
        const input = object(item, ["id", "label"], ["default"]);
        text(input.id, true);
        text(input.label, true);
        if (input.default !== undefined) text(input.default);
        if (ids.has(input.id)) throw new Error("Duplicate tool input");
        ids.add(input.id);
      }
    }
  }
}
export function validateSceneResponse(
  value: unknown,
): asserts value is SceneResponse {
  const response = object(value, ["scene", "capabilities", "presentation"]);
  validateScene(response.scene);
  validatePresentationContext(response.presentation, response.scene);
  const tools = new Set(
      response.scene.palette.groups.flatMap((g) => g.entries.map((t) => t.id)),
    ),
    seen = new Set<string>();
  for (const item of list(response.capabilities)) {
    const capability = object(item, ["toolId", "enabled", "reason"]);
    text(capability.toolId, true);
    text(capability.reason);
    if (
      typeof capability.enabled !== "boolean" ||
      (!capability.enabled && !capability.reason) ||
      !tools.has(capability.toolId) ||
      seen.has(capability.toolId)
    )
      throw new Error("Invalid tool capability");
    seen.add(capability.toolId);
  }
  if (tools.size !== seen.size) throw new Error("Missing tool capabilities");
}

function version(value: unknown) {
  if (value !== 1) throw new Error("Unsupported document version");
}
export function validateScope(value: unknown): asserts value is Scope {
  const scope = object(value, ["schemaVersion", "ops"]);
  version(scope.schemaVersion);
  const ops = list(scope.ops);
  if (ops.length > 4096) throw new Error("Scope operation budget exceeded");
  for (const value of ops) {
    if (!value || typeof value !== "object")
      throw new Error("Invalid scope op");
    const tag = (value as ObjectValue).op;
    const fields =
      tag === "expand"
        ? ["relation", "hops"]
        : tag === "collapse"
          ? ["context"]
          : [];
    const op = object(value, ["op", "element", ...fields]);
    if (
      !["addSeed", "expand", "hide", "collapse", "removeSeed"].includes(
        tag as string,
      )
    )
      throw new Error("Unknown scope op");
    text(op.element, true);
    if (tag === "expand") {
      text(op.relation, true);
      integer(op.hops);
      if (op.hops < 1 || op.hops > 8)
        throw new Error("Scope hops must be 1 to 8");
    }
    if (tag === "collapse") for (const key of list(op.context)) text(key, true);
  }
}
export function validateViewDocument(
  value: unknown,
): asserts value is ViewDocument {
  const view = object(value, [
    "schemaVersion",
    "key",
    "name",
    "ruleSet",
    "scope",
  ]);
  version(view.schemaVersion);
  for (const key of ["key", "name", "ruleSet"]) text(view[key], true);
  validateScope(view.scope);
}
export function validatePresentation(
  value: unknown,
): asserts value is Presentation {
  const presentation = object(value, ["schemaVersion", "views"]);
  if (presentation.schemaVersion !== 4)
    throw Error(
      "Unsupported presentation version; export or reset the saved layout",
    );
  function map(value: unknown): ObjectValue {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid presentation map");
    return value as ObjectValue;
  }
  const views = map(presentation.views);
  if (Object.keys(views).length > 128)
    throw new Error("Presentation view budget exceeded");
  for (const value of Object.values(views)) {
    const view =
      (value as { form?: string })?.form === "laneGraph"
        ? object(value, ["form", "laneOrder", "viewport", "packageFingerprint", "projection"])
        : object(value, ["form", "positions", "viewport", "packageFingerprint", "projection", "routeConstraints", "labelPlacements"]);
    if (typeof view.packageFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(view.packageFingerprint)) throw Error("Invalid saved package fingerprint");
    text(view.projection, true);
    if (view.form !== "graph" && view.form !== "laneGraph")
      throw Error("Invalid presentation form");
    if (view.form === "laneGraph") {
      const lanes = list(view.laneOrder),
        ids = new Set<string>();
      if (lanes.length > 128) throw Error("Presentation lane order limit");
      for (const id of lanes) {
        text(id, true);
        if (ids.has(id)) throw Error("Duplicate presentation lane");
        ids.add(id);
      }
    }
    if(view.form === "graph") {
      const routes=map(view.routeConstraints),labels=map(view.labelPlacements);
      if(Object.keys(routes).length>2048||Object.keys(labels).length>20000)throw Error("Saved routing or label placement budget exceeded");
      for(const [id,value]of Object.entries(routes)){text(id,true);validateRouteConstraint(value);}
      for(const [id,value]of Object.entries(labels)){text(id,true);validateLabelPlacement(value);}
    }
    const positions = view.form === "graph" ? map(view.positions) : {};
    if (Object.keys(positions).length > 5000)
      throw new Error("Presentation position budget exceeded");
    for (const value of Object.values(positions)) {
      const g = object(value, ["x", "y", "width", "height"]);
      for (const key of ["x", "y", "width", "height"])
        if (typeof g[key] !== "number" || !Number.isFinite(g[key]))
          throw new Error("Invalid position number");
      if (
        (g.width as number) < 1 ||
        (g.height as number) < 1 ||
        Math.abs(g.x as number) > 1_000_000 ||
        Math.abs(g.y as number) > 1_000_000
      )
        throw new Error("Invalid geometry");
    }
    const v = object(view.viewport, ["x", "y", "zoom"]);
    for (const key of ["x", "y", "zoom"])
      if (typeof v[key] !== "number" || !Number.isFinite(v[key]))
        throw new Error("Invalid viewport number");
    if ((v.zoom as number) < 0.05 || (v.zoom as number) > 4)
      throw new Error("Invalid zoom");
  }
}
export function slot(value: unknown) {
  if (typeof value === "string") {
    text(value, true);
    return;
  }
  if(value&&typeof value==="object"&&Object.hasOwn(value,"sourceText")){
    const source=object(value,["sourceText"]);if(source.sourceText!==true)throw Error("sourceText must be true");return;
  }
  const constant = object(value, ["text"]);
  text(constant.text);
}
export function validateRuleSet(value: unknown): asserts value is RuleSet {
  if ((value as { form?: string })?.form === "laneGraph") {
    validateLaneRules(value);
    return;
  }
  if ((value as { form?: string })?.form === "grid") {
    validateGridRules(value);
    return;
  }
  const rules = object(value, [
    "schemaVersion",
    "projection",
    "id",
    "label",
    "language",
    "form",
    "layout", "routing",
    "symbols",
    "edges",
  ]);
  validateRoutingPolicy(rules.routing);
  if(rules.routing.trunks==="siblings" && (rules.projection as {kind?:string}).kind!=="containmentTree")throw Error("Sibling trunks require a containment tree projection");
  if (rules.schemaVersion !== 8) throw new Error("Unsupported rule version");
  validateProjection(rules.projection, true);
  for (const key of ["id", "label", "language"]) text(rules[key], true);
  const layout = object(rules.layout, ["strategy", "direction"]);
  if (
    rules.form !== "graph" ||
    layout.strategy !== "layered" ||
    !["RIGHT", "LEFT", "UP", "DOWN"].includes(layout.direction as string)
  )
    throw new Error("Unsupported rule form or layout");
  const ids = new Set<string>(),
    classes = new Set<string>(),
    symbols = list(rules.symbols).map((value) =>
      object(
        value,
        ["id", "match", "emit"],
        [
          "graphic",
          "graphic",
          "notation",
          "title",
          "subtitle",
          "label",
          "side",
          "styleClass",
          "compartments",
          "ports",
          "children",
          "regions",
          "expand",
          "create",
        ],
      ),
    );
  const projection = rules.projection as import("./rendering.ts").ProjectionPolicy;
  if (projection.kind === "containmentTree" && (symbols.some(s=>s.regions!==undefined || s.id===projection.edgeRole) || list(rules.edges).some(e=>(e as {id?:unknown} | null)?.id===projection.edgeRole))) throw Error("Containment tree role collision or unsupported regions");
  function add(id: unknown) {
    text(id, true);
    if (ids.has(id)) throw new Error("Duplicate rule ID");
    ids.add(id);
  }
  for (const symbol of symbols) {
    add(symbol.id);
    text(symbol.match, true);
    if (classes.has(symbol.match)) throw new Error("Duplicate match class");
    classes.add(symbol.match);
    if (!["node", "port"].includes(symbol.emit as string))
      throw new Error("Unsupported symbol emission");
    if (
      (symbol.emit === "port" &&
        ["title", "subtitle", "regions", "children", "ports"].some(
          (k) => symbol[k] !== undefined,
        )) ||
      (symbol.emit === "port" &&
        ["compartments", "expand"].some(
          (k) =>
            Array.isArray(symbol[k]) && (symbol[k] as unknown[]).length > 0,
        )) ||
      (symbol.emit === "node" &&
        (symbol.label !== undefined || symbol.side !== undefined))
    )
      throw new Error("Unsupported field for symbol emission");
    if (symbol.graphic !== undefined) validateGraphicRule(symbol.graphic);
    if (symbol.notation !== undefined) text(symbol.notation, true);
    for (const key of ["title", "subtitle", "label"])
      if (symbol[key] !== undefined) labelRule(symbol[key]);
    for (const key of ["side", "styleClass"])
      if (symbol[key] !== undefined) slot(symbol[key]);
    if (symbol.regions !== undefined) {
      if (symbol.emit !== "node") throw new Error("Regions require a node");
      const r = object(symbol.regions, [
        "id",
        "select",
        "label",
        "children",
        "direction",
      ]);
      add(r.id);
      text(r.select, true);
      labelRule(r.label);
      const c = object(r.children, ["select"]);
      text(c.select, true);
      if (!["row", "column"].includes(r.direction as string))
        throw new Error("Unknown region direction");
    }
    const compartmentIds = new Set<string>();
    for (const value of symbol.compartments === undefined
      ? []
      : list(symbol.compartments)) {
      const c = object(value, ["id", "label", "rows", "rowLabel"]);
      text(c.label);
      text(c.id, true); if (compartmentIds.has(c.id)) throw Error("Duplicate compartment ID"); compartmentIds.add(c.id);
      text(c.rows, true);
      labelRule(c.rowLabel);
    }
    if (symbol.ports !== undefined) {
      const ports = object(symbol.ports, ["select", "rule"]);
      text(ports.select, true);
      text(ports.rule, true);
      if (!symbols.some((s) => s.id === ports.rule && s.emit === "port"))
        throw new Error("Unknown port rule");
    }
    if (symbol.children !== undefined) {
      const c = object(symbol.children, ["select"]);
      text(c.select, true);
    }
    const expansions = new Set<string>();
    const tools = new Set<string>();
    for (const value of symbol.create === undefined
      ? []
      : list(symbol.create)) {
      const create = object(value, ["tool", "command", "accepts"]);
      for (const key of ["tool", "command", "accepts"]) text(create[key], true);
      if (symbol.emit !== "node" || tools.has(create.tool as string))
        throw new Error("Creation requires a node rule and unique tool IDs");
      tools.add(create.tool as string);
    }
    for (const value of symbol.expand === undefined
      ? []
      : list(symbol.expand)) {
      const option = object(value, ["id", "label", "select"]);
      for (const key of ["id", "label", "select"]) text(option[key], true);
      if (expansions.has(option.id as string))
        throw new Error("Duplicate expansion ID");
      expansions.add(option.id as string);
    }
  }
  for (const value of list(rules.edges)) {
    if (!value || typeof value !== "object")
      throw new Error("Invalid edge rule");
    const tag = (value as ObjectValue).kind;
    if (tag !== "element" && tag !== "reference")
      throw new Error("Unknown edge kind");
    const names =
      tag === "element" ? ["select", "sourcePath", "targetPath"] : ["targets"];
    const edge = object(
      value,
      ["kind", "id", "per", "notation", "label", "anchor", ...names],
      ["connect", "rootOnly", "startMarker", "endMarker"],
    );
    if (edge.rootOnly !== undefined && typeof edge.rootOnly !== "boolean")
      throw new Error("Invalid rootOnly edge filter");
    if (edge.connect !== undefined) {
      const connect = object(edge.connect, [
        "command",
        "sourceAccepts",
        "targetAccepts",
      ]);
      for (const key of ["command", "sourceAccepts", "targetAccepts"])
        text(connect[key], true);
    }
    for (const k of ["startMarker", "endMarker"]) if (edge[k] !== undefined) validateGraphicRule(edge[k]);
    add(edge.id);
    for (const key of ["per", "notation", ...names]) text(edge[key], true);
    labelRule(edge.label);
    if (
      !symbols.some((s) => s.id === edge.per && s.emit === "node") ||
      !["owner", "root"].includes(edge.anchor as string)
    )
      throw new Error("Unknown owner rule or invalid anchor");
  }
  const reserved = new Set<string>([
    "select",
    "fit",
    "layout",
    ...symbols.flatMap((s) =>
      ((s.create ?? []) as ObjectValue[]).map((c) => String(c.tool)),
    ),
    ...list(rules.edges)
      .filter((e) => (e as ObjectValue).connect !== undefined)
      .map((e) => String((e as ObjectValue).id)),
  ]);
  const edits = new Map<string, string>();
  function inspect(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    const v = value as ObjectValue;
    if (v.edit) {
      const e = v.edit as ObjectValue;
      const tool = String(e.tool),
        command = String(e.command);
      if (
        reserved.has(tool) ||
        (edits.has(tool) && edits.get(tool) !== command)
      )
        throw new Error("Conflicting label edit tool");
      edits.set(tool, command);
    }
    Object.values(v).forEach(inspect);
  }
  inspect(rules.symbols);
  inspect(rules.edges);
}
