import "./style.css";
import { mountWorkbench, showSource, workbenchSurface, inspectBinding } from "./workbench.ts";
import { ViewCanvas } from "../../packages/visualization/src/view-canvas.ts";
import {
  ViewSession,
  type HostClient,
  type Analysis,
  type BufferAdapter,
} from "../../packages/visualization/src/session.ts";
import {
  defaultNotation,
  validateViewDocument,
  type Binding,
  type Presentation,
  type ScopeOp,
  type ViewDocument,
} from "../../packages/visualization/src/protocol.ts";
import { validateNotation } from "../../packages/visualization/src/notation.ts";
import Worker from "./host.worker?worker";
import modelExample from "../models/structure.harness?raw";
import regionExample from "../models/regions.harness?raw";
import laneExample from "../models/lanes.harness?raw";
import gridExample from "../models/grid.harness?raw";
import viewExample from "../models/structure.view.json?raw";
import notationExample from "../views/harness.notation.json?raw";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const model = $<HTMLTextAreaElement>("model"),
  view = $<HTMLTextAreaElement>("view"),
  notation = $<HTMLTextAreaElement>("notation");
const gridDocs = new Map<string, HTMLTextAreaElement>();
for (const [key, name, ruleSet] of [
  ["lanes-horizontal", "Lanes horizontal", "harness.lanes-horizontal"],
  ["lanes-vertical", "Lanes vertical", "harness.lanes-vertical"],
  ["table", "Boxes", "harness.box-table"],
  ["matrix", "Traces", "harness.trace-matrix"],
  ["derived", "Derived traces", "harness.derived-matrix"],
  ["regions", "Regions", "harness.regions"],
  ["regions-column", "Regions column", "harness.regions-column"],
]) {
  const details = document.createElement("details"),
    summary = document.createElement("summary"),
    area = document.createElement("textarea");
  summary.textContent = `View document · ${key}.view.json`;
  area.id = `grid-${key}`;
  area.setAttribute("aria-label", `${name} view document`);
  area.spellcheck = false;
  area.value = JSON.stringify(
    {
      schemaVersion: 1,
      key,
      name,
      ruleSet,
      scope: { schemaVersion: 1, ops: [] },
    },
    null,
    2,
  );
  details.append(summary, area);
  $("sources").append(details);
  gridDocs.set(`${key}.view.json`, area);
}
function selectedArea() {
  return (
    [...gridDocs.values()].find((area) => {
      try {
        return JSON.parse(area.value).key === session.selectedView;
      } catch {
        return false;
      }
    }) ?? view
  );
}
let rejectedLayout = false;
let restoredView = "";
const requestedExample=new URLSearchParams(location.search).get("example")??"structure";
const configurations:Record<string,{model:string;view:string}>={
  structure:{model:modelExample,view:"structure-1"},regions:{model:regionExample,view:"regions"},
  matrix:{model:gridExample,view:"matrix"},table:{model:gridExample,view:"table"},derived:{model:gridExample,view:"derived"},
  lanes:{model:laneExample,view:"lanes-horizontal"},
};
const startingExample=Object.hasOwn(configurations,requestedExample)?requestedExample:"structure";
const initialExample=configurations[startingExample];
function familyOfView(key:string){return key.startsWith("lanes-")?"lanes":key.startsWith("regions")?"regions":["matrix","table","derived"].includes(key)?"traces":"structure";}
let exampleFamily=familyOfView(initialExample.view);
const storageKey = "intersect.views.harness.v1"+(startingExample==="structure"?"":`.${startingExample}`);
let revision = 1,
  clock = 1,
  analyzed = false,
  initial = true,
  restored = false,
  presentation: Presentation = { schemaVersion:4, views: {} },
  savedScope: ViewDocument["scope"] = { schemaVersion: 1, ops: [] };
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  restored = Boolean(saved);
  restoredView = saved?.selectedView ?? initialExample.view;
  exampleFamily=["structure","regions","traces","lanes"].includes(saved?.exampleFamily)?saved.exampleFamily:familyOfView(restoredView);
  model.value = saved?.model ?? initialExample.model;
  view.value = saved?.view ?? viewExample;
  notation.value = saved?.notation ?? notationExample;
  presentation = saved?.presentation ?? presentation;
  for (const [uri, area] of gridDocs)
    area.value = saved?.gridDocs?.[uri] ?? area.value;
} catch {
  model.value = initialExample.model;
  view.value = viewExample;
  notation.value = notationExample;
}
const worker = new Worker(),
  pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
