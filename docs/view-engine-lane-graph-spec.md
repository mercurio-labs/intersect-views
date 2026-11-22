# M9 lane graph specification

Status: **approved by the user on 2026-11-17**. Governing requirement:
Model docs/view-engine-spec.md, M9; the proposal supplies the partial-order
and spanning-region background. M8 graph additions remain unchanged.

## 1. Decisions for review

- Add a strict laneGraph form. The semantic axis has a declared horizontal or
  vertical orientation. The other axis consists of ordered lane bands.
- A language supplies per-element Rcore selectors for lanes, steps,
  predecessors and span endpoints. No new expression language or numeric
  VM result adapter is needed. The engine computes stable topological ranks.
- A lane graph has flat steps and optional rectangular spans covering an
  inclusive interval of ranks and one or more contiguous lane bands. No nested
  regions, ports or graph compartments in this first form. A graph or grid
  using the same model remains available independently.
- A semantic drag or span resize is a source command. It never writes a
  semantic coordinate into Presentation. Lane reordering and pan/zoom remain
  presentation operations. Moving a step to another lane is also a command.
- The harness move command deliberately converts the visible container's
  partial order into the requested total chain by rewriting its Steps' after
  clauses. Its form explains this effect before Apply. This is a fixture
  command policy, not generic engine semantics. Cancel changes nothing.
- Keep versions aligned: scene v5 and rules v5 for all forms. Reject v4 scenes/v4 rules
  explicitly; retain their fixtures as historical inputs. Other protocol and
  document versions stay v1, except Presentation v2 described below.
- Keep work local. One M9 commit includes reviewed specification, implementation,
  browser harness and evidence. M10 is separately authorized by the finish-M11
  goal and can progress independently while this review is pending.

The user explicitly approved these decisions and the bounded semantics below,
including source-command semantic drags, before M9 runtime implementation.

## 2. Harness model and text

Space gains contained lanes: Lane* and steps: Step*. Lane extends Element.
Step extends Element with lane: Lane (required reference), after: Step*
(references), end: Step? (reference) and across: Lane* (references).
All references resolve only within the Step's lexical Space, using the same
language navigation/scoping layer as views and providers.

Example syntax:

```text
space Process {
  lane Operator;
  lane Controller;
  step Start in Operator;
  step Activity in Operator after Start end Finish across Controller;
  step Check in Controller after Start;
  step Finish in Operator after Check;
}
```

A Step with end is rendered as a span, including its own lane and the across
lanes. Other Steps are events. after is an optional comma-separated list;
end and across are optional clauses in that fixed order. A Step cannot precede
itself. Names are unique within the Space for each reference target class.
Unknown references are linking diagnostics. Cycles, backward spans, repeated
across lanes and noncontiguous span coverage are explicit errors. Do not silently
expand a span to cover omitted intermediate lanes.

The generic evaluator checks cycles and span validity for every scene. The
language provider additionally checks proposed placements before generating
patches, so invalid edits never publish. Source may analyze cleanly yet fail a
view's constraints; show the error and retain the last accepted scene as stale.
Do not invent a semantic validation result when only scene constraints ran.

## 3. Rule contract

New RuleSet variant with form laneGraph, schemaVersion 5, id/label/language,
and a laneGraph definition. The definition contains exactly:

- container: { match, lanes, steps }. match names a model class; lanes and steps
  are unary Sequence functions on it. Ordered scope seeds identify containers.
- lane: { id, label }. label is the M8 LabelRule, evaluated on each Lane subject.
- step: { id, label, lane, after, end, across }. The selectors are unary Sequence
  functions on a Step. lane returns exactly one Lane; end returns zero or one
  Step; after and across are deduplicated preserving first occurrence. A Step's
  end is distinct from itself. No lane/step may belong to two visible containers.
- axis: { direction: horizontal | vertical, semantic: true }.
- edit: optional { tool, command, accepts }, a unary Bool predicate on the Step.

