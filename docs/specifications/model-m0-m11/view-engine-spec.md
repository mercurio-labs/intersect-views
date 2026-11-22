# Intersect view engine: implementation specification

Status: **specification for implementation. Nothing here is implemented.**
Background and rationale are in [view-engine-proposal.md](view-engine-proposal.md);
where the two differ, this document governs.

Audience: an implementing agent. Read this whole document, then the files named
under "Verified facts" before writing code. Facts in that section were read
from source on 2026-11-17 but not executed. Re-check each one you depend on.

## 1. Outcome

A new repository, `intersect-views`, that lets any Intersect language define
views as data and have them evaluated, rendered and edited by shared code.

- A language package ships view rule files, Rcore functions, a notation
  profile and (for editing) commands.
- The repository supplies the contracts, the view evaluator, a generic
  language host, the visualization client, and a harness language that tests
  all of it.
- The first consumer is the harness language. SysML moves onto the engine
  later (milestone 10).

## 2. Ground rules

- Follow the workspace `AGENTS.md` and Model's `AGENTS.md`. They apply to the
  new repository unchanged: `develop` as base, dependency direction, no
  `unwrap`/`expect` in library code, deterministic semantic paths,
  `wasm32-unknown-unknown` compatibility for library crates, quick tier under
  10 minutes, evidence for every claim.
- Work locally in `D:\dev\repos\mercurio-labs\intersect-views`. Do **not**
  create a GitHub repository, add a remote or push. Ask the user.
- Do **not** change Model, Text, KerML or Mercurio except where a milestone
  says so. If a milestone needs a change it does not list, stop and report.
- Model keeps its copy of `crates/intersect-views` and
  `packages/visualization` until milestone 10. Existing consumers must keep
  working throughout.
- Each milestone ends with: formatting, clippy with `-D warnings`, quick-tier
  tests through `tools/test_report.py`, the WASM check, `npm run check` and
  `npm test` where TypeScript changed, and a short evidence note under
  `docs/evidence/` listing commands run and their results. Report failures
  with output; do not describe unverified work as done.
- Commit per milestone on a feature branch off `develop`. Do not merge.

## 3. Decisions already made

| Topic | Decision |
| --- | --- |
| Repository | New `intersect-views`, above Model and Text |
| Dependency direction | application -> language package -> `intersect-views` -> Text -> Model |
| Queries | Rcore functions and Model's `QueryPlan`. No new query language |
| Rule format | Versioned JSON, `deny_unknown_fields`, no executable content |
| Rendering | Client-side, in `packages/visualization` in the new repository |
| First language | A purpose-built harness language, not SysML |
| Edit commands | Language-owned Rust. No generic grammar-driven commands in this plan |
| Views for non-SysML languages | View documents (`*.view.json`) in the project; model-defined views arrive with SysML |
| Scope state | The client holds it and sends it with each scene request; the host is stateless about scope |
| Contract version | Scene contract goes to version 2 in the new repository; Model's copy stays at 1 |

Out of scope for this plan: SysML Geometry view, models spanning several
languages, durable identity across rename and move, a text syntax for rule
files, notation conformance claims, and a multi-language registry in Mercurio.

## 4. Verified facts

Paths are relative to `D:\dev\repos\mercurio-labs`.

### 4.1 Source text to a frozen model, for any language

- No single function does it. It is a composition of public APIs, proven
  language-neutral by `intersect-text/crates/intersect-text/tests/frozen_text_catalog.rs`
  (fixtures in `intersect-text/fixtures/frozen-text-catalog/`).
- Steps: build a `BundleCompilation` (metamodel, `Terminals.xtext`, grammar,
  stub Rcore behaviour) -> `migrate_ecore_bundle` -> `migration::remap_compilation`
  -> `compiler::prepare_bundle_with_borrowed_authored_validation` (profile
  `NativeV80`) -> `GrammarPolicy` -> `OpenDraftCapability` -> `DraftLanguage::bind`
  -> `Metamodel::freeze` -> `FrozenStore::new` -> `parse_runtime_into` per
  source -> compile bindings (`source_scope_bindings`, `source_validate_bindings`,
  `compile_binding_kinds_with_source_limits`) -> `RcoreScopes::new` ->
  `into_builder().link().complete_implicit().complete_defaults().validate()`
  -> `Model::check`.
