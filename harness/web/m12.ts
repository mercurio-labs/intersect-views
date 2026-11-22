import "./style.css";
import { mountWorkbench, showSource, selectExample, showScene, inspectBinding } from "./workbench.ts";
import { ViewCanvas } from "../../packages/visualization/src/view-canvas.ts";
import { ViewSession, type Analysis, type BufferAdapter } from "../../packages/visualization/src/session.ts";
import { WorkerHost } from "../../packages/visualization/src/worker-host.ts";
import { sha256, resolvePresentation, PRESENTATION_CAPABILITIES, type PresentationInput } from "../../packages/visualization/src/presentation-package.ts";
import { GraphicDefinitions } from "../../packages/visualization/src/graphics-contract.ts";
import { validateRuleSet, validateSceneResponse, type Binding, type Presentation, type SceneResponse, type View } from "../../packages/visualization/src/protocol.ts";
import Worker from "./host.worker?worker";
import modelSource from "../models/symbols.harness?raw";
import viewSource from "../models/symbols.view.json?raw";
import classic from "../views/symbols/classic.symbols.json?raw";
import rotated from "../views/symbols/rotated.symbols.json?raw";
import sysml from "../views/symbols/sysml.symbols.json?raw";
import electrical from "../views/symbols/electrical.symbols.json?raw";
import fault from "../views/symbols/fault.symbols.json?raw";
import containers from "../views/symbols/containers.symbols.json?raw";
import containerRules from "../views/symbols/containers.viewrules.json?raw";
import nestedModel from "../models/regions.harness?raw";
const libraries: Record<string,string> = { classic, rotated, sysml, electrical, fault, containers };
import rules from "../views/symbols/symbols.viewrules.json?raw";
import palette from "../views/symbols/symbols.palette.json?raw";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const model = $<HTMLTextAreaElement>("model"), view = $<HTMLTextAreaElement>("view"), library = $<HTMLTextAreaElement>("library"), select = $<HTMLSelectElement>("package");
const requestedExample=new URLSearchParams(location.search).get("example")??"";
const routeExample=requestedExample==="text"||Object.hasOwn(libraries,requestedExample)?requestedExample:"";
let intendedExample=routeExample||"classic";
const storageKey = "intersect.m12.wasm.v1"+(routeExample?`.${routeExample}`:"");
let saved: { model?: string; view?: string; package?: string; layouts?: Record<string, Presentation> } = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); } catch { /* Explicit reset remains available. */ }
model.value = saved.model ?? (routeExample==="containers"?nestedModel:modelSource); view.value = saved.view ?? viewSource; select.value = saved.package && Object.hasOwn(libraries,saved.package) ? saved.package : routeExample&&routeExample!=="text"?routeExample:"classic";
const layouts = saved.layouts ?? {};
const persist = () => localStorage.setItem(storageKey, JSON.stringify({ model: model.value, view: view.value, package: active?.kind ?? select.value, layouts }));
const status = (v: unknown) => { $("status").textContent = String(v); };
let revision = 1, generation = 0, latest: SceneResponse | undefined;
type Active = { host: WorkerHost; session: ViewSession; canvas: ViewCanvas; fingerprint: string; kind: string; root: HTMLElement };
let active: Active | undefined;
const sources = () => [{ uri: "symbols.harness", text: model.value }, { uri: "symbols.view.json", text: view.value }];
function reveal(binding: Binding) {
  const area = binding.uri.endsWith(".view.json") ? view : model;
  area.closest("details")!.open = true; area.focus();
  showSource(area);area.focus();
  const at = (p: { line: number; character: number }) => area.value.split("\n").slice(0, p.line).reduce((n, s) => n + s.length + 1, 0) + p.character;
  area.setSelectionRange(at(binding.range.start), at(binding.range.end)); status(`Selected source · ${binding.key}`);
}
async function packageInput(fingerprint: string, content: string): Promise<PresentationInput> {
  const namespace = JSON.parse(content).id;
  const selectedRules = (namespace==="example.containers"?containerRules:rules).replaceAll("harness.symbols/", `${namespace}/`);
  const resources = [{ id: "symbols", content }, { id: "rules", content: selectedRules }, { id: "palette", content: palette }];
  return { root: "harness.symbols@1", manifests: [{ schemaVersion: 1, id: "harness.symbols", version: "1", language: "urn:intersect:harness:1", languageFingerprint: fingerprint, requires: PRESENTATION_CAPABILITIES, dependencies: [], resources: await Promise.all(resources.map(async (r, i) => ({ id: r.id, kind: (["symbolLibrary", "ruleSet", "palette"] as const)[i], sha256: await sha256(r.content) }))) }], resources };
}
async function analyze(host: WorkerHost): Promise<Analysis> {
  const a = await host.request<Analysis & { diagnostics: unknown[] }>("workspace/analyze", { revision, sources: sources() });
  if (!a.clean) throw Error(`Model diagnostics: ${JSON.stringify(a.diagnostics)}`); return a;
}
async function replacePackage() {
  const ticket = ++generation, requested = revision, kind = select.value, content = library.value;
  const host = new WorkerHost(new Worker()); let candidate: Active | undefined;
  status("Checking candidate presentation in a new WASM host…");
  try {
    const initialized = await host.request<{ protocolVersion: number; language: { namespace: string; fingerprint: string } }>("initialize", { protocolVersion: 2 });
    const input = await packageInput(initialized.language.fingerprint, content);
    new GraphicDefinitions([JSON.parse(content)]); validateRuleSet(JSON.parse(rules));
    const resolved = await resolvePresentation(input, initialized.language.namespace, initialized.language.fingerprint);
    const installed = await host.request<{ presentation: { fingerprint: string } }>("views/preparePresentation", input);
    if (installed.presentation.fingerprint !== resolved.fingerprint) throw Error("Native/client package fingerprint mismatch");
    const a = await analyze(host), catalog = await host.request<{ views: View[] }>("views/catalog", { revision });
    const doc = JSON.parse(view.value), selected = catalog.views.find((v) => v.key === doc.key);
    if (!selected) throw Error("Missing view");
    const scope = doc.scope.ops.length ? doc.scope : { schemaVersion: 1, ops: selected.owners.filter((o) => ["Alpha", "Beta"].includes(o.label)).map((o) => ({ op: "addSeed", element: o.key })) };
    const first = await host.request<SceneResponse>("views/scene", { revision, viewKey: selected.key, scope }); validateSceneResponse(first);
    if (ticket !== generation || requested !== revision) throw Error("Candidate superseded by newer source or package");
    const root = document.createElement("div"); root.style.height = "100%";
    const fingerprint = resolved.fingerprint;
    let session: ViewSession;
    const canvas = new ViewCanvas(root, {
      copy: (v) => navigator.clipboard.writeText(v), view: (key) => { session.invalidate(); session.selectedView = key; void session.refresh(); },
      select: (binding, revealSource) => { inspectBinding(binding);if (revealSource) reveal(binding); else status(`Selected ${binding.key}`); },
      command: async (tool, owner, args) => { await session.command(tool.id, owner, args); },
      targets: (tool, source) => session.targets(tool.id, source), labelTargets: (tool, part) => session.labelTargets(tool.id, part),
      presentation: (p) => { layouts[fingerprint] = p; persist(); }, save: () => { persist(); status("Layout saved."); },
      palette() {}, undo() { status("This fixture has no diagram command undo group."); }, scope: (op) => { session.exploration().append(op); void session.refresh(); },
    });
    const buffers: BufferAdapter = { sources, read: (uri) => sources().find((s) => s.uri === uri)?.text, revision: () => revision, reserveRevision() {}, apply() { throw Error("This M12 fixture is read only through diagram commands"); }, undo() { throw Error("No diagram edits"); }, publish(analysis) { session.setAnalysis(analysis); } };
    session = new ViewSession(host, buffers, { views: (views, key) => canvas.views(views, key), requestView: (key) => canvas.requestView(key), setScene: (response) => { latest = response; $("scene").textContent = JSON.stringify(response, null, 2); canvas.setScene(response);showScene(response); }, setStale: () => canvas.setStale(), status: (v) => canvas.status(v), highlight: (id) => canvas.highlight(id) });
    candidate = { host, session, canvas, fingerprint, kind, root };
    canvas.setPresentation(layouts[fingerprint] ?? { schemaVersion:4, views: {} });
    session.setAnalysis(a); session.selectedView = selected.key; session.setScope(scope);
    canvas.views(catalog.views, selected.key); canvas.setScene(first);
    root.style.visibility = "hidden"; root.style.position = "absolute"; root.style.inset = "0";
    $("canvas").style.position = "relative"; $("canvas").append(root);
    await canvas.whenReady();
    if (ticket !== generation || requested !== revision) throw Error("Candidate superseded during layout");
    root.style.visibility = ""; root.style.position = ""; root.style.inset = "";
    const previous = active; active = candidate; candidate = undefined;
    previous?.session.invalidate(); previous?.host.destroy(); previous?.canvas.destroy();
    $("canvas").replaceChildren(root); latest = first; $("scene").textContent = JSON.stringify(first, null, 2); $("fingerprint").textContent = fingerprint;
    selectExample(intendedExample==="text"&&kind==="classic"?"text":kind);showScene(first);
    persist(); status(`Accepted ${kind} package · revision ${revision}`);
  } catch (error) { candidate?.canvas.destroy(); candidate?.root.remove(); host.destroy(); if (ticket === generation) status(`Candidate rejected: ${String(error)}`); }
}
select.onchange = () => { intendedExample=select.value;library.value = libraries[select.value]; };
library.value=libraries[select.value];
$("apply-package").onclick = () => void replacePackage();
$("analyze").onclick = () => { if (!active) return; const owner = active; owner.session.invalidate(); void analyze(owner.host).then(async (a) => { if (active !== owner) return; owner.session.setAnalysis(a); await owner.session.refresh(); persist(); status(`Accepted source revision ${revision}`); }).catch(status); };
for (const area of [model, view]) area.addEventListener("input", () => { revision++; generation++; active?.session.invalidate(); status("Source changed. Analyze to update the diagram."); });
$("save").onclick = () => { persist(); status("Project saved in this browser."); };
$("export").onclick = () => {
  const artifact={sources:sources(),library:library.value,presentation:layouts,packageFingerprint:active?.fingerprint};
  const url=URL.createObjectURL(new Blob([JSON.stringify(artifact,null,2)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download="intersect-graphics-project.json";link.click();URL.revokeObjectURL(url);
};
$("reset").onclick = () => { localStorage.removeItem(storageKey); location.reload(); };
$("load-nested").onclick = () => {
  model.value=nestedModel;revision++;generation++;active?.session.invalidate();
  select.value="containers";library.value=containers;void replacePackage();
};
Object.assign(window, { m12: { get active() { return active; }, get scene() { return latest; }, replacePackage, packageInput } });
mountWorkbench({page:"graphics",example:intendedExample,openExample:(id)=>{
  intendedExample=id;
  const kind=id==="text"?"classic":id;
  if(!Object.hasOwn(libraries,kind))return;
  const source=kind==="containers"?nestedModel:modelSource;
  if(model.value!==source){model.value=source;revision++;generation++;active?.session.invalidate();}
  select.value=kind;library.value=libraries[kind];void replacePackage();
}});
void replacePackage();
