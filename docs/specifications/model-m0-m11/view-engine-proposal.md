# Language-neutral view engine (proposal)

> Background and rationale only. The implementable plan is
> [view-engine-spec.md](view-engine-spec.md), which governs where the two
> differ. In particular the specification replaces the slice list below,
> keeps Model's view code in place until SysML has moved, and defines views
> for non-SysML languages as project documents.

Status: **proposal only.** Nothing described here is implemented, imported,
consumed or verified. It records a design direction for discussion. The
existing bounded SysML provider and the `intersect-views` wire contracts are
unchanged by this document.

## Goal

Let any Intersect language define diagrams from data, and let users build them
interactively, with one mechanism in core:

- **Compose**: build a view by dragging model elements onto a canvas.
- **Explore**: start from a few elements and expand along relationships.
- **Author**: create elements and relationships from a palette.
- **Any language**: SysML views, but also for example an FMEA or Requirements
  language that ships its own diagram rules without writing a Rust provider.

## Where we are

| Layer | Today | Language-neutral? |
| --- | --- | --- |
| Scene, binding, palette, source-patch contracts | `crates/intersect-views` | Yes |
| Canvas, layout, gestures | `packages/visualization` | Yes |
| Command transaction (prepare/commit, revisions) | language IDE host | Protocol yes, commands language-owned |
| Model-to-scene projection | handwritten Rust in `intersect-kerml-ide/src/views.rs` | **No** |
| Exploration | not implemented | n/a |

The projection is the gap. It is hard-coded on SysML class names and on two
standard view kinds. A second language would have to write a second provider.

### Integration of the current provider with the language package

Findings from reading the KerML worktree on `codex/general-view-interactions`
(`intersect-kerml-ide/src/views.rs` and `intersect-kerml-eval/src/nav.rs`).
Nothing was run. Re-check against the branch before acting on them.

Well integrated:

- The provider reads the frozen model produced by the language pack's loader.
  There is no second parser or linker.
- It follows stored references the linker resolved, never name search.
- Proposed edits are re-analysed by the same native loader and library.
- Patch anchors come from the shared Text lexer.
- All output goes through `intersect-views` and is validated.

Duplicated. The evaluator crate has a navigation layer (`Nav`) that is
`pub(crate)`, so the provider carries its own, weaker versions:

| Concern | In `views.rs` | In the evaluator's `Nav` |
| --- | --- | --- |
| Supertypes | `generals` reads `Specialization.general` only | `generals` handles typing, redefinition, subsetting, subclassification and conjugation |
| Inherited features | `effective_features` shadows by name and errors on redefinition | `all_features` hides redefined features, with caching |
| Qualified names | `qualified` joins any named ancestor, unescaped | `qualified_name` uses namespaces, short names, inherited names and escaping |
| Element names | The IDE crate's own `name()` | `effective_name`, inherited through redefinition |
| Feature chains | Hand-rolled in connection-end resolution | `chaining_features` |
| Class tests | Class looked up by string on every call | Pre-resolved IDs in `EvalSchema` |

Smaller duplications: new declarations are built with `format!` and a local
quoting rule while `editing.rs` has its own `name_spelling`; the identifier
check is a hand-written ASCII test, not the grammar's rule; the standard view
kind is found by comparing qualified-name strings.

Not integrated: views with filters are rejected although the evaluator has
metadata access and condition checking; viewpoints are listed, not evaluated.

Consequence: KerML has more than one navigation layer. Some semantics are in
Rcore (`intersect-kerml/semantics/*.rcore`), the evaluator's `Nav` is
handwritten Rust, and `views.rs` is a third. The SysML slice below must choose the one
that views use, expose it as Rcore-callable functions (native providers where
the implementation stays in Rust), and move the provider onto it. That removes
the duplication and lifts the redefinition limit.

## Core idea

SysML already has the right shape: `expose` chooses what is in scope, `filter`
narrows it, and a rendering says how to draw it. Generalised:

```
Scene = render(rules, evaluate(scope, model revision))
```

A view is a pure, deterministic function of three inputs. Core supplies the
evaluator. Languages and users supply the data.

### 1. Queries: reuse Rcore and `QueryPlan`

The view engine does **not** define a query language. Model already has two,
and a third would be a second implementation of the same semantics.

- **Rcore behaviour expressions** ([guide](rcore-guide.md)): typed and
  effect-checked. Pure computation, model queries and construction are
  distinct, so a query cannot hide construction. KerML already writes semantics
  in Rcore.