- `intersect-lang-examples/support/src/lib.rs` wraps this as
  `load(&Language, &[Source])`. It is pinned to the old monorepo and treats
  parse diagnostics as hard errors, so use it as a pattern, not a dependency.
  The smallest example on this path is `languages/petri` (Rcore metamodel,
  Xtext grammar, bindings with `bind scope` and `bind validate`, 29 lines of
  Rust).
- `load_frozen`, `FrozenLoad`, `LoadDiagnostic` and `LoadPhase` in
  `.worktrees/kerml-general-view/crates/intersect-kerml/src/frozen_load.rs`
  (lines 201-707) are language-neutral but live in the KerML crate. They need
  `StoredEvaluation.unresolved_references`, present in Text at revision
  `3d02630` (on `origin/develop`) and later, not on Text's local `main`.

### 4.2 Calling Rcore over a frozen model

- `intersect_model::source_model_functions::SourceModelFunction`
  (`intersect-model/crates/intersect-model/src/source_model_functions.rs`):
  `from_prepared(definition, additional, selection, verification, limits, source_limits)`
  and `invoke_model(&dyn ModelRead, owner: &str, arguments: Vec<DataWire>, budget: &mut QueryBudget) -> Result<ValueWire, String>`.
- Signature limits: the first parameter must be a model type; other
  parameters must be scalar or optional scalar. A function cannot take a
  collection of elements.
- Results are `ValueWire`/`DataWire`. A model result is
  `DataWire::Model(json)` with `"element": <identity>`; map it back with
  `Model::lookup(identity)`.
- `core::frozen::Model` does not implement `ModelRead`. `FrozenStore` does,
  and `FrozenStore::from_model(model)` consumes the model, so clone first.
- **Not verified by any test:** `invoke_model` over a store built from a
  frozen model. Milestone 0 proves or disproves it.
- `EntrySelection.symbol.declaration` is an ordinal in the parsed source. How
  to resolve a function name to that ordinal was not established. See
  `fixtures/rcore-model-rule-service/read_function.rs`.
- `Model::check(&dyn Validators)` runs `bind validate` rules over a frozen
  model and returns issues with severity, code, message, feature and rule.

### 4.3 The KerML host

`.worktrees/kerml-general-view/crates/intersect-kerml-ide/src/lib.rs`:

- `Host::dispatch(&mut self, request: Value) -> Result<Value, String>` matches
  `request["method"]` (line 285). Methods: `initialize`, `textDocument/*`,
  `workspace/analyze`, `views/catalog|scene|locate|prepareCommand|commitCommand|abortCommand`,
  `intersect/inspect`, `intersect/source`, `evaluation/*`, `shutdown`.
- Language-neutral as written: the analyze flow (limits, load, diagnostics,
  clean gate, publish), `check_revision`, UTF-16 position conversion,
  `intersect/inspect`, `intersect/source`, and the whole prepare/commit/abort
  transaction (lines 588-690) apart from patch generation.
- SysML-specific: pack loading, `load_sources` via `with_sysml_host`, KPAR
  resolution, `name()` hard-coding `declaredName`/`declaredShortName`, and all
  of `views.rs`, `editing.rs`, `completion.rs`, `evaluation.rs`.

### 4.4 The client

`intersect-model/packages/visualization` at revision `4c782ec`:

- `canvas.ts` (1019 lines) exports `DiagramCanvas(root, callbacks)`. SVG built
  from strings; ELK `layered` layout in `layout.worker.ts`; edges are
  recomputed orthogonal paths.
- Notation is code: `defaultNotation` in `protocol.ts` (lines 149-163). Only
  `fill` and `radius` are read. No profile can be injected.
- `validation.ts` validates scenes with the same limits as the Rust contract.
- The only tests are `tests/protocol.test.ts` (43 lines). No canvas tests.
- The npm package is the repository root `package.json`
  (`@intersect/visualization`), scripts `check` and `test` (`node:test`).