Container selectors and every nested label/condition/edit function are compiled
and checked at host initialization, even if scope is empty. Selectors' declared
result classes and actual results must conform. Lane/end/across results must
belong to that container. References to non-visible Steps are errors rather than
silently removed ordering constraints. Lane and step keys are distinct.

Scope v1 supports ordered addSeed, hide and removeSeed on containers. expand
and collapse return an unsupported-form error. QueryPlan grids continue to use
native Model queries; lane graph semantics use the existing per-element Rcore
interfaces. The engine never inspects language feature names.

## 4. Scene contract and identities

LaneGraphScene has exactly schemaVersion, form, ruleSet, revision, view, palette,
problems, axis, lanes, steps, spans and order. Common fields have the existing
meaning. axis contains direction and semantic: true. Host emits no geometry.

Lane = { id, rule, label: Label, binding: Binding, container: key }.
Step = { id, rule, label: Label, binding: Binding, lane: laneId,
         rank: integer, unordered: Bool, predecessors: stepId[] }.
Span = { id, step: stepId, end: stepId, lanes: laneId[] }.
order is the complete ordered array of step IDs, equal to contiguous ranks
0..N-1. Spans reference their owning Step, which appears in order once. An event
is a Step without a Span. Every Step belongs to one lane; every span includes
that lane. References are to scene IDs, not display labels or global names.

Lane and Step bindings use the container key as context. IDs hash JSON tuples
["lane-graph", viewKey, ruleSetId, ruleId, role, elementKey, containerKey], with
roles lane/step/span. Spans use the owning Step key. Label parts reuse the M8
hash with slots lane.label and step.label and the same primary context.
IDs do not encode rank, text, dimensions or revision-local element IDs.

The engine processes containers in seed order and selector results in source
order. Kahn topological sorting uses that combined Step order as the stable
ready-set tie break. A node that participates in a ready-set tie is marked
unordered, including unchosen ready nodes. Remaining nodes after the algorithm
indicate a cycle and fail the scene. after means strict precedence, not an
immediate-neighbor assertion. Duplicate arcs do not increase indegree twice.

A span starts at its owner's rank and ends at its end Step's rank, inclusive.
The end rank must be greater. Its lane IDs are canonicalized in current semantic
lane order, and must form a contiguous range. Presentation may reorder bands
only when every span's lane set remains contiguous; refuse an incompatible
reorder with a reason rather than broadening the covered lanes.

Limits: 32 containers, 128 lanes, 500 Steps, 500 spans, 4000 precedence arcs,
4096 scope ops, 20000 label parts, 32 parts per label, 4096 UTF-8 bytes per label,
8 MiB encoded scene, existing 2000000 shared semantic work units. Existing source
and request limits apply. Every limit fails by name. Validators in Rust and
TypeScript enforce references, identities, ranks, acyclicity, bounds, contiguous
span membership, required fields and strict form separation.

## 5. Client layout and interaction

A dedicated LaneCanvas is routed by ViewCanvas beside the existing graph and
grid surfaces; ViewSession remains application independent. Lane labels are
focusable headers; Step labels retain the M8 exact subject selection/reveal
behavior. Literal parts have no binding. Keyboard Space selects, Enter reveals,
Escape cancels. Tab order follows transmitted lane then Step order.

The client measures complete labels. It reserves a header band and equally
spaced rank slots large enough for measured labels. Horizontal means ranks run
left to right and lanes top to bottom; vertical transposes those axes. Empty
lanes remain visible. Overlapping spans use deterministic secondary tracks
within their covered bands; never obscure an event's selection hit area.
Edges for predecessor arcs are drawn from final geometry; no new semantic edge
binding is fabricated. They can be inspected through the owning Step.

LaneCanvas supports pan/zoom, source reveal, lane reorder controls, and drag
previews. Dragging a Step snaps to a rank insertion gap and target lane. Span
start dragging uses that same move intent; its end handle snaps to an existing
later Step. The preview shows proposed lane/rank/span and an explicit Apply /
Cancel form. It does not mutate source or the accepted scene. Keyboard action
forms offer equivalent target lane, insertion gap and span end inputs.

