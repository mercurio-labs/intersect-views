import "./style.css";
import { mountWorkbench, showSource, workbenchSurface, inspectBinding } from "../../../harness/web/workbench.ts";
import { ViewCanvas } from "../../../packages/visualization/src/view-canvas.ts";
import {
  ViewSession,
  type Analysis,
  type BufferAdapter,
} from "../../../packages/visualization/src/session.ts";
import { WorkerHost } from "../../../packages/visualization/src/worker-host.ts";
import { validateNotation } from "../../../packages/visualization/src/notation.ts";
import {
  validateViewDocument,
  type Binding,
  type Presentation,
  type Scope,
  type ViewDocument,
} from "../../../packages/visualization/src/protocol.ts";
import Worker from "./host.worker?worker";
import example from "../models/pump.fmea?raw";
import graph from "../models/structure.view.json?raw";
import failures from "../models/failures.view.json?raw";
import actions from "../models/actions.view.json?raw";
import notation from "../views/fmea.notation.json?raw";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let rejectedLayout = false;
const storageKey = "intersect.fmea.project.v1",
  model = $("model") as HTMLTextAreaElement,
  areas = new Map<string, HTMLTextAreaElement>([["pump.fmea", model]]),
  defaults = new Map([
    ["pump.fmea", example],
    ["structure.view.json", graph],
    ["failures.view.json", failures],
    ["actions.view.json", actions],
    ["fmea.notation.json", notation],
  ]);
for (const [uri, text] of defaults) {
  if (uri === "pump.fmea") {
    model.value = text;
    continue;
  }
  const details = document.createElement("details"),
    summary = document.createElement("summary"),
    area = document.createElement("textarea");
  summary.textContent = uri;
  area.value = text;
  area.spellcheck = false;
  area.setAttribute("aria-label", uri);
  details.append(summary, area);
  $("sources").append(details);
  areas.set(uri, area);
}
let revision = 1,
  clock = 1,
  restored = false,
  loaded = false,
  analysis: Analysis & { nodes?: ElementNode[] },
  presentation: Presentation = { schemaVersion:4, views: {} };
type ElementNode = { id: string; name: string; class: string };
let analyzing = true;
let chosen = "structure";
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  if (saved) {
    restored = true;
    for (const doc of saved.sources ?? [])
      if (areas.has(doc.uri)) areas.get(doc.uri)!.value = doc.text;
    presentation = saved.presentation ?? presentation;
    chosen = saved.view ?? chosen;
  }
} catch {
  /* A malformed local save does not replace the example. */
}
const host = new WorkerHost(new Worker());
type Buffer = { uri: string; text: string };
type Undo = { before: Buffer[]; after: Buffer[] };
const undo: Undo[] = [],
  redo: Undo[] = [];
const docs = () =>
  [...areas]
    .filter(([uri]) => uri.endsWith(".view.json"))
    .map(([uri, area]) => {
      const value: unknown = JSON.parse(area.value);
      validateViewDocument(value);
      return { uri, area, doc: value };
    });
const unchanged = (values: Buffer[]) =>
  values.every((d) => buffers.read(d.uri) === d.text);
const write = (values: Buffer[]) =>
  values.forEach((d) => {
    const area = areas.get(d.uri);
    if (!area) throw new Error("Unknown source buffer");
    area.value = d.text;
  });