- Mercurio's `apps/workbench/web/src/diagrams.ts` holds the client transaction
  (lines 198-306), scene refresh guards (160-197) and cursor sync (136-153).
  These are application-independent once Monaco access is behind an interface.
- The WASM host interface is four exports: `input_buffer`, `execute`,
  `load_pack`, `output_buffer` (`mercurio/apps/workbench/crates/mercurio-host/src/lib.rs`).

### 4.5 SysML standard views

`StandardViewDefinitions.sysml` defines `GeneralView`, `InterconnectionView`,
`ActionFlowView` and `StateTransitionView` (both specialize
`InterconnectionView`), `SequenceView`, `GeometryView`, `GridView` and
`BrowserView`.

## 5. Repository layout

```
intersect-views/
  AGENTS.md  README.md  LICENSE  Cargo.toml  package.json
  crates/
    intersect-views/         wire contracts (copied from Model)
    intersect-view-engine/   rule format and evaluator
    intersect-view-host/     generic host, protocol, transaction
  packages/
    visualization/           client (copied from Model), session
  harness/
    Cargo.toml               crate intersect-view-harness, publish = false
    language/                metamodel, grammar, bindings, view functions
    views/                   *.viewrules.json, harness.notation.json, palettes
    models/                  *.harness sources, *.view.json documents
    src/  tests/all.rs
    web/                     demo page and browser tests (milestone 5)
  docs/  docs/evidence/  tools/test_report.py
```

- `AGENTS.md`: copy Model's, then add the rules in section 2 and: "engine and
  host crates may depend on the harness only under `[dev-dependencies]`".
- `tools/test_report.py`: copy from Model.
- Cargo workspace: edition 2024, rust-version 1.88, `publish = false`, the
  `test-fast` profile from Model's `Cargo.toml`.
- Pin Model and Text by exact Git revision, following the
  `[patch.crates-io]` pattern in `.worktrees/kerml-general-view/Cargo.toml`
  (lines 44-47). Text must be `3d02630` or later; Model must be the revision
  that Text pins. Record both in `README.md`.
- Each crate: `autotests = false`, one `[[test]] name = "all"`, integration
  tests as modules of that binary, a `milestone-tests` feature.

## 6. Design

### 6.1 Pipeline

```
scene = evaluate(rule set, scope, model revision)
```

The host builds the model, the engine evaluates rules by calling Rcore
functions, the client lays out and draws. The engine emits no geometry and no
graphics.

### 6.2 View functions

A language supplies one or more Rcore behaviour sources of `pub fn`
declarations. Rules refer to functions by name.

| Use | Signature |
| --- | --- |
| Select related elements | `(self: T) -> Sequence<U>` |
| Condition | `(self: T) -> Bool` |
| Label, style class | `(self: T) -> String` |

Constraints, from section 4.2:

- The first parameter is the element. No function takes a set of elements.
  The engine iterates; functions stay per-element.
- A rule's `match` class must conform to the function's parameter type. The
  engine checks this at load and reports the rule and function on mismatch.
- A function that constructs must be rejected. Confirm the effect check
  covers this in milestone 0.

### 6.3 Engine interfaces

The engine does not depend on Rcore or the frozen model directly. The host
adapts both. This keeps the engine testable with in-memory fakes.

```rust
pub trait ViewModel {
    fn element(&self, key: &str) -> Option<ElementId>;
    fn key(&self, element: ElementId) -> Result<String, EngineError>;
    fn is_a(&self, element: ElementId, class: &str) -> Result<bool, EngineError>;
    fn binding(&self, element: ElementId, context: &[String]) -> Result<Binding, EngineError>;
}
pub trait ViewFunctions {
    fn elements(&self, name: &str, element: ElementId) -> Result<Vec<ElementId>, EngineError>;
    fn boolean(&self, name: &str, element: ElementId) -> Result<bool, EngineError>;
    fn string(&self, name: &str, element: ElementId) -> Result<String, EngineError>;
}
pub fn evaluate(
    rules: &RuleSet, scope: &Scope, view: View, palette: Palette, revision: u64,
    model: &dyn ViewModel, functions: &dyn ViewFunctions, limits: EngineLimits,
) -> Result<Scene, EngineError>;
```