- **`QueryPlan`** (`core/query.rs`): a serialisable plan with a source class,
  filter predicate, selected columns, ordering and limit. It runs under a step
  budget over any model store and takes a language-owned `DerivedValues`
  adapter.

Every query, predicate and label slot in a rule is a reference to an Rcore
function with a checked signature. The scope's seeds are passed as an argument.

| Slot | Signature |
| --- | --- |
| Selection, expansion relation | element (and seeds) to a sequence of elements |
| Match condition, applicability | element to Boolean |
| Label, style class | element to string |
| Order on a semantic axis | element to a sequence of predecessors |

What a rule author needs is already in the Rcore inventory:

| Need | Rcore |
| --- | --- |
| Class test | `asType`, `selectByKind` |
| Follow a reference | Member access |
| Inverse reference | `incoming` |
| Transitive traversal | `closure` |
| Narrowing | `filter`, `exists`, `forAll` |
| Set algebra | `union`, `intersection`, `difference` |
| Containment | `container`, `contents`, `ancestors` |
| Language semantics | A `pub fn`, a `derive`, or an `extern fn` with a native provider |

Tables use `QueryPlan` directly: its source and filter are the row query and
its columns are the column expressions.

Consequences:

- Names are checked by the Rcore type checker against the model declarations,
  not resolved as strings at load.
- Evaluation is bounded by the existing host-set budgets, not by restricting
  the language. Rcore has lambdas and comprehensions.
- The effect checker must reject any view function that constructs.

Not verified, and required before this can be relied on:

- Whether a host can invoke an arbitrary Rcore query function over the frozen
  model. The guide lists frozen-engine bindings for scope, default, implicit
  and validation only. A new view binding kind may be needed.
- `QueryPlan` is flat: one source class and scalar columns. It does not cover
  graph expansion or matrices with derived cells; those use Rcore functions.
- Cost of evaluating Rcore per element for a full scene on every revision.

### 2. Mapping rules

A rule set is the notation for one kind of view. Each rule has a match pattern
and an emit form.

| Emit form | Produces |
| --- | --- |
| node | A top-level or nested shape |
| port | A border symbol on its owner's shape |
| row | A compartment row inside a shape |
| edge (element) | A relationship element, with source and target queries |
| edge (reference) | A stored reference between two visible symbols |

Each rule also carries a notation token, label expressions, layout hints, and
optionally:

- the ID of a language-owned **creation command**, and
- the relations offered for **expand** on symbols it produces.

The palette and the explore menu can then be derived from the rules. Hand-written
`*.palette.json` files remain valid as overrides.

### 3. Scope

The dynamic part. A scope is an ordered log of operations:

- add seed, remove seed
- expand relation R from symbol S by N hops
- hide, collapse, restore

Scope operations are not model edits. They change what the view shows.

## Scene forms

The rules, queries, scope, bindings and command transaction are the same for
every view. What varies is the form of the scene and how the client lays it
out. Four forms are proposed. The current contract has only the first.

| Form | Structure | Layout |
| --- | --- | --- |
| Graph | Nodes, nesting, regions, border ports, compartments, edges | Automatic, with free manual placement |
| Lane graph | Graph plus lane, order and span constraints | Constrained on one or both axes |
| Grid | Row axis, column axis, cells | Tabular |
| Tree | Parent-child rows | Indented outline |

A rule set declares its form and a layout strategy. The contract should be
designed for all four so that none is excluded, and implemented one at a time.

### Target views

The SysML v2 standard view names below are from memory and must be checked
against the specification before any claim is made.

| View | SysML v2 standard view | Form | Needs beyond the basics |
| --- | --- | --- | --- |
| Block definition | General | Graph | Compartments (already in the contract) |
| Requirement diagram | General | Graph | Typed edges for satisfy, verify, derive |
| Internal block | Interconnection | Graph | Nesting and ports (partly working today) |
| Parametric | Interconnection | Graph | Binding edges into nested parameters |
| State machine | State transition | Graph | Regions, pseudo-state tokens, structured transition labels |
| Activity | Action flow | Graph or lane graph | Control-node tokens, pins as ports, optional swimlanes |
| Sequence | Sequence | Lane graph | Semantic time axis, spans for fragments |
| Table | Grid | Grid | Row query, column expressions |
| Matrix | Grid | Grid | Row query, column query, cell relation |
| Containment browser | Browser | Tree | Nothing new |
| Exploration | None | Any, usually graph | Scope operations only |