let messageId = 0;
worker.onmessage = ({ data }) => {
  const promise = pending.get(data.id);
  pending.delete(data.id);
  if (data.error) promise?.reject(new Error(data.error));
  else promise?.resolve(data.result);
};
worker.onerror = () => {
  for (const p of pending.values())
    p.reject(new Error("WASM host worker failed"));
  pending.clear();
};
const host: HostClient = {
  request<T>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, params });
    });
  },
};
type Group = {
  before: { uri: string; text: string }[];
  after: { uri: string; text: string }[];
};
const undoGroups: Group[] = [],
  redoGroups: Group[] = [];
function sameBuffers(expected: { uri: string; text: string }[]) {
  return expected.every((doc) => buffers.read(doc.uri) === doc.text);
}
function writeBuffers(values: { uri: string; text: string }[]) {
  for (const doc of values) {
    const area =
      doc.uri === "structure.harness"
        ? model
        : doc.uri === "structure.view.json"
          ? view
          : notation;
    area.value = doc.text;
  }
}
function sourceUndo() {
  try {
    const group = undoGroups.at(-1);
    if (!group) return;
    buffers.undo();
    redoGroups.push(group);
    revision = ++clock;
    void analyze();
  } catch (error) {
    report(error);
  }
}
function sourceRedo() {
  try {
    const group = redoGroups.at(-1);
    if (!group) return;
    if (!sameBuffers(group.before))
      throw new Error("Source changed since undo");
    writeBuffers(group.after);
    redoGroups.pop();
    undoGroups.push(group);
    revision = ++clock;
    void analyze();
  } catch (error) {
    report(error);
  }
}
const buffers: BufferAdapter = {
  read(uri) {
    return buffers.sources().find((s) => s.uri === uri)?.text;
  },
  sources() {
    return [
      { uri: "structure.harness", text: model.value },
      { uri: "structure.view.json", text: view.value },
      { uri: "harness.notation.json", text: notation.value },
      ...[...gridDocs].map(([uri, area]) => ({ uri, text: area.value })),
    ];
  },
  apply(patches) {
    const before = buffers.sources(),
      after = structuredClone(before);
    for (const patch of patches) {
      if (patch.uri !== "structure.harness")
        throw new Error("Buffer is not editable model source");
      const doc = after.find((s) => s.uri === patch.uri);
      if (!doc) throw new Error("Unknown source buffer");
      const offset = (p: { line: number; character: number }) =>
        doc.text
          .split("\n")
          .slice(0, p.line)
          .reduce((n, l) => n + l.length + 1, 0) + p.character;
      const start = offset(patch.range.start),
        end = offset(patch.range.end);
      if (doc.text.slice(start, end) !== patch.original)
        throw new Error("Buffer range mismatch");
      doc.text =
        doc.text.slice(0, start) + patch.replacement + doc.text.slice(end);
    }
    const edited = (doc: { uri: string; text: string }) =>
      patches.some((p) => p.uri === doc.uri);
    writeBuffers(after.filter(edited));
    undoGroups.push({
      before: before.filter(edited),
      after: after.filter(edited),
    });
    redoGroups.length = 0;
  },
  undo() {
    const group = undoGroups.at(-1);
    if (!group) throw new Error("No diagram undo group");
    if (!sameBuffers(group.after))
      throw new Error("Source changed since the diagram edit");
    writeBuffers(group.before);
    undoGroups.pop();
  },
  revision: () => revision,
  reserveRevision(n) {
    clock = Math.max(clock, n);
  },
  publish(analysis) {
    revision = analysis.revision;
    clock = Math.max(clock, revision);
    displayAnalysis(analysis);
    persist();
  },
};
function report(error: unknown) {
  $("status").textContent = String(error);
}
function reveal(binding: Binding) {
  const area =
    gridDocs.get(binding.uri) ??
    (binding.uri.endsWith(".view.json") ? view : model);
  area.closest("details")!.open = true;
  showSource(area);
  area.focus();
  const lines = area.value.split("\n"),
    offset = (p: { line: number; character: number }) =>
      lines.slice(0, p.line).reduce((n, s) => n + s.length + 1, 0) +
      p.character;
  area.setSelectionRange(
    offset(binding.range.start),
    offset(binding.range.end),
  );
  $("status").textContent = `Selected ${binding.elementId}`;
}
function persist() {
  if (rejectedLayout) return;
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      selectedView: session.selectedView,
      exampleFamily,
      model: model.value,
      view: view.value,
      notation: notation.value,
      presentation,
      gridDocs: Object.fromEntries(
        [...gridDocs].map(([uri, area]) => [uri, area.value]),
      ),
    }),
  );
}
const canvas: ViewCanvas = new ViewCanvas($("canvas"), {
  copy: (text) => navigator.clipboard.writeText(text),
  view(key) {
    session.invalidate();
    session.selectedView = key;
    const doc = JSON.parse(selectedArea().value) as ViewDocument;
    savedScope = doc.scope;
    session.exploration(doc.scope);
    scopeCount();
    void session.refresh();
  },
  select(binding, revealSource) {
    inspectBinding(binding);
    if (analyzed) {
      if (revealSource) reveal(binding);
      else $("status").textContent = `Selected ${binding.key}`;
    }
  },
  command: (tool, owner, args) =>
    session.command(tool.id, owner, args).then(() => {}),
  presentation(value) {
    if (rejectedLayout) return;
    presentation = value;
    persist();
  },
  save() {
    persist();
    $("status").textContent = "Layout saved in this browser.";
  },
  palette() {},
  undo() {
    sourceUndo();
  },
  redo() {
    sourceRedo();
  },
  labelTargets: (tool, part) => session.labelTargets(tool.id, part),
  targets: (tool, source) => session.targets(tool.id, source),
  laneTargets: (tool, step, lane, before, end) =>
    session.laneTargets(tool.id, step, lane, before, end),
  gridTargets: (tool, row, column, member) =>
    session.gridTargets(tool.id, row, column, member),
  scope: scopeOp,
});
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
const session: ViewSession = new ViewSession(host, buffers, workbenchSurface(canvas,(view)=>{
  const visible:Record<string,string[]>={structure:["structure-1"],regions:["regions","regions-column"],traces:["structure-1","table","matrix","derived"],lanes:["lanes-horizontal","lanes-vertical"]};
  return visible[exampleFamily].includes(view.key);
}));
if (restoredView) session.selectedView = restoredView;
function scopeCount() {
  $("scope-count").textContent =
    `${session.exploration(savedScope).scope.ops.length} scope operations`;
}
function scopeOp(op: ScopeOp) {
  try {
    session.exploration(savedScope).append(op);
    scopeCount();
    void session.refresh();
  } catch (error) {
    report(error);
  }
}
function scopeUndo() {
  session.exploration(savedScope).undo();
  scopeCount();
  void session.refresh();
}
function displayAnalysis(
  analysis: Analysis & { nodes?: any[]; diagnostics?: unknown[] },
) {
  session.setAnalysis(analysis);
  analyzed = analysis.clean;
  $("diagnostics").textContent = (analysis.diagnostics ?? []).length
    ? JSON.stringify(analysis.diagnostics, null, 2)
    : "No diagnostics.";
  $("status").textContent = analysis.clean
    ? `Clean model · revision ${revision} · ${(analysis.nodes ?? []).length} elements`
    : `Model has diagnostics. Fix source and analyze again.`;
  $("tree").replaceChildren();
  for (const node of analysis.nodes ?? []) {
    const row = document.createElement("div");
    row.className = "tree-row";
    const label = document.createElement("span");
    label.textContent = node.name || "(unnamed)";
    const kind = document.createElement("small");
    kind.textContent = node.class;
    row.append(label, kind);
    if (node.class.endsWith("Box") || node.class.endsWith("Space")) {
      const add = document.createElement("button");
      add.textContent = "+";
      add.title = `Add ${node.name} to diagram`;
      const seed = async () => {
        const inspected = await host.request<any>("intersect/inspect", {
          id: node.id,
          revision,
        });
        const located = await host.request<any>("views/locate", {
          revision,
          uri: inspected.resource,
          position: inspected.range.start,
        });
        canvas.addSeed(located.key);
      };
      add.onclick = () => void seed().catch(report);
      row.ondblclick = () => void seed().catch(report);
      row.append(add);
    }
    $("tree").append(row);
  }
}
async function analyze() {
  $("analyze").setAttribute("disabled", "");
  analyzed = false;
  session.invalidate();
  $("status").textContent = "Analyzing model sources…";
  const requested = revision;
  try {
    const analysis = await host.request<
      Analysis & {
        nodes: { id: string; name: string; class: string; parent?: string }[];
        diagnostics: unknown[];
      }
    >("workspace/analyze", { revision: requested, sources: buffers.sources() });
    if (revision !== requested) return;
    displayAnalysis(analysis);
    if (!analysis.clean) return;
    const doc: unknown = JSON.parse(selectedArea().value);
    validateViewDocument(doc);
    if (!initial && JSON.stringify(savedScope) !== JSON.stringify(doc.scope))
      session.setScope(doc.scope);
    savedScope = doc.scope;
    session.selectedView = doc.key;
    if (initial) {
      for (const area of gridDocs.values()) {
        const grid = JSON.parse(area.value) as ViewDocument;
        session.selectedView = grid.key;
        session.setScope(grid.scope);
      }
      session.selectedView = doc.key;
      session.setScope(doc.scope);
      if (!doc.scope.ops.length && !restored) {
        for (const name of doc.ruleSet.startsWith("harness.lanes-")
          ? ["Process"]
          : model.value === gridExample.replace(/\r\n/g, "\n")
            ? ["Alpha", "Beta", "Gamma"]
            : ["Alpha", "Beta"]) {
          const node = analysis.nodes.find((n) => n.name === name);
          if (node) {
            const inspected = await host.request<any>("intersect/inspect", {
              id: node.id,
              revision,
            });
            const located = await host.request<any>("views/locate", {
              revision,
              uri: inspected.resource,
              position: inspected.range.start,
            });
            session
              .exploration(savedScope)
              .append({ op: "addSeed", element: located.key });
          }
        }
      }
      if (!restored) {
        const seeds = session.exploration(savedScope).scope;
        for (const area of [view, ...gridDocs.values()]) {
          const grid = JSON.parse(area.value) as ViewDocument;
          session.selectedView = grid.key;
          session.setScope(grid.scope.ops.length ? grid.scope : seeds);
        }
        session.selectedView = doc.key;
      }
      initial = false;
    }
    const profile = JSON.parse(notation.value);
    validateNotation(profile);
    canvas.setNotation(profile);
    scopeCount();
    await session.refresh();
  } catch (error) {
    report(error);
  } finally {
    $("analyze").removeAttribute("disabled");
  }
}
$("analyze").onclick = () => void analyze();
for (const area of [model, view, notation, ...gridDocs.values()])
  area.addEventListener("input", () => {
    revision = ++clock;
    analyzed = false;
    session.invalidate();
    $("status").textContent = "Source changed. Analyze to update the diagram.";
  });