`ElementId` is an opaque copyable handle. `EngineLimits` defaults: 500 nodes,
1000 ports, 2000 edges, 5000 rows, depth 16 (matching `SceneLimits`), and
2,000,000 function-call work units. Exceeding a limit is an error naming the
limit, never a truncated scene.

### 6.4 Rule set format, version 1

File name `*.viewrules.json`. All objects reject unknown fields.

```json
{
  "schemaVersion": 1,
  "id": "harness.structure",
  "label": "Structure",
  "language": "urn:intersect:harness:1",
  "form": "graph",
  "layout": { "strategy": "layered", "direction": "RIGHT" },
  "symbols": [
    {
      "id": "box", "match": "Box", "emit": "node", "notation": "box",
      "title": "boxTitle", "subtitle": "boxKind", "styleClass": "boxStyle",
      "compartments": [{ "label": "fields", "rows": "boxFields", "rowLabel": "fieldLabel" }],
      "ports": { "select": "boxPins", "rule": "pin" },
      "children": { "select": "boxParts" },
      "expand": [{ "id": "linked", "label": "Linked boxes", "select": "linkedBoxes" }]
    },
    { "id": "pin", "match": "Pin", "emit": "port", "label": "pinLabel", "side": "pinSide" }
  ],
  "edges": [
    {
      "id": "link", "kind": "element", "per": "box", "select": "boxLinks",
      "notation": "link", "label": "linkLabel",
      "sourcePath": "linkSourcePath", "targetPath": "linkTargetPath", "anchor": "owner"
    },
    {
      "id": "kind", "kind": "reference", "per": "box", "targets": "boxKindRef",
      "notation": "typing", "label": { "text": "kind" }, "anchor": "root"
    }
  ]
}
```

- A string in a label slot (`title`, `subtitle`, `label`, `rowLabel`,
  `styleClass`, `side`) is a function name. `{ "text": "..." }` is a constant.
- `form`: only `"graph"` is accepted until milestones 7 and 9.
- `layout.direction`: `RIGHT`, `LEFT`, `UP`, `DOWN`. `side` must evaluate to
  `NORTH`, `SOUTH`, `WEST` or `EAST`.
- Rule IDs are unique across symbols and edges. Rule precedence when several
  symbol rules match one element: the most specific `match` class wins, then
  file order. Report an ambiguity as a load error if two rules name the same
  class.
- Validation at load: structural checks, every class resolves in the
  metamodel, every function exists with a compatible signature. Unknown names
  are errors.

### 6.5 Evaluation, graph form

1. **Visible roots.** Apply the scope (6.6) to get an ordered, de-duplicated
   list of root elements.
2. **Nodes.** For each root with a matching node rule, emit a node with empty
   context.
3. **Occurrence context.** A context is the list of element keys of the
   enclosing node occurrences, outermost first. For a node at context `c` for
   element `e`, its children, ports and rows are evaluated at context
   `c + [key(e)]`. `children.select` is called on `e`; each result is rendered
   by its matching node rule one level deeper. The same element under two
   parents yields two symbols with different IDs and the same binding key.
4. **Symbol IDs.** `"symbol:" + sha256(viewKey ":" ruleId ":" elementKey ":" context ":" role)`,
   where role is `node`, `port`, `row` or `edge`.
5. **Endpoint index.** Record `(context, element) -> symbol ID` for every node
   and port.
6. **Element edges.** For each occurrence of the `per` rule, call `select` on
   its element to get edge elements. For each, `sourcePath` and `targetPath`
   return an ordered list of elements leading to the endpoint. Resolve a path
   by starting at the anchor context (`owner`: the occurrence's own child
   context; `root`: the empty context) and descending one context level per
   path element except the last, then looking up the last element in the
   endpoint index. De-duplicate by (edge element, anchor context).
7. **Reference edges.** For each occurrence of the `per` rule, `targets`
   returns elements; emit an edge from the occurrence to each target that is
   visible at the anchor context. The binding is the source element.