Non-SysML languages pick a form, write rules and ship a notation profile.
Fault trees, cause-effect chains and network topologies are graph or tree.
Risk matrices and traceability matrices are grid. A timeline is a lane graph.

The SysML v2 Geometry view (spatial rendering) is out of scope.

### Graph additions

- **Regions**: a container split into parallel partitions, for orthogonal state
  regions and activity partitions.
- **Structured labels**: a label made of separately bound parts, such as
  trigger, guard and effect, so each part is selectable and editable.

### Lane graph

Rules emit three generic constraints alongside symbols:

- `lane`: the symbol belongs to this column or row band.
- `order`: the symbol sits at this rank along the ordered axis.
- `span`: a region covering a range of ranks across one or more lanes, for
  activations and combined fragments.

The rule set declares which axis is **semantic**. Position on a semantic axis
is model content, so a drag along it is routed to a language command, not to
the layout sidecar. In a sequence view, reordering lifelines is presentation
and moving a message past another is a model edit.

The model usually supplies only a partial order, through an Rcore function.
The evaluator produces one stable total order (topological, with source order
as the tie-break). Elements the model leaves unordered are marked as such.

### Grid: tables and matrices

A grid has a row axis, a column axis and cells. Every header and cell carries a
binding, so selection, navigation and editing work as they do for nodes.

| | Table | Matrix |
| --- | --- | --- |
| Row axis | A query | A query |
| Column axis | A fixed list of value expressions | A second query |
| Cell | The expression's value for that row | Result of a cell relation between row and column elements |

Matrix cells:

- The cell relation is an Rcore function from a row element to the related
  column elements. Direct and derived (implied) relationships are distinguished.
- Cell content is a mark, a count or a value. A cell binds to the relationship
  elements behind it, which may be more than one.
- A rule may name a create command and a delete command. Clicking an empty
  cell prepares a relationship between its row and column elements; clearing a
  cell prepares its removal. Derived cells are read-only.

Either axis may be hierarchical (grouped by owner or by a relation), which
reuses the tree structure for headers. Row and column totals are column
expressions over the cell relation.

Grids are bounded like scenes. A matrix has rows times columns cells, so the
contract should carry only non-empty cells plus the two axes, and the client
should draw only what is visible.

### Tree

Rows with a parent relation. Used alone as a browser and as the header
structure of a hierarchical grid axis.

## Notation and formatting

The evaluator never produces graphics. Formatting happens last, on the client.

1. **Evaluate** (language host, per model revision or scope change): rules emit
   symbols carrying a notation token, labels and constraints. No shapes,
   colours or coordinates.
2. **Lay out** (client): the form's layout strategy computes geometry for
   anything without saved geometry. Saved geometry takes precedence where the
   axis is not semantic.
3. **Render** (client): a notation profile maps each token to a shape and
   style.

Pan, zoom, move and resize rerun only step 3.

Two additions are needed so a language can ship its own look as data:

- **Notation profile as data**: a token-to-shape/style table (shape, stroke,
  fill, icon, line ends), validated like palettes, with no executable content.
  It includes small fixed shapes for initial, final, fork, join and decision.
- **Conditional formatting**: a rule computes a style class from model values
  during evaluation (for example `severity >= 8` gives `critical`). The profile
  maps the class to a style. The decision stays in the rules; the graphics stay
  in the client. This applies to grid cells as well as symbols.

## Compose and explore are the same mechanism

| Gesture | Scope operation | Model edit? |
| --- | --- | --- |
| Drag an element from the tree onto the canvas | add seed | No, unless the view is model-persisted |
| Show related / expand neighbours | expand | No |
| Hide / collapse | hide / collapse | No |
| Palette create, draw a connection | none | Yes, through the existing prepare/commit transaction |

A scope can be stored in three places:

1. **Ephemeral**: an exploration session.
2. **Sidecar**: next to the existing `.views.json` layout document.
3. **In the model**: the language supplies a "persist scope operation" command.
   For SysML this writes `expose X;` into the view usage.

Saving an exploration as a SysML view is replaying the scope log through that
command.

## How languages plug in

**SysML** becomes a front end that compiles its own view constructs to this
representation:

| SysML construct | Becomes |
| --- | --- |
| `expose` | seeds |
| `filter` | a predicate function supplied by the SysML package |
| rendering / standard view kind | selection of a rule set |
| viewpoint | source-linked requirement, as today; not evaluated here |

**A data-only language** ships rule sets and no provider code. Illustrative
FMEA sketch (syntax is not final):

