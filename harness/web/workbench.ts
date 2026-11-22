/** Shared application chrome for the model, graphics and FMEA examples. */
import "./workbench.css";
import type { SceneSurface } from "../../packages/visualization/src/session.ts";
import type { SceneResponse, Binding, View } from "../../packages/visualization/src/protocol.ts";

type Page = "model" | "graphics" | "fmea" | "external";
interface Example {
  id: string;
  page: Page;
  group: string;
  title: string;
  description: string;
  capabilities: string[];
  steps: string[];
  url: string;
  button?: string;
}
export const examples: Example[] = [
  {id:"routing",page:"external",group:"Connections & placement",title:"Routes & bound labels",description:"Route transformed endpoints across nested boundaries; collapse endpoints and choose exact branches in a tree.",capabilities:["Obstacle routing","Manual bends","Movable labels","Collapsed endpoints","Branch picker"],steps:["Open the nested view and collapse a hidden endpoint.","Choose Branched tree and select a shared trunk.","Select a connection or bound label, then use Edit route or Move label. Accept or cancel independently of source edits."],url:"/harness/web/m14.html"},
  {id:"sysml-workbench",page:"external",group:"Language integration",title:"SysML workbench",description:"Open the actual SysML language consumer for structural, action-flow and state-transition views.",capabilities:["Model-defined rendering","Parts tree","Action flow","State transitions","Exact source bindings"],steps:["The isolated local workbench must be running on port 1440.","Choose Explore action and state views, then switch between actions and states.","Use the rendering showcase to compare nested, flat and tree structural projections. Action/state editing and execution are unavailable."],url:"http://127.0.0.1:1440/"},
  { id: "structure", page: "model", group: "Model views", title: "Structure & inheritance", description: "Explore repeated usages, inherited features and connections in one source-bound model.", capabilities: ["Nested symbols", "Inherited features", "Edit & undo", "Saved exploration"], steps: ["Select a symbol, then double-click to reveal its declaration.", "Right-click a symbol to expand, collapse or hide an occurrence.", "Use the palette to create a part or connection, then undo the source edit."], url: "/harness/web/?example=structure" },
  { id: "regions", page: "model", group: "Model views", title: "Nested regions", description: "Inspect grouped members and connections across repeated, nested regions.", capabilities: ["Region layout", "Contextual ports", "Bound label parts", "Source edits"], steps: ["Expand a region and reveal an inherited member.", "Move or resize a symbol and inspect its attached connections.", "Select a field value and press F2 to edit it."], url: "/harness/web/?example=regions", button: "load-regions" },
  { id: "table", page: "model", group: "Tables & relationships", title: "Query table", description: "Read model-derived values as a table, with typed cells and source navigation.", capabilities: ["Typed values", "Source reveal", "Query projection", "Virtual scrolling"], steps: ["Select a cell and reveal the corresponding source.", "Change a value in the model source and analyze to regenerate the table."], url: "/harness/web/?example=table" },
  { id: "matrix", page: "model", group: "Tables & relationships", title: "Traceability matrix", description: "Inspect and edit explicit relationships between the row and column subjects.", capabilities: ["Sparse relationships", "Parallel members", "Validated edits", "Undo & redo"], steps: ["Select a matrix cell to see its relationship members.", "Add or remove a trace using the available actions.", "Switch the view selector to compare the table and derived matrix."], url: "/harness/web/?example=matrix", button: "load-grid" },
  { id: "derived", page: "model", group: "Tables & relationships", title: "Derived matrix", description: "Compare calculated relationships with their source-owned counterparts.", capabilities: ["Derived cells", "Provenance", "Read-only results", "Shared source model"], steps: ["Select a derived cell to inspect its provenance.", "Compare it with the traceability matrix using the view selector."], url: "/harness/web/?example=derived" },
  { id: "lanes", page: "model", group: "Behavior & analysis", title: "Ordered lanes", description: "View semantic order, parallel steps and spans across horizontal or vertical lanes.", capabilities: ["Semantic ordering", "Parallel steps", "Lane placement", "Source edits"], steps: ["Switch between horizontal and vertical views.", "Select a step to reveal its source.", "Use the palette to place or move a step through a checked source edit."], url: "/harness/web/?example=lanes", button: "load-lanes" },
  { id: "fmea", page: "fmea", group: "Behavior & analysis", title: "Failure analysis", description: "Explore one FMEA model as a structure graph, failure worksheet and action worksheet.", capabilities: ["Derived RPN", "Validated ratings", "Action evidence", "Graph & worksheets"], steps: ["Choose Structure, Failures or Actions in the view selector.", "Select a rating or action status and press F2.", "Inspect the generated source change, then undo it."], url: "/languages/fmea/web/" },
  { id: "classic", page: "graphics", group: "Configurable graphics", title: "Reusable symbols", description: "Load reusable graphical definitions over the same accepted semantic model.", capabilities: ["Composed symbols", "Typed parameters", "Source bindings", "Package replacement"], steps: ["Double-click a field to reveal its inherited declaration.", "Open Library to inspect the actual symbol definitions.", "Choose another presentation and load it over the same model."], url: "/harness/web/m12.html?example=classic" },
  { id: "text", page: "graphics", group: "Configurable graphics", title: "Bound text & wrapping", description: "Reflow model-bound documentation while preserving its logical selection and source target.", capabilities: ["Multiline text", "Bound fragments", "Resize & reflow", "Saved layout"], steps: ["Resize a symbol using its bottom-right handle.", "Double-click any wrapped documentation fragment to reveal its source.", "Save the project and reload to restore the arrangement."], url: "/harness/web/m12.html?example=text" },
  { id: "rotated", page: "graphics", group: "Configurable graphics", title: "Directed ports & markers", description: "Inspect checked port direction, rotation and named connector attachments.", capabilities: ["Directed ports", "Rotated anchors", "Custom markers", "Contextual bindings"], steps: ["Compare this presentation with Reusable symbols.", "Resize a symbol and inspect the connector attachments.", "Double-click a port label to reveal its source."], url: "/harness/web/m12.html?example=rotated" },
  { id: "sysml", page: "graphics", group: "Glyph libraries", title: "SysML-style glyphs", description: "Render package tabs, folded notes, initial/final symbols and fork/join bars from compositions.", capabilities: ["Package & note", "Initial & final", "Fork & join", "Hollow markers"], steps: ["Inspect Library to see the primitive compositions.", "Switch presentation to compare another library over the same model."], url: "/harness/web/m12.html?example=sysml" },
  { id: "electrical", page: "graphics", group: "Glyph libraries", title: "Electrical symbols", description: "Use resistor, transformer and terminal glyphs through the shared graphics renderer.", capabilities: ["Resistor", "Transformer", "Terminal glyphs", "Shared renderer"], steps: ["Inspect the resistor and transformer compositions in Library.", "Switch presentation without changing the model source."], url: "/harness/web/m12.html?example=electrical" },
  { id: "fault", page: "graphics", group: "Glyph libraries", title: "Fault-tree symbols", description: "Use event, AND-gate and OR-gate glyphs as a separate authored graphics library.", capabilities: ["Event glyph", "AND / OR gates", "Bound source", "Shared renderer"], steps: ["Inspect the event and gate path definitions in Library.", "Compare the scene bindings with another presentation."], url: "/harness/web/m12.html?example=fault" },
  { id: "containers", page: "graphics", group: "Configurable graphics", title: "Nested compositions", description: "Arrange actual model regions and their child symbols in declared graphical content slots.", capabilities: ["Child content slots", "Nested regions", "Repeated usages", "Source navigation"], steps: ["Inspect the repeated regions in Alpha and Beta.", "Reveal a nested member to compare its source and occurrence context."], url: "/harness/web/m12.html?example=containers", button:"load-nested" },
];