8. **Unresolved endpoints** add a scene problem naming the edge and omit it.
   They are not errors.
9. **Order.** Output order follows root order, then function result order.
   The same inputs always give byte-identical scenes.
10. Validate the scene before returning it.

### 6.6 Scope, version 1

```json
{ "schemaVersion": 1, "ops": [
  { "op": "addSeed", "element": "<element key>" },
  { "op": "expand", "element": "<element key>", "relation": "linked", "hops": 1 },
  { "op": "hide", "element": "<element key>" },
  { "op": "collapse", "element": "<element key>", "context": ["<key>"] },
  { "op": "removeSeed", "element": "<element key>" }
] }
```

- Ops apply in order. `addSeed` appends a root. `expand` calls the named
  `expand` relation of the element's node rule up to `hops` times (1 to 8)
  and appends the results as roots. `hide` removes an element from the roots.
  `collapse` suppresses children, ports and owned edges of one occurrence.
  `removeSeed` undoes an `addSeed`.
- An op naming an element key that no longer exists is skipped and reported
  as a scene problem.
- At most 4096 ops.

### 6.7 View documents

A view is a project document, `*.view.json`:

```json
{ "schemaVersion": 1, "key": "structure-1", "name": "Structure",
  "ruleSet": "harness.structure", "scope": { "schemaVersion": 1, "ops": [] } }
```

- The catalog lists every valid view document in the project.
- The client may request a scene with a scope that differs from the saved
  one (unsaved exploration). Saving writes the document through the
  application, like the layout sidecar.
- An exploration is a view document that has not been saved.

### 6.8 Scene contract, version 2

In the new repository's `intersect-views` crate, set `VERSION = 2` and add:

| Type | Added field | Meaning |
| --- | --- | --- |
| `Scene` | `form: String` | `"graph"` for now |
| `Scene` | `rule_set: String` | Rule set ID |
| `Node`, `Port`, `Edge` | `rule: String` | Emitting rule ID |
| `Node`, `Edge` | `style_class: String` | Empty when none |
| `Node` | `expand: Vec<ExpandOption { id, label }>` | Relations offered |
| `Node` | `collapsed: bool` | Collapsed by scope |
| `LayoutHints` | `strategy: String` | `"layered"` for now |

Add Rust types for `ViewDocument`, `Scope`, `ScopeOp` and `Presentation` (the
layout sidecar has no Rust type today). Mirror every change in
`protocol.ts` and `validation.ts`. Add `scene-v2.json` and
`scene-v2-rejections.json` shared fixtures, plus shared accepted/rejected
fixtures for view documents, scopes, rule sets and presentations. Both
languages must consume the same files.

### 6.9 Generic host

`intersect-view-host` is parameterised by a language definition:

```rust
pub struct LanguageDefinition {
    pub id: String,                  // "harness"
    pub name: String,
    pub namespace: String,
    pub file_extensions: Vec<String>,
    pub structure: DefinitionSource, // Rcore or Ecore metamodel
    pub grammar: DefinitionSource,
    pub bindings: DefinitionSource,  // bind scope / bind validate
    pub view_functions: Vec<DefinitionSource>,
    pub rule_sets: Vec<String>,      // JSON text
    pub notation: String,            // JSON text
    pub palette: String,             // default palette JSON
    pub name_features: Vec<String>,  // e.g. ["name"]
}
pub trait Commands {
    fn supports(&self, command: &str) -> bool;
    fn prepare(&self, context: &CommandContext<'_>, command: &PrepareCommand)
        -> Result<Vec<SourcePatch>, CommandError>;
}
pub struct Host { /* ... */ }
impl Host {
    pub fn new(language: LanguageDefinition, commands: Box<dyn Commands>) -> Result<Self, String>;
    pub fn dispatch(&mut self, request: serde_json::Value) -> Result<serde_json::Value, String>;
}
```

- **Loading.** Implement the section 4.1 pipeline once, at `Host::new` for
  the language and per analyze for sources. Port `load_frozen` and its types
  from the KerML crate with a provenance note; parse diagnostics are
  diagnostics, not hard errors. No pack and no standard library.