Presentation v2 keeps graph view positions/viewport plus a per-view laneOrder
array and viewport for laneGraph views; use a strict tagged graph/laneGraph union.
Grid focus/scroll remain transient. Old v1 presentation is rejected with a
clear reset/export message; do not reinterpret saved graph geometry as semantic
lane positions. A lane graph stores no Step x/y/width/rank/span values. Axis
geometry always comes from the current scene. Save/reload retains lane band
order and viewport, while source reload determines semantic ranks and spans.

Notation v1 remains data-only. LaneCanvas uses the existing safe box shape style
for events/spans and safe text styling for lane headers. No additional shape
vocabulary, arbitrary CSS, or standard notation conformance is implied.

## 6. Commands and guarded targets

New focused views/laneTargets request fields are revision, viewKey, toolId,
step, lane, before (required nullable Step ID), end (required nullable Step ID),
scope? and palette?. before null means append within the Step’s container; before equal to the selected Step is refused. All target Steps and Lanes must share that container. end null means an event or keeping
no span; non-null names an existing Step. All IDs belong to the recomputed view.
The response echoes those fields (without scope/palette) and enabled/reason.
Unknown/wrong-form/stale IDs are errors. Known but read-only, unsupported or
predicate-refused targets return disabled with a non-empty reason. Hints are
never permissions. Request/response validators are strict.

prepareCommand reserves arguments.step/lane/before/end strings (null encoded as
empty string in existing string arguments). ownerKey equals the Step's primary
binding key. Host recomputes current scene, verifies rule tool/command/action
gesture, exact visible IDs, writable Step and accepts predicate, then passes a
typed LaneCommandTarget containing the Step, container binding, proposed Lane,
before/end and ordered Step bindings to the language provider. Do not route this
through graph creation or fabricate graph Nodes.

The harness supplies harness.placeStep. It verifies all Steps belong to one
Space and all affected source declarations are writable, constructs the intended
order by removing the selected Step and inserting before the target (or at end),
sets its lane and end, checks spans against the resulting order, then rewrites
that Space's after clauses to a total chain. The UI says that this operation
orders all Steps in that Space. It preserves declarations, names, comments,
unrelated members, CRLF and UTF-16 boundaries. One bounded patch per source URI
satisfies the existing transaction implementation. No automatic reparent,
declaration deletion, cascade, or cross-Space order change is allowed.

M6 candidate isolation, structured failures, one pending edit, exact complete
receipt, hash checks, abort scoping and atomic publish are unchanged. Source
undo/redo reanalyzes and recomputes ranks; newer typing owns buffers. Late hints
cannot change a form after step/lane/gap/end/view/scope/revision changes. No
semantic drag saves a Presentation position, including on rejected commands.

## 7. Feasibility gates and acceptance

Before broad UI implementation, execute a native and actual-WASM fixture with
two lanes, unordered Steps, a strict chain and a span. Verify deterministic
ranks and a source command followed by reanalysis; test both orientations in
the browser with exact hit/source selection. If Rcore cannot supply the
selectors or the client cannot implement the constrained layout without
changing this contract, report the failure before choosing a substitute.

Shared Rust/TS accepted/rejected fixtures cover mixed forms, old versions,
unknown fields, duplicate IDs/arcs, missing references, cycles, invalid ranks,
backward/partial lane spans, text/count/encoded bounds and target echoes.
Engine fakes cover stable topological ties, per-element call counts, repeated
containers, scope order, determinism and every finite limit.
Native host tests cover empty-scene signature validation, unsupported effects,
provider checks, wrong owner/tool/IDs, read-only and stale edits, candidate
isolation, receipts, token guards and source undo. Browser tests cover both
orientations, empty lanes, long/Unicode labels, events/spans, reorder/resize
commands, rejected edits, equivalent keyboard forms, source reveal, presentation
save/reload, stale hints, undo/redo and typing guards. Run all M0-M8 regressions;
M0's two-second 5000-call gate remains unchanged and runs without competing
builds or browser tests. Record commands, failures, pins and measured results
under docs/evidence/m9.md. No M9 implementation is complete until these pass.
