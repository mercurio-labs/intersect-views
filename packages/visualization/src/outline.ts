import { labelText, validateSceneResponse } from "./protocol.ts";
import type { Binding, GraphSceneResponse, Node, View } from "./protocol.ts";
import "./outline.css";

interface OutlineCallbacks {
  view(key: string): void;
  select(binding: Binding, reveal: boolean): void;
}

/** Displays a source-bound containment scene as an expandable list. */
export class OutlineCanvas {
  private readonly picker = document.createElement("select");
  private readonly message = document.createElement("div");
  private readonly list = document.createElement("ul");
  private readonly expansion = new Map<string, Map<string, boolean>>();
  private readonly buttons = new Map<string, HTMLButtonElement[]>();
  private selected: string | null = null;
  private stale = true;

  constructor(root: HTMLElement, private readonly callbacks: OutlineCallbacks) {
    root.classList.add("outline-workbench");
    const heading = document.createElement("div");
    heading.className = "diagram-heading";
    this.picker.setAttribute("aria-label", "Browser view");
    this.picker.onchange = () => this.callbacks.view(this.picker.value);
    heading.append(this.picker);
    this.message.className = "diagram-status";
    this.message.setAttribute("role", "status");
    this.list.className = "view-outline";
    this.list.setAttribute("aria-label", "Model membership");
    root.append(heading, this.message, this.list);
  }

  views(views: View[], selected: string) {
    const keys = new Set(views.map((view) => view.key));
    for (const key of this.expansion.keys()) {
      if (!keys.has(key)) this.expansion.delete(key);
    }
    this.picker.replaceChildren(...views.map((view) => new Option(view.name, view.key)));
    this.picker.value = selected;
  }

  reset() {
    this.expansion.clear();
    this.buttons.clear();
    this.list.replaceChildren();
    this.selected = null;
    this.stale = true;
  }

  setScene(response: GraphSceneResponse) {
    validateSceneResponse(response);
    const scene = response.scene;
    if (scene.layout.strategy !== "outline") throw Error("Expected an outline scene");
    const previous = this.expansion.get(scene.view.key);
    const expanded = new Map<string, boolean>();
    this.buttons.clear();
    this.stale = false;
    this.list.replaceChildren(...scene.nodes.map((node) => this.row(node, previous, expanded, true)));
    this.expansion.set(scene.view.key, expanded);
    this.status(scene.problems.join(" · ") || (scene.nodes.length ? "" : "This view exposes no elements."));
    this.highlight(this.selected);
  }

  setStale() {
    this.stale = true;
    for (const buttons of this.buttons.values()) {
      for (const button of buttons) button.disabled = true;
    }
  }

  status(message: string) {
    this.message.textContent = message;
    this.message.hidden = !message;
  }

  highlight(id: string | null) {
    this.selected = id;
    for (const [elementId, buttons] of this.buttons) {
      for (const button of buttons) {
        button.classList.toggle("outline-selected", elementId === id);
      }
    }
  }

  private row(
    node: Node,
    previous: ReadonlyMap<string, boolean> | undefined,
    expanded: Map<string, boolean>,
    root: boolean,
  ): HTMLLIElement {
    const item = document.createElement("li");
    const row = document.createElement("div");
    row.className = "outline-row";
    const name = labelText(node.title) || "Unnamed element";
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "outline-reveal";
    reveal.textContent = name;
    reveal.title = labelText(node.subtitle);
    reveal.setAttribute("aria-label", "Reveal " + name);
    reveal.onclick = () => {
      if (!this.stale) this.callbacks.select(node.binding, true);
    };
    const buttons = this.buttons.get(node.binding.elementId) ?? [];
    buttons.push(reveal);
    this.buttons.set(node.binding.elementId, buttons);

    if (node.children.length) {
      const children = document.createElement("ul");
      children.append(...node.children.map((child) => this.row(child, previous, expanded, false)));
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "outline-toggle";
      const setExpanded = (open: boolean) => {
        expanded.set(node.id, open);
        children.hidden = !open;
        toggle.textContent = open ? "▾" : "▸";
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", (open ? "Collapse " : "Expand ") + name);
      };
      setExpanded(previous?.get(node.id) ?? root);
      toggle.onclick = () => setExpanded(children.hidden);
      row.append(toggle);
      item.append(row, children);
    } else {
      row.classList.add("outline-leaf");
      item.append(row);
    }
    row.append(reveal);
    return item;
  }
}