```
rule FailureMode   -> node  notation=fm      label=fmea.label  rows=[severity, occurrence, detection]
rule Effect        -> node  notation=effect  label=fmea.label
rule Causation     -> edge  from=fmea.causeOf  to=fmea.effectOf  notation=causal
expand FailureMode : [fmea.effects, fmea.causes, fmea.mitigations]
create FailureMode : command=fmea.addFailureMode
```

Names such as `fmea.effects` are `pub fn` declarations in the language's Rcore
behaviour source.

The dependency direction is preserved. The evaluator and rule format live in
the `intersect-views` repository and know no language classes. Language packages own their rule sets,
Rcore functions, native providers and commands.

## Decisions proposed

| Topic | Proposal | Reason |
| --- | --- | --- |
| Rule format | Versioned JSON, validated like palettes, no executable content | Matches existing contracts; schema-checkable in editors |
| Text syntax for rules | Later, as its own Intersect language | Avoids designing two things at once |
| Queries | Rcore functions and `QueryPlan`; no new query language | One semantic implementation; existing checker and budgets |
| Legality feedback | Rcore applicability predicates for live hints; `validate` issues and candidate analysis as authority | Issues already carry code, message and feature |
| Occurrence identity | (view key, rule ID, element key, context path) | Generalises the current scheme |
| Edits | Stay language-owned commands; rules reference command IDs only | No second semantic implementation |
| Repository | A new `intersect-views` repository above Model and Text (see Repository placement) | Engine, host, client and harness change together |
| Budgets | Per-query and per-scene limits, reported as scene problems | Consistent with `SceneLimits` |

## Open problems

- **Durable identity.** Declaration keys do not survive rename, move or
  ownership change. Saved scopes and layouts need the identity service already
  noted as missing.
- **Contract growth.** Lane graph, grid and tree are extensions to a graph-only
  contract. Each needs versioned DTOs, validation and shared Rust/TypeScript
  fixtures.
- **Language semantics.** Each view depends on semantic functions the language
  must supply: effective features for interconnection, transition resolution
  for state machines, event ordering for sequences. For SysML v2 this is most
  of the work. The engine does not reduce it.
- **Notation conformance.** A rule set can approximate a standard graphical
  notation. Conformance is a separate qualification effort per view.
- **Large matrices.** Derived cell relations over large axes may be expensive.
  Budgets and caching per revision are needed before this is practical.
- **Incremental evaluation.** The first version re-evaluates per model
  revision. Caching by revision is straightforward; finer invalidation is not
  designed.
- **SysML filter expressions.** Full evaluation depends on the language's
  expression evaluator being available as a native predicate.
- **Rule conflicts.** Precedence when two rules match one element needs a
  defined order (proposed: most specific class first, then declaration order).

## Known gaps

A critical review of this proposal against its two aims. The Mercurio and host
points rely on the architecture documents, not a line-by-line code review.

### Common mechanics not yet in Intersect

| Mechanic | Where it is today | Proposed home |
| --- | --- | --- |
| Transaction host: prepare, commit, tokens, revision checks, buffer receipts | `intersect-kerml-ide` | A generic host in Intersect, parameterised by a language pack |
| `views/*` and editor protocol | Defined only by KerML's implementation | A versioned host protocol owned by Intersect |
| Client transaction session: hash checks, undo-group patches, revision reservation, rollback | Mercurio `diagrams.ts` | The visualization package, with editor and file adapters supplied by the application |
| Selection sync across tree, source and diagram; stale-scene gating | Mercurio | The visualization package |
| Scope state and its persistence | Unassigned | The generic host holds the session; the sidecar format is an Intersect contract |
| Language registry and descriptor | Hard-coded in Mercurio | Descriptor is an Intersect contract; the registry stays in the application |

Without these moves, each new language rewrites a host and each new
application rewrites a client session. "Intersect" and "the visualization
package" in this table mean the `intersect-views` repository described below.

### Limits on generality

- **Editing is not general.** Every create, connect, delete or rename is a
  Rust command per language, with hand-built source text. A language that
  ships only data can be viewed, not edited. Either Text gains grammar-driven
  generic commands, or this limit is stated as permanent.
- **Occurrence contexts are not designed.** An interconnection view shows one
  element several times under different usage contexts, expanded recursively
  through its type. "Match an element, emit a symbol" does not express that.
  The rule format must carry a context path and recursive expansion.
- **The query foundation is unverified.** See section 1.
- **Three of four forms do not exist.**
- **The design is generalised from one language** and one handwritten
  provider.