- **Functions.** At `Host::new`, compile each view function referenced by any
  rule set into a `SourceModelFunction` and cache it by name. Per accepted
  revision, build one `FrozenStore::from_model(model.clone())` and reuse it
  for all calls in that revision.
- **Element keys.** Port the scheme in KerML `views.rs` (`path`, `key`,
  `catalog`, the anonymous form in `Projection::binding`), replacing
  `declaredName` with `name_features`. Ambiguous named paths are an error.
- **Protocol.** Keep the existing method names and payload shapes from the
  KerML host for `initialize`, `workspace/analyze`, `views/catalog`,
  `views/scene`, `views/locate`, `views/prepareCommand`,
  `views/commitCommand`, `views/abortCommand`, `intersect/inspect`,
  `intersect/source` and `shutdown`. Changes:
  - `initialize` returns `protocolVersion: 1` and the language `id`, `name`
    and `fileExtensions`.
  - `workspace/analyze` has no `descriptor` or `archives`. Sources whose
    extension is not a language extension are project documents (view
    documents, palettes) and are not parsed as model text.
  - `views/scene` takes `{ revision, viewKey, scope?, palette? }`. An absent
    `scope` means the saved one.
  - New `views/ruleSets` returns the rule set IDs and labels, and
    `views/notation` returns the notation profile.
  - `textDocument/*` and `evaluation/*` are not implemented; return the
    existing "Unsupported language method" error.
- **Transaction.** Port lines 588-690 of the KerML host unchanged in
  behaviour: clean baseline required, candidate re-analysis of all sources,
  token `edit:<revision>:<n>`, exact buffer receipt on commit, atomic publish,
  token-scoped abort, one pending command. The `Commands` implementation
  replaces `views::prepare_patch`. Check every patch URI against the editable
  set in the host, not only in the command.
- **Rejections.** A failed prepare returns `{ code, message, feature?, elementKey? }`.
  Candidate validation issues map from `Issue` fields directly.
- **Helpers.** Provide `insert_member(source, owner_span, declaration)` ported
  from the patch-anchoring code in KerML `views.rs` (lines 967-1017). Document
  that it assumes bodies end in `}` or `;`.
- **WASM.** Provide a macro or generic function that exposes a `Host` through
  the four-export interface in section 4.4, with `load_pack` omitted.

### 6.10 Harness language

A test fixture, not a user language. Model it on
`intersect-lang-examples/languages/petri`. Namespace
`urn:intersect:harness:1`, file extension `.harness`.

| Class | Features | Purpose |
| --- | --- | --- |
| `Element` (abstract) | `name: String` | Base for all rules |
| `Space` | contains `kinds: Kind*`, `boxes: Box*` | Root |
| `Kind` | contains `parts: Box*`, `pins: Pin*`, `fields: Field*`, `links: Link*` | A type that boxes use |
| `Box` | ref `kind: Kind?`; contains `parts`, `pins`, `fields`, `links` as `Kind` | Nodes, nesting, occurrence contexts |
| `Pin` | `direction: in or out` | Ports and port side |
| `Field` | `value: Int` | Rows, style classes |
| `Link` | contains `source: End`, `target: End` | Edges, connect command |
| `End` | ref `part: Box?`, ref `pin: Pin?` | An endpoint inside the owner |

- A box's effective parts, pins, fields and links are its own plus its
  kind's. That is what puts one element in several contexts.
- Validation rules (`bind validate`), each with a distinct code: a link's
  ends must differ; an end must name a part or a pin; an end's pin must
  belong to its part (or to the owner when no part is named); names are
  unique within an owner.
- **Design risk.** Resolving `End.pin` depends on `End.part`. Whether the
  linker can resolve one reference using another on the same object is not
  established. If it cannot, give `End` a single reference to a `Pin` plus a
  validation rule, and make pin names unique per owner in the fixtures.
  Record which form was used and why.
- View functions cover every slot in the section 6.4 example.
- Commands in Rust: `harness.createBox`, `harness.createPin`,
  `harness.createLink`. Later milestones add constructs (see milestones 7-9).