model.addEventListener("keyup", () => {
  if (!analyzed) return;
  const prefix = model.value.slice(0, model.selectionStart),
    lines = prefix.split("\n");
  void session
    .cursor("structure.harness", lines.length - 1, lines.at(-1)!.length)
    .catch(report);
});
$("undo-scope").onclick = scopeUndo;
$("undo-source").onclick = sourceUndo;
$("redo-source").onclick = sourceRedo;
$("clear-scope").onclick = () => {
  session.setScope({ schemaVersion: 1, ops: [] });
  scopeCount();
  void session.refresh();
};
$("save").onclick = () => {
  try {
    const selected=session.selectedView;
    const documents=[view,...gridDocs.values()].map(area=>{
      const doc:ViewDocument=JSON.parse(area.value);validateViewDocument(doc);return{area,doc};
    });
    try {
      for(const {doc}of documents){session.selectedView=doc.key;doc.scope=session.exploration(doc.scope).scope;}
    } finally { session.selectedView=selected; }
    for(const {area,doc}of documents)area.value=JSON.stringify(doc,null,2)+"\n";
    savedScope=JSON.parse(selectedArea().value).scope;
    revision = ++clock;
    persist();
    void analyze();
  } catch (error) {
    report(error);
  }
};
$("notation-apply").onclick = async () => {
  try {
    const profile = JSON.parse(notation.value);
    validateNotation(profile);
    canvas.setNotation(profile);
    await analyze();
    $("status").textContent = "Notation applied.";
  } catch (error) {
    report(error);
  }
};
$("download").onclick = () => {
  const data = {
    sources: buffers.sources(),
    presentation,
    exploration: session
      .exploration(savedScope)
      .document(session.selectedView, "Structure", "harness.structure"),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "intersect-harness-project.json";
  a.click();
  URL.revokeObjectURL(url);
};
$("load-lanes").onclick = () => {
  model.value = laneExample;
  revision = ++clock;
  initial = true;
  restored = false;
  session.selectedView = "lanes-horizontal";
  void analyze();
};
$("load-regions").onclick = () => {
  model.value = regionExample;
  revision = ++clock;
  initial = true;
  restored = false;
  session.selectedView = "regions";
  void analyze();
};
$("load-grid").onclick = () => {
  model.value = gridExample;
  revision = ++clock;
  initial = true;
  restored = false;
  session.selectedView = "matrix";
  void analyze();
};
$("reset").onclick = () => {
  localStorage.removeItem(storageKey);
  location.reload();
};
Object.assign(window, {
  harness: {
    session,
    canvas,
    host,
    get revision() {
      return revision;
    },
    defaultNotation,
  },
});
function loadExample(id:string) {
  const configuration=configurations[id];if(!configuration)return;
  exampleFamily=familyOfView(configuration.view);
  model.value=configuration.model;
  for(const area of [view,...gridDocs.values()]){
    const document=JSON.parse(area.value) as ViewDocument;document.scope={schemaVersion:1,ops:[]};area.value=JSON.stringify(document,null,2);
  }
  undoGroups.length=0;redoGroups.length=0;
  presentation={schemaVersion:4,views:{}};canvas.setPresentation(presentation);
  revision=++clock;initial=true;restored=false;session.selectedView=configuration.view;
  void analyze();
}
mountWorkbench({page:"model",example:startingExample,openExample:loadExample});
void host
  .request("initialize", { protocolVersion: 2 })
  .then(() => analyze())
  .catch(report);
