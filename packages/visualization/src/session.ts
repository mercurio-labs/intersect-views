import { validateRenderingResolution, type RenderingResolution } from "./rendering.ts";
import type { LaneTargetResponse } from "./lane-protocol.ts";
import { validateLaneTargets } from "./lane-validation.ts";
/** Application-independent session, ported from Mercurio diagrams.ts (M5).
 * The adapter applies all patches synchronously as one undo group. Reserving a
 * revision advances its allocation clock, not its current buffer revision. */
import {
  validateSceneResponse,
  type Palette,
  type PreparedEdit,
  type SceneResponse,
  type Scope,
  type SourcePatch,
  type View,
  type Rejection,
  type TargetResponse,
  type GridTargetResponse,
  type LabelTargetResponse,
  validateLabelTargets,
  validateGridTargets,
} from "./protocol.ts";
import { validatePreparedEdit, validateTargets } from "./validation.ts";
import { Exploration } from "./scope.ts";
export interface HostClient {
  request<T = unknown>(method: string, params: unknown): Promise<T>;
}
export interface Analysis {
  revision: number;
  clean: boolean;
  [key: string]: unknown;
}
export interface BufferAdapter {
  read(uri: string): string | undefined;
  sources(): { uri: string; text: string }[];
  apply(patches: SourcePatch[]): void;
  undo(): void;
  revision(): number;
  reserveRevision(revision: number): void;
  publish(analysis: Analysis): void;
}
export interface SceneSurface {
  views(views: View[], selected: string): void;
  requestView(key: string): void;
  setScene(scene: SceneResponse): void;
  rendering?(resolution: RenderingResolution): void;
  setStale(): void;
  status(message: string): void;
  highlight(id: string | null): void;
}
export class CommandRejection extends Error {
  readonly code: string;
  readonly feature?: string;
  readonly elementKey?: string;
  constructor(value: Rejection) {
    super(value.message);
    this.name = "CommandRejection";
    this.code = value.code;
    this.feature = value.feature;
    this.elementKey = value.elementKey;
  }
}
export async function bufferHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function offset(
  text: string,
  position: { line: number; character: number },
): number {
  const lines = text.split("\n");
  if (
    position.line >= lines.length ||
    position.character > lines[position.line].length
  )
    throw new Error("Prepared range is outside the buffer");
  return (
    lines.slice(0, position.line).reduce((n, l) => n + l.length + 1, 0) +
    position.character
  );
}
export class ViewSession {
  selectedView = "";
  palette?: Palette;
  private explorations = new Map<string, Exploration>();
  private sequence = 0;
  private cursorSequence = 0;
  private targetSequence = 0;
  private pending = false;
  private analysis?: Analysis;
  private host: HostClient;
  private buffers: BufferAdapter;
  private canvas: SceneSurface;
  constructor(host: HostClient, buffers: BufferAdapter, canvas: SceneSurface) {
    this.host = host;
    this.buffers = buffers;
    this.canvas = canvas;
  }
  setAnalysis(analysis: Analysis) {
    this.analysis = analysis;
  }
  invalidate() {
    this.sequence++;
    this.cursorSequence++;
    this.targetSequence++;
    this.canvas.setStale();
  }
  exploration(saved?: Scope): Exploration {
    let state = this.explorations.get(this.selectedView);
    if (!state) {
      state = new Exploration(saved);
      this.explorations.set(this.selectedView, state);
    }
    return state;
  }
  setScope(scope: Scope) {
    this.explorations.set(this.selectedView, new Exploration(scope));
  }
  private contextKey(): string {
    return JSON.stringify([
      this.selectedView,
      this.explorations.get(this.selectedView)?.scope,
      this.palette,
    ]);
  }
  private current(revision: number) {
    return (
      revision === this.buffers.revision() &&
      this.analysis?.revision === revision &&
      this.analysis.clean
    );
  }
  async refresh(): Promise<void> {
    const revision = this.buffers.revision(),
      seq = ++this.sequence;
    let context = this.contextKey();
    const current = () =>
      seq === this.sequence &&
      this.current(revision) &&
      context === this.contextKey();
    this.targetSequence++;
    this.cursorSequence++;
    this.canvas.setStale();
    if (!this.current(revision)) return;
    try {
      const catalog = await this.host.request<{
        revision: number;
        views: View[];
      }>("views/catalog", { revision });
      if (!current()) return;
      if (catalog.revision !== revision)
        throw new Error("Stale catalog revision");
      if (!catalog.views.some((v) => v.key === this.selectedView))
        this.selectedView = catalog.views[0]?.key ?? "";
      context = this.contextKey();
      this.canvas.views(catalog.views, this.selectedView);
      if (!this.selectedView || !current()) return;
      const viewKey = this.selectedView;
      this.canvas.requestView(viewKey);
      if (this.canvas.rendering) {
        const rendering = await this.host.request<RenderingResolution>("views/rendering", { revision, viewKey });
        if (!current()) return;
        validateRenderingResolution(rendering);
        if (rendering.revision !== revision || rendering.viewKey !== viewKey) throw Error("Stale rendering response");
        this.canvas.rendering(rendering);
        if (rendering.status === "unsupported") throw Error(rendering.diagnostics.map(d=>d.message).join("\n"));
      }
      const response = await this.host.request<SceneResponse>("views/scene", {
        revision,
        viewKey,
        scope: this.explorations.get(viewKey)?.scope,
        palette: this.palette,
      });
      if (!current()) return;
      validateSceneResponse(response);
      if (
        response.scene.revision !== revision ||
        response.scene.view.key !== viewKey
      )
        throw new Error("Stale scene response");
      this.canvas.setScene(response);
    } catch (error) {
      if (current()) {
        this.canvas.setStale();
        this.canvas.status(String(error));
      }
    }
  }
  async cursor(uri: string, line: number, character: number): Promise<void> {
    const seq = ++this.cursorSequence,
      revision = this.buffers.revision(),
      context = this.contextKey();
    if (!this.current(revision)) return;
    const found = await this.host
      .request<{
        elementId: string;
      } | null>("views/locate", { revision, uri, position: { line, character } })
      .catch((error) => {
        if (
          seq !== this.cursorSequence ||
          !this.current(revision) ||
          context !== this.contextKey()
        )
          return null;
        throw error;
      });
    if (
      seq === this.cursorSequence &&
      this.current(revision) &&
      context === this.contextKey()
    )
      this.canvas.highlight(found?.elementId ?? null);
  }
  async laneTargets(
    toolId: string,
    step: string,
    lane: string,
    before: string | null,
    end: string | null,
  ): Promise<LaneTargetResponse | null> {
    const revision = this.buffers.revision(),
      seq = ++this.targetSequence,
      context = this.contextKey(),
      viewKey = this.selectedView,
      scope = this.explorations.get(viewKey)?.scope,
      scopeKey = JSON.stringify(scope),
      paletteKey = JSON.stringify(this.palette);
    if (!this.current(revision)) return null;
    const response = await this.host
      .request<LaneTargetResponse>("views/laneTargets", {
        revision,
        viewKey,
        toolId,
        step,
        lane,
        before,
        end,
        scope,
        palette: this.palette,
      })
      .catch((error) => {
        if (
          context !== this.contextKey() ||
          seq !== this.targetSequence ||
          !this.current(revision)
        )
          return undefined;
        throw error;
      });
    if (
      context !== this.contextKey() ||
      seq !== this.targetSequence ||
      !this.current(revision) ||
      viewKey !== this.selectedView ||
      scopeKey !== JSON.stringify(this.explorations.get(viewKey)?.scope) ||
      paletteKey !== JSON.stringify(this.palette)
    )
      return null;
    validateLaneTargets(response);
    if (
      response.revision !== revision ||
      response.viewKey !== viewKey ||
      response.toolId !== toolId ||
      response.step !== step ||
      response.lane !== lane ||
      response.before !== before ||
      response.end !== end
    )
      throw Error("Invalid lane target response echo");
    return response;
  }
  async gridTargets(
    toolId: string,
    row: string,
    column: string,
    member?: string,
  ): Promise<GridTargetResponse | null> {
    const revision = this.buffers.revision(),
      seq = ++this.targetSequence,
      context = this.contextKey(),
      viewKey = this.selectedView,
      scope = this.explorations.get(viewKey)?.scope,
      scopeKey = JSON.stringify(scope);
    if (!this.current(revision)) return null;
    const response = await this.host
      .request<GridTargetResponse>("views/gridTargets", {
        revision,
        viewKey,
        toolId,
        row,
        column,
        member,
        scope,
        palette: this.palette,
      })
      .catch((error) => {
        if (
          context !== this.contextKey() ||
          seq !== this.targetSequence ||
          !this.current(revision)
        )
          return undefined;
        throw error;
      });
    if (
      context !== this.contextKey() ||
      seq !== this.targetSequence ||
      !this.current(revision) ||
      viewKey !== this.selectedView ||
      scopeKey !== JSON.stringify(this.explorations.get(viewKey)?.scope)
    )
      return null;
    validateGridTargets(response);
    if (
      response.revision !== revision ||
      response.viewKey !== viewKey ||
      response.toolId !== toolId ||
      response.row !== row ||
      response.column !== column ||
      response.member !== (member ?? null)
    )
      throw new Error("Invalid grid target response");
    return response;
  }
  async labelTargets(
    toolId: string,
    part: string,
  ): Promise<LabelTargetResponse | null> {
    const revision = this.buffers.revision(),
      seq = ++this.targetSequence,
      context = this.contextKey(),
      viewKey = this.selectedView,
      scope = this.explorations.get(viewKey)?.scope,
      scopeKey = JSON.stringify(scope);
    if (!this.current(revision)) return null;
    const response = await this.host
      .request<LabelTargetResponse>("views/labelTargets", {
        revision,
        viewKey,
        toolId,
        part,
        scope,
        palette: this.palette,
      })
      .catch((error) => {
        if (
          context !== this.contextKey() ||
          seq !== this.targetSequence ||
          !this.current(revision)
        )
          return undefined;
        throw error;
      });
    if (
      context !== this.contextKey() ||
      seq !== this.targetSequence ||
      !this.current(revision) ||
      viewKey !== this.selectedView ||
      scopeKey !== JSON.stringify(this.explorations.get(viewKey)?.scope)
    )
      return null;
    validateLabelTargets(response);
    if (
      response.revision !== revision ||
      response.viewKey !== viewKey ||
      response.toolId !== toolId ||
      response.part !== part
    )
      throw new Error("Invalid label target response");
    return response;
  }
  async targets(toolId: string, source?: string): Promise<string[]> {
    const revision = this.buffers.revision(),
      seq = ++this.targetSequence,
      context = this.contextKey(),
      viewKey = this.selectedView;
    if (!this.current(revision)) return [];
    const response = await this.host
      .request<TargetResponse>("views/targets", {
        revision,
        viewKey,
        toolId,
        source,
        scope: this.explorations.get(viewKey)?.scope,
        palette: this.palette,
      })
      .catch((error) => {
        if (
          context !== this.contextKey() ||
          seq !== this.targetSequence ||
          !this.current(revision)
        )
          return undefined;
        throw error;
      });
    if (
      context !== this.contextKey() ||
      seq !== this.targetSequence ||
      !this.current(revision) ||
      viewKey !== this.selectedView
    )
      return [];
    validateTargets(response);
    if (
      response.revision !== revision ||
      response.viewKey !== viewKey ||
      response.toolId !== toolId ||
      response.source !== (source ?? null)
    )
      throw new Error("Invalid target response");
    return response.symbols;
  }
  async command(
    toolId: string,
    ownerKey: string,
    args: Record<string, string>,
  ): Promise<Analysis | undefined> {
    if (this.pending) throw new Error("A diagram edit is already in progress");
    const revision = this.buffers.revision();
    if (!this.current(revision))
      throw new Error("The diagram is stale; analyze source first");
    this.pending = true;
    const context = this.contextKey();
    const checkContext = () => {
      if (context !== this.contextKey())
        throw new Error(
          "View, scope or palette changed while preparing the edit",
        );
    };
    let prepared: PreparedEdit | undefined,
      applied = false;
    const current = () => this.buffers.revision() === revision;
    try {
      const proposal = await this.host.request<PreparedEdit | Rejection>(
        "views/prepareCommand",
        {
          revision,
          viewKey: this.selectedView,
          toolId,
          ownerKey,
          arguments: args,
          palette: this.palette,
          scope: this.explorations.get(this.selectedView)?.scope,
        },
      );
      if ("code" in proposal && "message" in proposal)
        throw new CommandRejection(proposal);
      validatePreparedEdit(proposal);
      prepared = proposal;
      if (prepared.baseRevision !== revision || !current())
        throw new Error("Source changed while preparing the edit");
      checkContext();
      this.buffers.reserveRevision(prepared.nextRevision);
      for (const patch of prepared.patches) {
        const text = this.buffers.read(patch.uri);
        if (text === undefined || (await bufferHash(text)) !== patch.beforeHash)
          throw new Error("Source hash mismatch");
        const start = offset(text, patch.range.start),
          end = offset(text, patch.range.end);
        if (end < start || text.slice(start, end) !== patch.original)
          throw new Error("Prepared source range mismatch");
        if (
          (await bufferHash(
            text.slice(0, start) + patch.replacement + text.slice(end),
          )) !== patch.afterHash
        )
          throw new Error("Prepared result hash mismatch");
      }
      if (!current())
        throw new Error("Source changed before applying the edit");
      checkContext();
      this.buffers.apply(prepared.patches);
      applied = true;
      for (const patch of prepared.patches)
        if (
          (await bufferHash(this.buffers.read(patch.uri) ?? "")) !==
          patch.afterHash
        )
          throw new Error("Applied buffer hash mismatch");
      if (!current()) throw new Error("Source changed while applying the edit");
      const analysis = await this.host.request<Analysis>(
        "views/commitCommand",
        { revision, token: prepared.token, sources: this.buffers.sources() },
      );
      if (!current()) return; // Newer typing owns the buffers. Never undo it.
      if (analysis.revision !== prepared.nextRevision || !analysis.clean)
        throw new Error("Commit returned an invalid candidate revision");
      this.buffers.publish(analysis);
      this.analysis = analysis;
      await this.refresh();
      return analysis;
    } catch (error) {
      let failure = error;
      try {
        if (applied && current()) this.buffers.undo();
      } catch (rollback) {
        this.analysis = undefined;
        this.invalidate();
        failure = new AggregateError(
          [error, rollback],
          "Command and source rollback failed; analyze the buffers before editing",
        );
      }
      if (prepared)
        await this.host
          .request("views/abortCommand", { token: prepared.token })
          .catch(() => {});
      throw failure;
    } finally {
      this.pending = false;
    }
  }
}