## 7. Milestones

Each milestone lists what to build and what must be true to call it done.

### M0. Feasibility

Create the repository skeleton (section 5) with only the harness crate and a
minimal three-class harness (`Space`, `Box`, `Field`).

- Load harness source to a frozen model with the section 4.1 pipeline.
- Call three view functions (element to sequence, to Bool, to String) with
  `SourceModelFunction::invoke_model` over a store built from the frozen model.
- Establish how a function name maps to `EntrySelection`.
- Confirm a function containing `new` is refused.
- Measure, in the `test-fast` profile: time to clone a 500-object model into a
  store, and time for 5,000 function calls. Record the numbers.

Done when the tests pass and `docs/evidence/m0.md` records the API calls
used, the revisions pinned and the timings. **If `invoke_model` cannot run
over a frozen model, or 5,000 calls take more than two seconds, stop and
report.** The likely fix is a borrowing `ModelRead` for the frozen model in
Model, which needs the user's go-ahead.

### M1. Contracts, client and harness language

- Copy `crates/intersect-views` and `packages/visualization` from Model
  revision `4c782ec` unchanged; add `PROVENANCE.json` for each. Existing tests
  pass in the new location.
- Apply the version 2 contract changes and fixtures (section 6.8). The client
  renders version 2 scenes; new fields may be ignored by the canvas for now.
- Complete the harness language (section 6.10): metamodel, grammar,
  bindings, validation, sample models including one invalid model per rule.

Done when Rust and TypeScript both pass on the shared fixtures, and harness
tests assert resolved references and one located issue per invalid model.

### M2. Generic host, read-only

- `intersect-view-host` with loading, `initialize`, `workspace/analyze`,
  `intersect/inspect`, `intersect/source`, revision checks and element keys.

Done when harness tests drive the host only through `dispatch` and cover:
clean analysis, parse and validation diagnostics with UTF-16 ranges, stale
revision rejection, limits (256 sources, 8 MiB), duplicate URIs, and key
stability across an unrelated insertion. `cargo check --target wasm32-unknown-unknown`
passes for the host.

### M3. Engine and graph scenes

- `intersect-view-engine`: rule set types and validation, evaluation per
  section 6.5, limits.
- Host: `views/ruleSets`, `views/catalog` from view documents, `views/scene`.

Done when:

- Engine unit tests use in-memory fakes and cover every step of 6.5,
  including rule precedence, each limit, unresolved endpoints and
  deterministic output (evaluate twice, compare bytes).
- A harness test has two boxes of one kind whose kind has a part with a pin
  and a link. The scene has two occurrences of the part with different symbol
  IDs and the same binding key, and each link resolves within its own
  occurrence.
- Scenes pass both Rust and TypeScript validation.

### M4. Scope and exploration

- Scope evaluation (section 6.6), `scope` on `views/scene`, expand options
  and `collapsed` on nodes.
- Client: a tree-drop or API entry point that adds a seed; an expand menu on
  nodes; hide and collapse. These change the scope and re-request the scene;
  they never edit source.

Done when tests cover each op, op order, missing elements, the op limit and
an exploration that is saved as a view document and reloaded to the same
scene.

### M5. Client session, notation and browser tests

- `packages/visualization/src/session.ts`: a `ViewSession` that owns scene
  refresh guards, cursor-to-diagram sync and the prepare/apply/commit/rollback
  transaction, ported from Mercurio's `diagrams.ts`. It takes two injected
  interfaces: a host client (`request(method, params)`) and a buffer adapter
  (read text, apply patches as one undo group, undo, current revision,
  reserve revision). No Monaco, file or Tauri reference.
- Notation profile as data: `DiagramCanvas` accepts a profile; node `shape`,
  `fill`, `stroke`, `radius`; edge line style and end markers; palette icons;
  `styleClass` selects overrides. JSON Schema and shared fixtures. Keep
  `defaultNotation` as the fallback.
- `harness/web`: a Vite page running the harness host as WASM with the client
  and a plain text area per source. Playwright tests.

