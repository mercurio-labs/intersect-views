/** Sparse, bounded DOM grid. Coordinates are transient; only bindings reveal source. */
import type {
  Binding,
  GridCell,
  GridSceneResponse,
  GridValue,
  View,
} from "./protocol.ts";
import type { Callbacks } from "./canvas.ts";
import "./grid.css";
import { validateSceneResponse } from "./protocol.ts";
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
export function gridValue(value: GridValue): string {
  switch (value.kind) {
    case "string":
      return value.value === "" ? '""' : value.value;
    case "boolean":
      return String(value.value);
    case "integer":
      return value.value;
    case "reference":
      return value.label;
    case "list":
      return value.items.map(gridValue).join(", ");
  }
}
export class GridCanvas {
  private response?: GridSceneResponse;
  private stale = true;
  private seq = 0;
  private busy = false;
  private coordinate = { r: 0, c: 0 };
  private positions = new Map<
    string,
    { r: number; c: number; top: number; left: number }
  >();
  private member?: string;
  private cells = new Map<string, GridCell>();
  private viewport = el("div");
  private content = el("div");
  private message = el("div");
  private actions = el("div");
  private selector = el("select");
  private count = el("span");
  private selected = "";
  constructor(
    private root: HTMLElement,
    private callbacks: Callbacks,
  ) {
    root.className = "grid-workbench";
    const heading = el("div");
    heading.className = "diagram-heading";
    this.selector.setAttribute("aria-label", "Grid view");
    this.selector.onchange = () => callbacks.view(this.selector.value);
    heading.append(el("strong", "GRID"), this.selector, this.count);
    this.message.className = "diagram-status";
    this.message.setAttribute("role", "status");
    this.viewport.className = "grid-viewport";
    this.viewport.tabIndex = 0;
    this.viewport.setAttribute("role", "grid");
    this.viewport.setAttribute("aria-label", "Model grid");
    this.content.className = "grid-content";
    this.viewport.append(this.content);
    this.actions.className = "grid-actions";
    root.append(heading, this.message, this.viewport, this.actions);
    this.viewport.onscroll = () => {
      this.remember();
      this.render();
    };
    this.viewport.onkeydown = (e) => this.key(e);
  }
  views(views: View[], selected: string) {
    this.selected = selected;
    this.selector.replaceChildren(
      ...views.map((v) => {
        const o = el("option", v.name);
        o.value = v.key;
        return o;
      }),
    );
    this.selector.value = selected;
  }
  requestView(key: string) {
    if (key !== this.selected) {
      this.seq++;
      this.member = undefined;
    }
    this.selected = key;
  }
  status(message: string) {
    this.message.textContent = message;
  }
  setStale() {
    this.stale = true;
    this.seq++;
    this.actions.replaceChildren(
      el("span", "Stale grid — analyze source to edit."),
    );
    this.root.classList.add("stale");
  }
  setScene(response: GridSceneResponse) {
    validateSceneResponse(response);
    const old = this.response?.scene.view.key;
    this.response = response;
    this.stale = false;
    this.seq++;
    this.root.classList.remove("stale");
    this.cells = new Map(
      response.scene.grid.cells.map((c) => [
        JSON.stringify([c.row, c.column]),
        c,
      ]),
    );
    if (old !== response.scene.view.key) {
      const saved = this.positions.get(response.scene.view.key);
      this.coordinate = { r: saved?.r ?? 0, c: saved?.c ?? 0 };
      this.viewport.scrollTop = saved?.top ?? 0;
      this.viewport.scrollLeft = saved?.left ?? 0;
      this.member = undefined;
    }
    const g = response.scene.grid;
    this.coordinate.r = Math.min(
      this.coordinate.r,
      Math.max(0, g.rows.length - 1),
    );
    this.coordinate.c = Math.min(
      this.coordinate.c,
      Math.max(0, g.columns.length - 1),
    );
    this.count.textContent = `${g.rows.length} rows · ${g.columns.length} columns`;
    this.viewport.setAttribute("aria-rowcount", String(g.rows.length + 1));
    this.viewport.setAttribute("aria-colcount", String(g.columns.length + 1));
    this.content.style.width = `${180 + g.columns.length * 140}px`;
    this.content.style.height = `${34 + g.rows.length * 34}px`;
    this.status(response.scene.problems.join(" · "));
    this.render();
    void this.details();
  }
  private remember() {
    if (this.response)
      this.positions.set(this.response.scene.view.key, {
        ...this.coordinate,
        top: this.viewport.scrollTop,
        left: this.viewport.scrollLeft,
      });
  }
  private cell(r = this.coordinate.r, c = this.coordinate.c) {
    const g = this.response?.scene.grid;
    return g
      ? this.cells.get(JSON.stringify([g.rows[r]?.id, g.columns[c]?.id]))
      : undefined;
  }
  private select(binding: Binding, reveal = false) {
    this.callbacks.select(binding, reveal);
  }
  private render() {
    const scene = this.response?.scene;
    if (!scene) return;
    const g = scene.grid,
      startRow = Math.min(
        Math.max(0, Math.floor(this.viewport.scrollTop / 34)),
        Math.max(0, g.rows.length - 40),
      ),
      startCol = Math.min(
        Math.max(0, Math.floor(this.viewport.scrollLeft / 140)),
        Math.max(0, g.columns.length - 20),
      );
    const restoreFocus =
      this.content.contains(document.activeElement) &&
      document.activeElement?.getAttribute("role") === "gridcell";
    this.content.replaceChildren();
    const header = el("div");
    header.setAttribute("role", "row");
    header.className = "grid-headers";
    header.style.top = `${this.viewport.scrollTop}px`;
    const corner = el("span", g.kind === "table" ? "Subject" : "From / To");
    corner.className = "grid-corner";
    corner.style.left = `${this.viewport.scrollLeft}px`;
    header.append(corner);
    for (let c = startCol; c < Math.min(g.columns.length, startCol + 20); c++) {
      const column = g.columns[c],
        button = el("button", column.label);
      button.className = "grid-column";
      button.style.left = `${180 + c * 140}px`;
      button.setAttribute("role", "columnheader");
      button.setAttribute("aria-colindex", String(c + 2));
      if (g.kind === "matrix") {
        button.onclick = () => this.select(g.columns[c].binding, true);
      } else
        button.title = `${g.columns[c].scalar}${g.columns[c].many ? " list" : ""}`;
      header.append(button);
    }
    this.content.append(header);
    const renderRow = (r: number, onlyFocus = false) => {
      const row = el("div");
      row.className = "grid-row";
      row.style.top = `${34 + r * 34}px`;
      row.setAttribute("role", "row");
      row.setAttribute("aria-rowindex", String(r + 2));
      if (!onlyFocus) {
        const name = el("button", g.rows[r].label);
        name.className = "grid-row-header";
        name.style.left = `${this.viewport.scrollLeft}px`;
        name.setAttribute("role", "rowheader");
        name.onclick = () => this.select(g.rows[r].binding, true);
        row.append(name);
      }
      const cols = onlyFocus
        ? [this.coordinate.c]
        : Array.from(
            { length: Math.min(20, g.columns.length - startCol) },
            (_, i) => startCol + i,
          );
      for (const c of cols) {
        const cell = this.cell(r, c),
          button = el(
            "button",
            cell
              ? cell.origin === "derived"
                ? "●"
                : gridValue(cell.value)
              : "·",
          );
        button.className = `grid-cell ${cell?.origin ?? "empty"}`;
        button.dataset.row = String(r);
        button.dataset.column = String(c);
        button.dataset.cellId = cell?.id ?? "";
        button.style.left = `${180 + c * 140}px`;
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-colindex", String(c + 2));
        button.setAttribute("aria-rowindex", String(r + 2));
        button.title =
          cell?.origin === "derived"
            ? "Derived relation — read-only"
            : cell
              ? `${g.rows[r].label} → ${g.columns[c].label}: ${gridValue(cell.value)}`
              : "Empty coordinate";
        const focused = r === this.coordinate.r && c === this.coordinate.c;
        button.tabIndex = focused ? 0 : -1;
        button.setAttribute("aria-selected", String(focused));
        button.onclick = () => this.focus(r, c, false);
        button.ondblclick = () => {
          this.focus(r, c, false);
          this.reveal();
        };
        button.onfocus = () => {
          if (r !== this.coordinate.r || c !== this.coordinate.c)
            this.focus(r, c, false);
        };
        row.append(button);
      }
      this.content.append(row);
    };
    for (let r = startRow; r < Math.min(g.rows.length, startRow + 40); r++)
      renderRow(r);
    if (
      g.rows.length &&
      g.columns.length &&
      (this.coordinate.r < startRow ||
        this.coordinate.r >= startRow + 40 ||
        this.coordinate.c < startCol ||
        this.coordinate.c >= startCol + 20)
    ) {
      if (this.coordinate.r >= startRow && this.coordinate.r < startRow + 40) {
        const row = this.content.querySelector(
          `[aria-rowindex="${this.coordinate.r + 2}"]`,
        );
        const before = this.content.childElementCount;
        renderRow(this.coordinate.r, true);
        if (this.content.childElementCount > before && row) {
          row.append(this.content.lastElementChild!.lastElementChild!);
          this.content.lastElementChild!.remove();
        }
      } else renderRow(this.coordinate.r, true);
    }
    if (!g.rows.length || !g.columns.length) {
      const empty = el(
        "p",
        "No axis elements in this scope. Add model elements to this view or change the query.",
      );
      empty.className = "grid-empty-state";
      this.content.append(empty);
    }
    if (restoreFocus)
      this.content
        .querySelector<HTMLElement>(
          `[data-row="${this.coordinate.r}"][data-column="${this.coordinate.c}"]`,
        )
        ?.focus({ preventScroll: true });
  }
  private focus(r: number, c: number, dom = true) {
    this.coordinate = { r, c };
    this.member = undefined;
    this.seq++;
    const top = 34 + r * 34,
      left = 180 + c * 140;
    if (top < this.viewport.scrollTop + 34)
      this.viewport.scrollTop = Math.max(0, top - 34);
    if (top + 34 > this.viewport.scrollTop + this.viewport.clientHeight)
      this.viewport.scrollTop = top + 34 - this.viewport.clientHeight;
    if (left < this.viewport.scrollLeft + 180)
      this.viewport.scrollLeft = Math.max(0, left - 180);
    if (left + 140 > this.viewport.scrollLeft + this.viewport.clientWidth)
      this.viewport.scrollLeft = left + 140 - this.viewport.clientWidth;
    this.remember();
    this.render();
    if (dom)
      this.content
        .querySelector<HTMLElement>(`[data-row="${r}"][data-column="${c}"]`)
        ?.focus({ preventScroll: true });
    void this.details();
  }
  private reveal(reveal = true) {
    const cell = this.cell();
    if (!cell) return;
    if (cell.members.length > 1 && !this.member) {
      this.actions.querySelector<HTMLSelectElement>("select")?.focus();
      return;
    }
    const binding =
      cell.members.find((m) => m.id === this.member)?.binding ?? cell.binding;
    this.select(binding, reveal);
  }
  private key(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === "z" || key === "y") {
        e.preventDefault();
        if (key === "y" || e.shiftKey) this.callbacks.redo?.();
        else this.callbacks.undo();
        return;
      }
    }

    const g = this.response?.scene.grid;
    if (!g?.rows.length || !g.columns.length) return;
    let { r, c } = this.coordinate;
    switch (e.key) {
      case "ArrowUp":
        r--;
        break;
      case "ArrowDown":
        r++;
        break;
      case "ArrowLeft":
        c--;
        break;
      case "ArrowRight":
        c++;
        break;
      case "Home":
        c = 0;
        if (e.ctrlKey) r = 0;
        break;
      case "End":
        c = g.columns.length - 1;
        if (e.ctrlKey) r = g.rows.length - 1;
        break;
      case "Enter":
        this.reveal();
        e.preventDefault();
        return;
      case " ":
        this.reveal(false);
        e.preventDefault();
        return;
      case "Delete":
        void this.details(true);
        e.preventDefault();
        return;
      case "Escape":
        this.seq++;
        this.member = undefined;
        this.actions.replaceChildren(el("span", "Action canceled"));
        return;
      default:
        return;
    }
    e.preventDefault();
    this.focus(
      Math.max(0, Math.min(g.rows.length - 1, r)),
      Math.max(0, Math.min(g.columns.length - 1, c)),
    );
  }
  private async details(deleteFocus = false) {
    const response = this.response;
    if (!response) return;
    const g = response.scene.grid,
      row = g.rows[this.coordinate.r],
      column = g.columns[this.coordinate.c],
      cell = this.cell();
    const seq = ++this.seq;
    this.actions.replaceChildren();
    if (!row || !column) return;
    this.actions.append(el("strong", `${row.label} → ${column.label}`));
    if (cell) {
      const reveal = el("button", "Reveal source");
      reveal.onclick = () => this.reveal();
      this.actions.append(reveal);
      if (cell.value.kind === "reference") {
        const ref = el("button", `Reveal ${cell.value.label}`);
        ref.onclick = () =>
          this.select(
            (cell.value as Extract<GridValue, { kind: "reference" }>).binding,
            true,
          );
        this.actions.append(ref);
      }
      if (cell.value.kind === "list")
        for (const v of cell.value.items)
          if (v.kind === "reference") {
            const ref = el("button", `Reveal ${v.label}`);
            ref.onclick = () => this.select(v.binding, true);
            this.actions.append(ref);
          }
      if (cell.members.length > 1) {
        const picker = el("select");
        picker.setAttribute("aria-label", "Relation member");
        const none = el("option", "Choose a relation member");
        none.value = "";
        picker.append(
          none,
          ...cell.members.map((m) => {
            const o = el("option", m.label);
            o.value = m.id;
            return o;
          }),
        );
        picker.value = this.member ?? "";
        picker.onchange = () => {
          this.member = picker.value || undefined;
          void this.details();
        };
        this.actions.append(picker);
        if (deleteFocus) picker.focus();
      } else if (cell.members.length === 1) this.member = cell.members[0].id;
      if (cell.origin === "derived")
        this.actions.append(el("span", "Derived relation — read-only."));
    }
    if (g.kind === "table") {
      if (cell) {
        const copy = el("button", "Copy value");
        copy.disabled = !this.callbacks.copy;
        copy.title = copy.disabled
          ? "Clipboard adapter unavailable"
          : "Copy projected value";
        copy.onclick = () => {
          const value =
            cell.value.kind === "string"
              ? cell.value.value
              : gridValue(cell.value);
          void this.callbacks.copy?.(value).then(
            () => this.status("Value copied."),
            (error) => this.status(String(error)),
          );
        };
        this.actions.append(copy);
      }
      this.actions.append(el("span", "Query projection — read-only."));
      return;
    }
    if (this.stale || this.busy) {
      this.actions.append(el("span", "Edits unavailable while stale or busy."));
      return;
    }
    const tools = response.scene.palette.groups
      .flatMap((group) => group.entries)
      .filter((t) => t.gesture === "action");
    for (const tool of tools) {
      const form = el("form"),
        button = el("button", tool.label),
        reason = el("span", "Checking applicability…");
      button.type = "submit";
      button.disabled = true;
      button.dataset.gridTool = tool.id;
      form.append(button, reason);
      const inputs = tool.inputs.map((input) => {
        const label = el("label", input.label);
        const field = el("input");
        field.name = input.id;
        field.value = input.default;
        label.append(field);
        form.append(label);
        return field;
      });
      this.actions.append(form);
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (this.stale || this.busy || button.disabled) return;
        this.busy = true;
        button.disabled = true;
        try {
          await this.callbacks.command(tool, row.binding.key, {
            ...Object.fromEntries(inputs.map((i) => [i.name, i.value])),
            row: row.id,
            column: column.id,
            ...(this.member ? { member: this.member } : {}),
          });
        } catch (error) {
          this.status(String(error));
        } finally {
          this.busy = false;
          void this.details();
        }
      };
      try {
        const result = await this.callbacks.gridTargets?.(
          tool,
          row.id,
          column.id,
          this.member,
        );
        if (seq !== this.seq || this.stale || this.response !== response)
          return;
        const cap = response.capabilities.find((c) => c.toolId === tool.id);
        button.disabled = !result?.enabled || !cap?.enabled;
        reason.textContent =
          result?.reason ?? "No current applicability result";
        button.title = reason.textContent;
      } catch (error) {
        if (seq === this.seq) reason.textContent = String(error);
      }
    }
  }
  highlight(id: string | null) {
    this.root
      .querySelectorAll(".grid-source-selected")
      .forEach((n) => n.classList.remove("grid-source-selected"));
    if (!id || !this.response) return;
    const g = this.response.scene.grid;
    const r = g.rows.findIndex((r) => r.binding.elementId === id);
    if (r >= 0) {
      this.content
        .querySelector(`[aria-rowindex="${r + 2}"] .grid-row-header`)
        ?.classList.add("grid-source-selected");
    }
    for (const cell of g.cells)
      if (
        cell.binding.elementId === id ||
        cell.members.some((m) => m.binding.elementId === id)
      ) {
        const r = g.rows.findIndex((r) => r.id === cell.row),
          c = g.columns.findIndex((c) => c.id === cell.column);
        this.focus(r, c, false);
        this.content
          .querySelector(`[data-row="${r}"][data-column="${c}"]`)
          ?.classList.add("grid-source-selected");
        break;
      }
  }
}