- **Cross-language models are unresolved.** A model in one language referring
  to elements of another cannot be served by separate hosts.
- **Durable identity is missing**, for every language.

## Repository placement

Decision: the view engine gets a new repository, `intersect-views`, named
after the contracts crate that moves into it. The repository does not exist
yet.

| Piece | Comes from |
| --- | --- |
| Scene, palette and patch contracts (the `intersect-views` crate) | Moves from Model |
| Visualization client (`packages/visualization`) | Moves from Model |
| JSON schemas and shared Rust/TypeScript fixtures | Move with the contracts |
| View evaluator and rule format | New |
| Generic host and host protocol | New, extracted from `intersect-kerml-ide` |
| Client session and selection sync | New, extracted from Mercurio |
| Harness language, as a subdirectory | New |

Dependency position: application -> language package -> `intersect-views` ->
Text -> Model. The repository depends on Model and Text. Language packages
depend on it. Mercurio depends on it and on the language packages.

Rules:

- Engine crates may depend on the harness only as a test dependency. The
  engine never depends on a language.
- The engine uses only the public APIs of Model and Text. A capability it
  needs from Model, such as calling Rcore over the frozen model, is a Model
  change first.

Why not Model: the generic host prepares source patches and so needs Text,
which Model cannot depend on. Model also sheds its TypeScript rendering code.

Costs:

- KerML and Mercurio pin the contracts crate by Model revision today. Both
  pins must be repointed. The crate is not published to crates.io.
- One more link in the pin chain between a Model change and its consumers.
- The generic host serves analysis, completion, hover and evaluation as well
  as views, so the repository's scope is wider than its name.

## Harness language

Development starts with a small language built to test the engine, not with
SysML. SysML moves onto the engine once the mechanics are proven.

Reasons:

- The engine is designed against a language that is not SysML, so SysML shape
  does not leak into the contract.
- Tests run in the quick tier. SysML needs the standard library loaded, which
  is milestone-only.
- Each engine mechanism gets a minimal construct that isolates it.
- The engine can be built without a dependency on the KerML package.

Each construct exists to exercise one mechanism:

| Construct | Exercises |
| --- | --- |
| `Box`, nested in a `Box` | Nodes and nesting |
| `Kind`, and a `Box` typed by a `Kind` | Occurrence contexts and recursive expansion |
| `Pin` on a `Box` or `Kind` | Border ports |
| `Link` between pins or boxes | Element edges, connect commands, legality |
| A plain reference feature | Reference edges, expansion relations |
| `Field` with a typed value | Compartments, table columns, conditional formatting |
| `Group` partitions in a `Box` | Regions |
| `Step` with `after` and a `Lane` | Order on a semantic axis, lanes, spans |
| `Trace` between two elements | Matrix cells, direct and derived |
| A deliberately illegal combination | Rejection reasons and live hints |

The names are placeholders. The language should stay this small; a construct
is added only when an engine mechanism needs it.

The harness lives in a subdirectory of the `intersect-views` repository, so an
engine change and its harness tests land in the same commit. It is laid out
as a language package, which also makes it the template for new languages.

The harness is a test fixture. It is not a modeling language for users and
must not be described as one.

## Suggested slices

Every slice from 1 to 9 is developed and accepted against the harness language
in the quick tier.

0. Confirm a host can call Rcore query functions over the frozen model, adding
   a view binding kind if needed.
1. Create the `intersect-views` repository. Move the contracts crate and
   visualization client from Model and repoint the KerML and Mercurio pins.
   Add the harness language: metamodel, grammar, Rcore functions and fixtures.
2. Generic host and versioned host protocol in Intersect, with the harness as
   its first language.
3. Evaluator and rule format, including occurrence contexts, for the graph
   form.
4. Scope operations and exploration.
5. Client session and selection sync in the visualization package. Notation
   profile as data, with conditional formatting.
6. Editing: decide on generic commands, then create, connect and legality
   hints.
7. Grid form: tables first, then matrices with cell editing.
8. Graph additions: regions and structured labels.
9. Lane graph form. Last, because the semantic axis changes the interaction
   model.
10. SysML: choose one semantic navigation layer in the KerML package, expose
    it as Rcore-callable functions, and re-express the General and
    Interconnection views as rule sets. Acceptance: the same scenes as the
    current fixtures, and a redefined feature renders instead of failing.
    This depends only on slices 0 to 6 and can start before 7.
11. A second user-facing language, such as FMEA, and the decision on
    cross-language models.

Each slice needs its own implementation and verification evidence before any
qualification claim.