Done when session unit tests (fake host, fake buffers) cover success, stale
revision, hash mismatch, failed commit with rollback, and typing during a
commit; and browser tests cover render, select, move, expand, hide, and a
custom notation profile changing a shape.

### M6. Editing and legality

- Host: `views/prepareCommand`, `views/commitCommand`, `views/abortCommand`;
  structured rejections.
- Harness commands for box, pin and link.
- Rule fields: on a node rule, `create: [{ tool, command, accepts }]`; on an
  edge rule, `connect: { command, sourceAccepts, targetAccepts }`. `accepts`
  values are Bool function names evaluated on the candidate owner or endpoint.
- New `views/targets { revision, viewKey, scope?, toolId, source? }` returns
  the symbol IDs that pass. The client highlights them while a tool is armed
  and during a connection drag.
- A default palette derived from the rules when the language supplies none.

Done when host tests cover each command, candidate isolation (a rejected
edit changes nothing), exact receipts, stale tokens, source undo, and each
harness validation rule surfacing as a structured rejection; and browser
tests cover place, connect, highlighted targets and a rejected drop.

### M7. Grid form

Write the grid section of this specification first (contract types, rule
fields, client behaviour) and get it reviewed before coding. Constraints:
tables use Model's `QueryPlan` for rows and columns; a matrix has a row
select, a column select and a cell function from a row element to related
column elements; cells carry bindings; only non-empty cells are transmitted;
cell create and delete go through commands. Add `Trace` to the harness.

### M8. Graph additions

Regions (a container split into partitions) and structured labels (label
parts with separate bindings). Add `Group` to the harness. Specify before
coding, as for M7.

### M9. Lane graph form

Lane, order and span constraints; a declared semantic axis whose drags are
routed to commands. Add `Step` and `Lane` to the harness. Specify before
coding. This changes the interaction model, so it needs explicit review.

### M10. SysML on the engine

In the KerML repository, on a feature branch:

- Choose one semantic navigation layer for views and expose what the rules
  need as Rcore-callable functions.
- Express the General and Interconnection views as rule sets, with
  model-defined views (a language adapter that lists `ViewUsage` elements
  and derives their rule set and seeds from `expose`).
- Replace the KerML copy of `load_frozen` and the transaction host with the
  generic ones.
- Repoint KerML and Mercurio from Model's `intersect-views` and client to the
  new repository. Then remove both from Model.

Done when the existing KerML view fixtures and Mercurio's `diagrams` and
`general-view` browser tests pass, and a redefined feature renders instead of
failing. This milestone needs the user's go-ahead before it starts, because
it changes three other repositories.

### M11. A second user language

A small real language (for example FMEA) built only from the harness
template, and a recorded decision on models spanning languages.

## 8. Commands

Rust, per changed crate:

```sh
cargo fmt --all --check
cargo clippy -p <crate> --all-targets --locked -- -D warnings
python -B tools/test_report.py run -- --profile test-fast -p <crate> --lib --tests --locked
cargo check -p <crate> --lib --target wasm32-unknown-unknown --locked
```

TypeScript:

```sh
npm ci
npm run check
npm test
```

## 9. Risks to report early

| Risk | Where it shows | Action |
| --- | --- | --- |
| Rcore cannot be called over a frozen model, or is too slow | M0 | Stop; propose a Model change |
| Function name to `EntrySelection` has no public route | M0 | Stop; report what is missing |
| Linker cannot resolve `End.pin` from `End.part` | M1 | Use the fallback in 6.10 |
| Text revision with `unresolved_references` conflicts with the Model pin | M0 | Report the revisions tried |
| Context-path evaluation does not fit a case found while writing rules | M3 | Report the case before changing 6.5 |
| Client canvas cannot take notation data without a rewrite | M5 | Report scope before rewriting |

## 10. What "done" means for the plan

- M0 to M6 give a working, tested engine, host and client for graph views of
  the harness language, with exploration and editing.
- M7 to M9 add forms, each specified before it is built.
- M10 and M11 are the first real consumers.

No milestone is a claim about SysML, notation conformance or performance on
real models until its own evidence says so.
