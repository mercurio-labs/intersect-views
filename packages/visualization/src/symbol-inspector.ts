import { SymbolEdit } from "./symbol-editor.ts";
import type { PropertyTarget } from "./symbol-properties-contract.ts";
import type { GraphPresentation, Layout } from "./protocol.ts";
import type { GraphicValue } from "./graphics-contract.ts";
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export interface SymbolInspectorCallbacks {
  preview(
    candidate: GraphPresentation,
  ): Promise<{ targets: PropertyTarget[]; layout: Layout }>;
  apply(candidate: GraphPresentation): void;
  cancel(): void;
}
/** Typed controls over one detached, explicitly selected occurrence transaction. */
export class SymbolInspector {
  readonly edit: SymbolEdit;
  private generation = 0;
  private ready = false;
  private closed = false;
  private filter = "";
  private panel: HTMLElement;
  private message: HTMLElement;
  private layout: Layout;
  constructor(
    root: HTMLElement,
    view: GraphPresentation,
    selection: string[],
    targets: PropertyTarget[],
    layout: Layout,
    readonly writable: boolean,
    private callbacks: SymbolInspectorCallbacks,
    names: Record<string, string> = {},
  ) {
    this.layout = layout;
    this.edit = new SymbolEdit(view, selection, targets);
    this.panel = document.createElement("aside");
    this.panel.className = "symbol-inspector";
    this.panel.setAttribute("aria-label", "Symbol properties");
    root.append(this.panel);
    this.panel.innerHTML = `<header><strong>Symbol</strong><button data-symbol-action="cancel" aria-label="Close Symbol properties">×</button></header><p>${selection.length} selected occurrence${selection.length === 1 ? "" : "s"}</p><p>${writable ? "Local display · model source remains unchanged" : "Presentation store is read only · display cannot be saved"}</p><input data-property-filter aria-label="Filter symbol properties" type="search" placeholder="Filter properties"/><div class="symbol-property-list"></div><div class="symbol-size-list"></div><p data-symbol-status role="status">Change a property to preview it.</p><footer><button data-symbol-action="apply" disabled>Apply</button><button data-symbol-action="cancel">Cancel</button><button data-symbol-action="selection" ${writable ? "" : "disabled"}>Reset selected styles</button><button data-symbol-action="view" ${writable ? "" : "disabled"}>Reset view styles</button></footer>`;
    this.message = this.panel.querySelector("[data-symbol-status]")!;
    this.renderProperties();
    const sizes = this.panel.querySelector(".symbol-size-list")!;
    for (const id of selection) {
      const g = layout.nodes[id],
        min = layout.minimum[id];
      if (!g || !min) continue;
      const section = document.createElement("section");
      section.dataset.sizeTarget = id;
      section.innerHTML = `<h4>Size and placement</h4><p>${esc(names[id] ?? id)}</p><p>Position ${g.x.toFixed(1)}, ${g.y.toFixed(1)} · allocated ${g.width.toFixed(1)} × ${g.height.toFixed(1)}<br/>Measured minimum ${min.width.toFixed(1)} × ${min.height.toFixed(1)}${layout.preferred?.[id] ? `<br/>Package preferred ${layout.preferred[id].width.toFixed(1)} × ${layout.preferred[id].height.toFixed(1)}` : ""}</p><label>Width<input data-size="width" aria-label="Symbol width" type="number" min="${min.width}" max="1000000" value="${g.width}" ${writable ? "" : "disabled"}/></label><label>Height<input data-size="height" aria-label="Symbol height" type="number" min="${min.height}" max="1000000" value="${g.height}" ${writable ? "" : "disabled"}/></label><button data-auto-size ${writable ? "" : "disabled"}>Auto size</button>`;
      sizes.append(section);
    }
    const offsets = selection.flatMap((id) =>
      view.labelPlacements[id]
        ? [`${id}: ${JSON.stringify(view.labelPlacements[id])}`]
        : [],
    );
    if (offsets.length) {
      const p = document.createElement("p");
      p.textContent = `Bound label placement: ${offsets.join("; ")}`;
      sizes.append(p);
    }
    this.panel.oninput = (e) => {
      const input = e.target as HTMLInputElement;
      if (input.matches("[data-property-filter]")) {
        this.filter = input.value;
        this.renderProperties();
      }
    };
    this.panel.onchange = (e) => {
      const input = e.target as HTMLInputElement | HTMLSelectElement;
      try {
        const key = input.dataset.property;
        if (key) {
          const row = this.edit.rows.find((r) => r.key === key)!;
          if (
            row.targets[0].descriptor.editor.kind === "number" &&
            !input.value.trim()
          )
            throw Error("Enter a number before previewing this property");
          const kind = row.targets[0].descriptor.editor.kind,
            value: GraphicValue =
              kind === "bool"
                ? (input as HTMLInputElement).checked
                : kind === "number"
                  ? Number(input.value)
                  : input.value;
          this.edit.set(key, value);
        } else if (input.dataset.size) {
          const section = input.closest<HTMLElement>("[data-size-target]")!,
            id = section.dataset.sizeTarget!;
          this.edit.size(
            id,
            Number(
              section.querySelector<HTMLInputElement>('[data-size="width"]')!
                .value,
            ),
            Number(
              section.querySelector<HTMLInputElement>('[data-size="height"]')!
                .value,
            ),
            this.layout.minimum[id],
          );
        } else return;
        void this.preview();
      } catch (error) {
        this.fail(error);
      }
    };
    this.panel.onclick = (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!button || button.disabled) return;
      try {
        if (button.dataset.resetProperty) {
          this.edit.resetProperty(button.dataset.resetProperty);
          void this.preview();
          return;
        }
        if (button.hasAttribute("data-auto-size")) {
          const id =
            button.closest<HTMLElement>("[data-size-target]")!.dataset
              .sizeTarget!;
          this.edit.size(id, undefined, undefined, this.layout.minimum[id]);
          void this.preview();
          return;
        }
        const action = button.dataset.symbolAction;
        if (action === "cancel") {
          this.close();
          callbacks.cancel();
        } else if (action === "apply") {
          if (!this.ready || !writable)
            throw Error("Wait for a successful current preview");
          const candidate = this.edit.candidate(view);
          callbacks.apply(candidate);
          this.close();
        } else if (action === "selection" || action === "view") {
          this.edit.reset(action);
          void this.preview();
        }
      } catch (error) {
        this.fail(error);
      }
    };
    this.panel.onkeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
        callbacks.cancel();
      }
    };
    this.panel
      .querySelector<HTMLInputElement>("[data-property-filter]")!
      .focus();
  }
  private renderProperties() {
    const list = this.panel.querySelector(".symbol-property-list")!;
    list.replaceChildren();
    let group = "";
    const rows = this.edit.rows.filter((r) =>
      `${r.targets[0].descriptor.label} ${r.targets[0].descriptor.group} ${r.targets[0].descriptor.description}`
        .toLowerCase()
        .includes(this.filter.toLowerCase()),
    );
    if (!this.edit.rows.length)
      list.textContent =
        "This symbol does not declare editable visual parameters. Language-specific display options require a presentation package.";
    for (const row of rows) {
      const t = row.targets[0],
        p = t.descriptor,
        disabled = !row.editable || !this.writable;
      if (group !== p.group) {
        const h = document.createElement("h4");
        h.textContent = p.group;
        list.append(h);
        group = p.group;
      }
      const local = this.edit.draft.symbolOverrides[t.target],
        value =
          local && Object.hasOwn(local, row.key) ? local[row.key] : t.current,
        box = document.createElement("div");
      box.className = "symbol-property";
      const attrs = `data-property="${row.key}" aria-label="${esc(p.label)}" ${disabled ? "disabled" : ""}`,
        control =
          p.editor.kind === "bool"
            ? `<input type="checkbox" ${attrs} ${value ? "checked" : ""}/>`
            : p.editor.kind === "choice"
              ? `<select ${attrs}>${row.mixed ? '<option value="" selected disabled>Mixed</option>' : ""}${t.choices!.map((v) => `<option ${v === value && !row.mixed ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`
              : `<input type="${p.editor.kind === "number" ? "number" : "text"}" ${attrs} ${p.editor.kind === "number" ? `min="${p.editor.minimum}" max="${p.editor.maximum}" step="any"` : 'maxlength="64"'} value="${row.mixed ? "" : esc(value)}" ${row.mixed ? 'placeholder="Mixed"' : ""}/>`;
      box.innerHTML = `<label title="${esc(p.description)}">${esc(p.label)}${control}</label><small>${row.mixed ? "Mixed values" : `Current ${esc(value)}`} · inherited ${esc(t.inherited)} · ${esc(t.origin)}</small>${row.reason ? `<small>${esc(row.reason)}</small>` : ""}<button data-reset-property="${row.key}" ${this.writable ? "" : "disabled"} aria-label="Reset ${esc(p.label)}">Reset property</button>`;
      if (p.editor.kind === "bool" && row.mixed)
        box.querySelector("input")!.indeterminate = true;
      list.append(box);
    }
  }
  private fail(error: unknown) {
    this.generation++;
    this.ready = false;
    this.panel.querySelector<HTMLButtonElement>(
      '[data-symbol-action="apply"]',
    )!.disabled = true;
    this.message.textContent =
      error instanceof Error ? error.message : String(error);
  }
  private async preview() {
    const generation = ++this.generation;
    this.ready = false;
    this.panel.querySelector<HTMLButtonElement>(
      '[data-symbol-action="apply"]',
    )!.disabled = true;
    this.message.textContent = "Checking measurement and routing…";
    try {
      if (!this.writable) throw Error("Presentation store is read only");
      const result = await this.callbacks.preview(
        this.edit.candidate(this.edit.original),
      );
      if (this.closed || generation !== this.generation) return;
      this.layout = result.layout;
      for (const section of this.panel.querySelectorAll<HTMLElement>(
        "[data-size-target]",
      )) {
        const id = section.dataset.sizeTarget!,
          g = this.layout.nodes[id],
          min = this.layout.minimum[id],
          preferred = this.layout.preferred?.[id];
        section.querySelectorAll("p")[1].textContent =
          `Position ${g.x.toFixed(1)}, ${g.y.toFixed(1)} · allocated ${g.width.toFixed(1)} × ${g.height.toFixed(1)} · measured minimum ${min.width.toFixed(1)} × ${min.height.toFixed(1)}${preferred ? ` · package preferred ${preferred.width.toFixed(1)} × ${preferred.height.toFixed(1)}` : ""}`;
        for (const input of section.querySelectorAll<HTMLInputElement>(
          "[data-size]",
        )) {
          const axis = input.dataset.size as "width" | "height";
          input.min = String(min[axis]);
          if (input !== document.activeElement) input.value = String(g[axis]);
        }
      }
      for (const row of this.edit.rows) {
        for (const t of row.targets) {
          const current = result.targets.find(
            (p) => p.target === t.target && p.key === t.key,
          );
          if (current) Object.assign(t, current);
        }
        row.mixed = row.targets.some(
          (t) => t.current !== row.targets[0].current,
        );
      }
      const focus = document.activeElement as HTMLElement,
        key = focus?.dataset.property;
      this.renderProperties();
      if (key)
        this.panel
          .querySelector<HTMLElement>(`[data-property="${key}"]`)
          ?.focus();
      this.ready = true;
      this.panel.querySelector<HTMLButtonElement>(
        '[data-symbol-action="apply"]',
      )!.disabled = false;
      this.message.textContent =
        "Preview ready · Apply saves this display change.";
    } catch (error) {
      if (!this.closed && generation === this.generation) this.fail(error);
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.edit.invalidate();
    this.panel.remove();
  }
}