const buffers: BufferAdapter = {
  read: (uri) => areas.get(uri)?.value,
  sources: () => [...areas].map(([uri, area]) => ({ uri, text: area.value })),
  revision: () => revision,
  reserveRevision: (n) => {
    clock = Math.max(clock, n);
  },
  publish: (a) => {
    revision = a.revision;
    clock = Math.max(clock, revision);
    display(a);
    persist();
  },
  apply(patches) {
    const before: Buffer[] = [],
      after: Buffer[] = [];
    for (const p of patches) {
      if (p.uri !== "pump.fmea")
        throw new Error("Buffer is not editable FMEA source");
      const text = buffers.read(p.uri);
      if (text === undefined) throw new Error("Missing source buffer");
      const offset = (p: { line: number; character: number }) =>
        text
          .split("\n")
          .slice(0, p.line)
          .reduce((n, s) => n + s.length + 1, 0) + p.character;
      const start = offset(p.range.start),
        end = offset(p.range.end);
      if (text.slice(start, end) !== p.original)
        throw new Error("Source range mismatch");
      before.push({ uri: p.uri, text });
      after.push({
        uri: p.uri,
        text: text.slice(0, start) + p.replacement + text.slice(end),
      });
    }
    write(after);
    undo.push({ before, after });
    redo.length = 0;
  },
  undo() {
    const group = undo.at(-1);
    if (!group) throw new Error("No source undo group");
    if (!unchanged(group.after))
      throw new Error("Newer typing owns the source");
    write(group.before);
    undo.pop();
  },
};
function error(value: unknown) {
  $("status").textContent = String(value);
}
function persist() {
  if (rejectedLayout) return;
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      sources: buffers.sources(),
      presentation,
      view: session.selectedView,
    }),
  );
}
function reveal(binding: Binding) {
  const area = areas.get(binding.uri);
  if (!area) return;
  area.closest("details")!.open = true;
  showSource(area);
  area.focus();
  const offset = (p: { line: number; character: number }) =>
    area.value
      .split("\n")
      .slice(0, p.line)
      .reduce((n, s) => n + s.length + 1, 0) + p.character;
  area.setSelectionRange(
    offset(binding.range.start),
    offset(binding.range.end),
  );
  $("status").textContent = `Selected ${binding.key}`;
}
const canvas: ViewCanvas = new ViewCanvas($("canvas"), {
  view(key) {
    session.invalidate();
    session.selectedView = key;
    scopeCount();
    void session.refresh();
  },
  select(binding, source) {
    inspectBinding(binding);
    if (analysis?.clean) {
      if (source) reveal(binding);
      else $("status").textContent = `Selected ${binding.key}`;
    }
  },
  command: (tool, owner, args) =>
    session.command(tool.id, owner, args).then(() => {}),
  presentation: (value) => {
    if (rejectedLayout) return;
    presentation = value;
    persist();
  },
  save: () => persist(),
  palette() {},
  undo: sourceUndo,
  redo: sourceRedo,
  targets: (tool, source) => session.targets(tool.id, source),
  labelTargets: (tool, part) => session.labelTargets(tool.id, part),
  laneTargets: (tool, step, lane, before, end) =>
    session.laneTargets(tool.id, step, lane, before, end),
  gridTargets: (tool, row, column, member) =>
    session.gridTargets(tool.id, row, column, member),
  copy: (text) => navigator.clipboard.writeText(text),
  scope: (op) => {
    session.exploration().append(op);
    scopeCount();
    void session.refresh();
  },
});
const session: ViewSession = new ViewSession(host, buffers, workbenchSurface(canvas));
session.selectedView = chosen;
try {
  canvas.setPresentation(presentation);
} catch (error) {
  rejectedLayout = true;
  const warning = document.createElement("p");
  warning.id = "layout-warning";
  warning.setAttribute("role", "alert");
  warning.textContent =
    String(error) +
    ". Export the project to preserve it, or Reset example to start fresh.";
  $("sources").prepend(warning);
}
const savedScopes = new Map<string, string>();
function scopeCount() {
  $("scope-count").textContent =
    `${session.exploration().scope.ops.length} scope operations`;
}
function controls() {
  for (const id of ["show-all", "clear-scope", "undo-scope"]) {
    ($(id) as HTMLButtonElement).disabled =
      analyzing || !analysis?.clean || analysis.revision !== revision;
  }
}
function display(a: Analysis) {
  analysis = a;
  session.setAnalysis(a);
  controls();
  $("status").textContent = a.clean
    ? `Clean FMEA · revision ${revision}`
    : "FMEA has diagnostics; correct source and analyze.";
  $("diagnostics").textContent = JSON.stringify(a.diagnostics ?? [], null, 2);
  $("tree").replaceChildren();
  for (const n of analysis.nodes ?? []) {
    const row = document.createElement("div"),
      label = document.createElement("span"),
      kind = document.createElement("small"),
      add = document.createElement("button");
    row.className = "tree-row";
    label.textContent = n.name;
    kind.textContent = n.class;
    add.textContent = "+";
    add.title = `Add ${n.name} to view`;
    const seed = async () => {
      const inspected = await host.request<any>("intersect/inspect", {
        revision,
        id: n.id,
      });
      const located = await host.request<any>("views/locate", {
        revision,
        uri: inspected.resource,
        position: inspected.range.start,
      });
      session.exploration().append({ op: "addSeed", element: located.key });
      scopeCount();
      await session.refresh();
    };
    add.onclick = () => void seed().catch(error);
    row.ondblclick = () => void seed().catch(error);
    row.append(label, kind, add);
    $("tree").append(row);
  }
}
async function defaultsFor(key: string): Promise<Scope> {
  if (!analysis?.clean || analysis.revision !== revision)
    throw new Error("Analyze the current FMEA source first");
  const cls =
    key === "structure"
      ? "Analysis"
      : key === "failures"
        ? "FailureMode"
        : "Action";
  const ops: Scope["ops"] = [];
  for (const n of analysis.nodes ?? []) {
    if (!n.class.endsWith(cls)) continue;
    const object = await host.request<any>("intersect/inspect", {
      revision,
      id: n.id,
    });
    const found = await host.request<any>("views/locate", {
      revision,
      uri: object.resource,
      position: object.range.start,
    });
    ops.push({ op: "addSeed", element: found.key });
  }
  return { schemaVersion: 1, ops };
}
async function analyze() {
  analyzing = true;
  controls();
  const requested = revision;
  $("analyze").setAttribute("disabled", "");
  session.invalidate();
  try {
    const a = await host.request<Analysis>("workspace/analyze", {
      revision: requested,
      sources: buffers.sources(),
    });
    if (revision !== requested) return;
    display(a);
    if (!a.clean) return;
    const selected = session.selectedView;
    for (const { doc } of docs()) {
      const hash = JSON.stringify(doc.scope);
      session.selectedView = doc.key;
      if (savedScopes.get(doc.key) !== hash) {
        session.setScope(
          !loaded && !restored && !doc.scope.ops.length
            ? await defaultsFor(doc.key)
            : doc.scope,
        );
        savedScopes.set(doc.key, hash);
      }
    }
    session.selectedView = selected;
    loaded = true;
    const profile = JSON.parse(areas.get("fmea.notation.json")!.value);
    validateNotation(profile);
    canvas.setNotation(profile);
    scopeCount();
    await session.refresh();
  } catch (e) {
    error(e);
  } finally {
    analyzing = false;
    controls();
    $("analyze").removeAttribute("disabled");
  }
}
function sourceUndo() {
  try {
    const group = undo.at(-1);
    if (!group) return;
    buffers.undo();
    redo.push(group);
    revision = ++clock;
    void analyze();
  } catch (e) {
    error(e);
  }
}
function sourceRedo() {
  try {
    const group = redo.at(-1);
    if (!group) return;
    if (!unchanged(group.before))
      throw new Error("Newer typing owns the source");
    write(group.after);
    redo.pop();
    undo.push(group);
    revision = ++clock;
    void analyze();
  } catch (e) {
    error(e);
  }
}
for (const area of areas.values()) {
  area.addEventListener("input", () => {
    revision = ++clock;
    session.invalidate();
    controls();
    $("status").textContent = "Source changed; analyze to update the view.";
  });
  area.addEventListener("click", () => {
    if (analysis?.clean) {
      const before = area.value.slice(0, area.selectionStart),
        line = before.split("\n").length - 1,
        character = before.length - (before.lastIndexOf("\n") + 1),
        uri = [...areas].find(([, a]) => a === area)?.[0];
      if (uri) void session.cursor(uri, line, character).catch(error);
    }
  });
}
$("analyze").onclick = () => void analyze();
$("undo-source").onclick = sourceUndo;
$("redo-source").onclick = sourceRedo;
$("show-all").onclick = () =>
  void (async () => {
    session.setScope(await defaultsFor(session.selectedView));
    scopeCount();
    await session.refresh();
  })().catch(error);
$("clear-scope").onclick = () => {
  session.setScope({ schemaVersion: 1, ops: [] });
  scopeCount();
  void session.refresh();
};
$("undo-scope").onclick = () => {
  session.exploration().undo();
  scopeCount();
  void session.refresh();
};
$("save").onclick = () => {
  try {
    const selected = session.selectedView;
    for (const { doc, area } of docs()) {
      session.selectedView = doc.key;
      doc.scope = session.exploration(doc.scope).scope;
      area.value = JSON.stringify(doc, null, 2);
    }
    session.selectedView = selected;
    persist();
    revision = ++clock;
    void analyze();
  } catch (e) {
    error(e);
  }
};
$("reset").onclick = () => {
  localStorage.removeItem(storageKey);
  location.reload();
};
$("export").onclick = () => {
  const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ sources: buffers.sources(), presentation }, null, 2)],
        { type: "application/json" },
      ),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "fmea-project.json";
  a.click();
  URL.revokeObjectURL(url);
};
(window as any).fmea = {
  host,
  session,
  buffers,
  get revision() {
    return revision;
  },
};
mountWorkbench({page:"fmea",example:"fmea"});
void host.request("initialize",{protocolVersion:2}).then(()=>analyze()).catch(error);
