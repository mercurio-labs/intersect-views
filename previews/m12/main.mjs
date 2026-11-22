import fixtures from "./fixtures.json";
import { renderScene } from "./renderer.mjs";

const $ = (id) => document.getElementById(id);
const storageKey = "intersect.m12.visual-prototype.layout.v1";
let definitions = structuredClone(fixtures.definitions), current;
const controls = ["example", "theme", "width", "rotation", "documentation"];
function options() {
  return { width: Number($("width").value), rotation: Number($("rotation").value), documentation: $("documentation").checked, theme: $("theme").value };
}
function status(message, error = false) {
  $("status").textContent = message;
  $("status").dataset.error = String(error);
}
function render(candidate = definitions) {
  const scene = fixtures.scenes[$("example").value];
  const next = renderScene(candidate, scene, options());
  // Only replace the accepted display once the complete candidate rendered.
  $("canvas").replaceChildren(next.svg);
  current = next;
  $("scene-title").textContent = scene.title;
  $("scene-count").textContent = `${scene.rows.flat().length} instances · fixture data`;
  $("part-count").textContent = `${next.parts} interpreted parts`;
  $("width-value").textContent = `${$("width").value} px`;
  $("rotation-value").textContent = `${$("rotation").value}°`;
  $("selection").replaceChildren();
  for (const [name, text] of [["Selection", "No part selected"]]) addDetail(name, text);
  return next;
}
function addDetail(name, value) {
  const dt = document.createElement("dt"), dd = document.createElement("dd");
  dt.textContent = name; dd.textContent = value;
  $("selection").append(dt, dd);
}
function select(target) {
  const part = target.closest("[data-hit]");
  if (!part || !current?.hits.has(part.dataset.hit)) return;
  $("canvas").querySelectorAll("[data-selected]").forEach((p) => delete p.dataset.selected);
  part.dataset.selected = "true";
  const item = current.hits.get(part.dataset.hit);
  $("selection").replaceChildren();
  for (const [label, key] of [["Instance", "instance"], ["Definition", "definition"], ["Logical part", "part"], ["Sample binding", "binding"]]) addDetail(label, item[key]);
}
$("canvas").addEventListener("click", (event) => select(event.target));
$("canvas").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(event.target); }
});
function showDefinition() { $("definition-source").value = JSON.stringify(definitions[$("definition").value], null, 2); }
for (const name of Object.keys(definitions)) {
  const option = document.createElement("option"); option.value = name; option.textContent = name; $("definition").append(option);
}
$("definition").addEventListener("change", showDefinition);
for (const id of controls) $(id).addEventListener(id === "width" || id === "rotation" ? "input" : "change", () => {
  try {
    render();
    if (id === "example") { $("definition").value = fixtures.scenes[$("example").value].editDefinition; showDefinition(); }
    status("Preview updated. Accepted definitions retained.");
  } catch (error) { status(error.message, true); }
});
$("apply").addEventListener("click", () => {
  try {
    const input = $("definition-source").value;
    if (new TextEncoder().encode(input).length > 32768) throw new Error("Definition editor input exceeds 32 KiB.");
    const candidate = structuredClone(definitions);
    candidate[$("definition").value] = JSON.parse(input);
    render(candidate);
    definitions = candidate;
    status(`Applied ${$("definition").value} to all uses. Browser prototype validation passed.`);
  } catch (error) { status(`Rejected: ${error.message} Accepted preview unchanged.`, true); }
});
$("reset-definition").addEventListener("click", () => {
  definitions[$("definition").value] = structuredClone(fixtures.definitions[$("definition").value]);
  showDefinition(); render(); status("Original definition restored.");
});
$("invalid").addEventListener("click", () => {
  $("definition-source").value = JSON.stringify({ kind: "script", id: "unsupported" }, null, 2);
  $("apply").click();
});
$("save").addEventListener("click", () => {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...options(), example: $("example").value }));
    $("save-status").textContent = "Saved. Reload to restore these layout settings.";
  } catch { $("save-status").textContent = "Browser storage unavailable; current preview remains usable."; }
});
$("reset-layout").addEventListener("click", () => {
  $("width").value = "340"; $("rotation").value = "0"; $("theme").value = "pastel"; $("documentation").checked = true;
  try { localStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
  render(); $("save-status").textContent = "Layout settings reset.";
});
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  if (saved && Object.hasOwn(fixtures.scenes, saved.example)) {
    $("example").value = saved.example;
    if (Number.isFinite(saved.width) && saved.width >= 250 && saved.width <= 430) $("width").value = String(saved.width);
    if ([0, 90, 180, 270].includes(saved.rotation)) $("rotation").value = String(saved.rotation);
    if (["pastel", "mono"].includes(saved.theme)) $("theme").value = saved.theme;
    if (typeof saved.documentation === "boolean") $("documentation").checked = saved.documentation;
  }
} catch { /* Malformed optional saved settings cannot prevent loading. */ }
$("definition").value = fixtures.scenes[$("example").value].editDefinition;
showDefinition();
try { render(); status("Ready. Edit a definition or select a symbol to explore."); }
catch (error) { status(`Preview could not load: ${error.message}`, true); }