let current: { select(id: string): void; source(element: Element): void; scene(response: SceneResponse): void; binding(binding:Binding):void } | undefined;
export function showSource(element: Element) { current?.source(element); }
export function selectExample(id: string) { current?.select(id); }
export function showScene(response: SceneResponse) { current?.scene(response); }
export function inspectBinding(binding:Binding) { current?.binding(binding); }
export function workbenchSurface(canvas: SceneSurface, visibleView?: (view:View)=>boolean): SceneSurface {
  return {
    views: (views, key) => canvas.views(visibleView?views.filter(visibleView):views, key), requestView: (key) => canvas.requestView(key),
    setScene: (response) => {
      canvas.setScene(response); current?.scene(response);
      if(response.scene.problems.length)canvas.status(`${response.scene.problems.length} view messages. Open Details to inspect.`);
    },
    setStale: () => canvas.setStale(), status: (message) => canvas.status(message), highlight: (id) => canvas.highlight(id),
  };
}

export function mountWorkbench(options: { page: Page; example: string; openExample?: (id: string) => void }) {
  document.body.classList.add("workbench-app");
  document.body.dataset.workbenchPage=options.page;
  const header = document.querySelector("header")!, main = document.querySelector("main")!;
  const sources = document.getElementById("sources")!, workspace = document.getElementById("workspace")!, status = document.getElementById("status")!;
  const originalActions = [...header.querySelectorAll<HTMLElement>("button,label,nav > a")];
  const originalById = new Map(originalActions.filter(a=>a.id).map(a=>[a.id,a]));
  const oldIntro = sources.querySelector(".intro"); oldIntro?.remove();
  header.className = "workbench-header";
  header.innerHTML = `<a class="workbench-brand" href="/harness/web/"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 7h18v18H7zM7 7l18 18M7 25L25 7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="3"/><circle cx="25" cy="25" r="3"/></svg><span>Intersect<small>Modeling workbench</small></span></a><div class="workbench-actions"></div><div class="workbench-utilities"><button id="toggle-examples" aria-label="Toggle examples" aria-expanded="false">Examples</button><button id="show-capabilities">Capabilities</button><button id="toggle-sources" aria-expanded="true">Source & details</button></div>`;
  const actions = header.querySelector(".workbench-actions")!;
  const configuration = document.createElement("div"); configuration.className = "workbench-configuration";
  for (const action of originalActions) {
    if (action.tagName === "A" || ["load-grid", "load-regions", "load-lanes", "load-nested"].includes(action.id)) continue;
    if (action.id === "apply-package" || action.tagName === "LABEL") configuration.append(action);
    else actions.append(action);
  }
  const rail = document.createElement("aside"); rail.className = "workbench-examples"; rail.setAttribute("aria-label", "Feature examples");
  rail.id="workbench-examples";
  const railHeading = document.createElement("div"); railHeading.className = "examples-heading"; railHeading.innerHTML = `<strong>Examples</strong><span>Explore the current capabilities.</span>`; rail.append(railHeading);
  const grouped = new Map<string, Example[]>();
  for (const example of examples) grouped.set(example.group, [...grouped.get(example.group) ?? [], example]);
  const navigation = new Map<string, HTMLElement>();
  for (const [group, items] of grouped) {
    const section = document.createElement("section"), heading = document.createElement("h2"); heading.textContent = group;
    section.append(heading);
    for (const example of items) {
      const existing = example.button ? originalById.get(example.button) : null;
      const item = existing ?? document.createElement(options.page === "model" && example.page === "model" ? "button" : "a");
      item.className = "example-link"; item.dataset.example = example.id;
      item.textContent = example.title;
      if (item instanceof HTMLAnchorElement) item.href = example.url;
      if (example.page === options.page && options.openExample) item.onclick = (event) => { event.preventDefault(); options.openExample!(example.id); };
      section.append(item); navigation.set(example.id, item);
    }
    rail.append(section);
  }
  const reference = document.createElement("details"); reference.className = "workbench-reference";
  reference.innerHTML = `<summary>Reference</summary><a href="/previews/m12/">Earlier visual prototype <span>Concept only</span></a>`; rail.append(reference);

  const context = document.createElement("section"); context.className = "workbench-context";
  context.innerHTML = `<div><div class="workbench-breadcrumb"></div><h1></h1><p></p></div><div class="workbench-summary"><span class="workbench-form"></span><span class="workbench-count"></span></div>`;
  const chips = document.createElement("div"); chips.className = "workbench-capabilities"; context.firstElementChild!.append(chips);
  workspace.prepend(context); if (configuration.children.length) context.after(configuration);
  const inspector = document.createElement("div"); inspector.className = "workbench-inspector-body";
  sources.className = "workbench-inspector";
  const inspectorTitle = document.createElement("div"); inspectorTitle.className = "inspector-heading"; inspectorTitle.textContent = "Source & inspection";
  const tabs = document.createElement("div"); tabs.className = "inspector-tabs"; tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Source panels");
  const panes = new Map<string, HTMLElement>(), tabButtons = new Map<string, HTMLButtonElement>();
  for (const [id, label] of [["model", "Model"], ["view", "Views"], ["appearance", options.page === "graphics" ? "Library" : "Appearance"], ["inspect", "Details"]]) {
    const button = document.createElement("button"), pane = document.createElement("div");
    button.textContent = label; button.id = `inspector-tab-${id}`; button.setAttribute("role", "tab"); button.setAttribute("aria-controls", `inspector-${id}`);
    pane.id = `inspector-${id}`; pane.className = "workbench-pane"; pane.dataset.pane = id; pane.setAttribute("role", "tabpanel"); pane.setAttribute("aria-labelledby", button.id);
    tabs.append(button); inspector.append(pane); panes.set(id, pane); tabButtons.set(id, button);
  }
  const guide = document.createElement("section"); guide.className = "workbench-guide"; panes.get("inspect")!.append(guide);
  const selection=document.createElement("section");selection.className="workbench-selection";selection.innerHTML="<h2>Selection</h2><p>Select a symbol, label or cell to inspect its source binding.</p>";panes.get("inspect")!.append(selection);
  const messages=document.createElement("section");messages.className="workbench-messages";messages.hidden=true;panes.get("inspect")!.append(messages);
  const originals = [...sources.children];
  for (const element of originals) {
    if (element === status) continue;
    if (element.id === "layout-warning") { inspectorTitle.append(element); continue; }
    let target = "inspect";
    if (element.querySelector("#model")) target = "model";
    else if (element.querySelector("#view,[id^=grid-]")) target = "view";
    else if (element.querySelector("#notation,#library") || /notation\.json/.test(element.querySelector("summary")?.textContent ?? "")) target = "appearance";
    else if (/\.view\.json/.test(element.querySelector("summary")?.textContent ?? "")) target = "view";
    if (element.querySelector("#tree")) {
      const tree = document.createElement("details"); tree.className = "workbench-tree"; tree.innerHTML = "<summary>Model elements</summary>";
      const originalTree = element.querySelector("#tree")!; tree.append(originalTree); panes.get("model")!.append(tree); element.remove(); continue;
    }
    panes.get(target)!.append(element);
  }
  sources.replaceChildren(inspectorTitle, tabs, inspector);
  const footer = document.createElement("footer"); footer.className = "workbench-footer";
  footer.innerHTML = `<span class="runtime-indicator" aria-hidden="true"></span><span class="workspace-location">Local workspace</span>`;
  footer.append(status);
  main.className = "workbench-main"; main.replaceChildren(rail, workspace, sources); document.body.append(footer);

  const sourceToggle = document.getElementById("toggle-sources")!, exampleToggle = document.getElementById("toggle-examples")!;
  sourceToggle.setAttribute("aria-controls","sources");exampleToggle.setAttribute("aria-controls",rail.id);
  const showInspector = (show: boolean) => { document.body.dataset.inspector = show ? "open" : "closed"; sourceToggle.setAttribute("aria-expanded", String(show)); };
  const showExamples = (show: boolean) => { document.body.dataset.examples = show ? "open" : "closed"; exampleToggle.setAttribute("aria-expanded", String(show)); };
  const activate = (id: string) => {
    showInspector(true);
    for (const [key, pane] of panes) { pane.hidden = key !== id; const button = tabButtons.get(key)!; button.setAttribute("aria-selected", String(key === id)); button.tabIndex = key === id ? 0 : -1; }
  };
  for (const [id, button] of tabButtons) button.onclick = () => activate(id);
  tabs.onkeydown = (event) => {
    const keys = [...tabButtons.keys()], at = keys.findIndex((key) => tabButtons.get(key) === document.activeElement);
    let next = at;
    if (event.key === "ArrowRight") next = (at + 1) % keys.length;
    else if (event.key === "ArrowLeft") next = (at + keys.length - 1) % keys.length;
    else if (event.key === "Home") next = 0; else if (event.key === "End") next = keys.length - 1; else return;
    event.preventDefault(); activate(keys[next]); tabButtons.get(keys[next])!.focus();
  };
  // Existing reveal handlers and automation open the actual owning details.
  sources.addEventListener("toggle", (event) => { const element = event.target as HTMLDetailsElement; const pane = element.closest<HTMLElement>(".workbench-pane"); if (element.open && pane) activate(pane.dataset.pane!); }, true);
  sourceToggle.onclick = () => showInspector(document.body.dataset.inspector !== "open");
  exampleToggle.onclick = () => showExamples(document.body.dataset.examples !== "open");
  document.getElementById("show-capabilities")!.onclick = () => activate("inspect");
  const select = (id: string) => {
    const selected = examples.find((e) => e.id === id) ?? examples.find((e) => e.page === options.page)!;
    for (const [key, item] of navigation) { item.classList.toggle("active", key === selected.id); if (key === selected.id) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current"); }
    context.querySelector("h1")!.textContent = selected.title; context.querySelector("p")!.textContent = selected.description;
    context.querySelector(".workbench-breadcrumb")!.textContent = `${selected.group} / ${selected.page === "graphics" ? "Live graphics" : "Live model"}`;
    chips.replaceChildren(...selected.capabilities.map((text) => { const chip = document.createElement("span"); chip.textContent = text; return chip; }));
    guide.replaceChildren(); const heading = document.createElement("h2"); heading.textContent = "What to try"; const list = document.createElement("ol");
    for (const text of selected.steps) { const li = document.createElement("li"); li.textContent = text; list.append(li); }
    guide.append(heading, list);
    if (selected.page === "graphics") { const note = document.createElement("p"); note.textContent = "Glyph libraries demonstrate rendering; they do not add domain execution or SysML integration."; guide.append(note); }
    document.title = `${selected.title} · Intersect workbench`;
    if (matchMedia("(max-width: 1100px)").matches) showExamples(false);
  };
  current = { select, source: (element) => { const pane = element.closest<HTMLElement>(".workbench-pane"); if (pane) activate(pane.dataset.pane!); }, binding:(binding)=>{
    selection.replaceChildren();const heading=document.createElement("h2");heading.textContent="Selection";selection.append(heading);
    const list=document.createElement("dl");
    for(const [label,value]of [["Source",binding.uri],["Range",`${binding.range.start.line+1}:${binding.range.start.character+1} → ${binding.range.end.line+1}:${binding.range.end.character+1}`],["Access",binding.readOnly?"Read only":"Source backed"],["Semantic key",binding.key],["Occurrence context",binding.context.length?binding.context.join(" / "):"Root occurrence"]]){
      const term=document.createElement("dt"),description=document.createElement("dd");term.textContent=label;description.textContent=value;list.append(term,description);
    }selection.append(list);
  }, scene: (response) => {
    const scene = response.scene;
    messages.hidden=!scene.problems.length;messages.replaceChildren();
    if(scene.problems.length){const title=document.createElement("h2");title.textContent="View messages";const list=document.createElement("ul");for(const problem of scene.problems){const item=document.createElement("li");item.textContent=problem;list.append(item);}messages.append(title,list);}
    if (options.page === "model") select(({ "structure-1": "structure", regions: "regions", "regions-column": "regions", table: "table", matrix: "matrix", derived: "derived", "lanes-horizontal": "lanes", "lanes-vertical": "lanes" } as Record<string, string>)[scene.view.key] ?? options.example);
    context.querySelector(".workbench-form")!.textContent = scene.form === "graph" ? "Graph view" : scene.form === "grid" ? scene.grid.kind === "table" ? "Table view" : "Matrix view" : "Lane view";
    if (scene.form === "graph") {
      const count = (nodes: typeof scene.nodes): number => nodes.reduce((sum,n)=>sum+1+count(n.children)+(n.regions?.items.reduce((s,r)=>s+count(r.children),0)??0),0);
      context.querySelector(".workbench-count")!.textContent = `${count(scene.nodes)} symbols · ${scene.edges.length} relationships`;
    } else if(scene.form==="grid") context.querySelector(".workbench-count")!.textContent=`${scene.grid.rows.length} rows · ${scene.grid.columns.length} columns`;
    else context.querySelector(".workbench-count")!.textContent=`${scene.steps.length} steps · ${scene.lanes.length} lanes`;
  } };
  activate("model"); showInspector(!matchMedia("(max-width: 900px)").matches); showExamples(false); select(options.example);
  new MutationObserver(() => { status.title = status.textContent ?? ""; footer.dataset.state = /error|failed|reject|diagnostic|changed/i.test(status.textContent ?? "") ? "attention" : "normal"; }).observe(status, { childList:true,subtree:true,characterData:true });
}
