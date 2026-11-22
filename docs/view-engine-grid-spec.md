# M7: grid form — approved specification

Status: **approved for M7 implementation by the user on 2026-11-17**. Prepared 2026-11-17
against the M6 implementation at `b99b398`. This document supplies the grid
section requested by Model's `docs/view-engine-spec.md`, milestone M7, at
`e5f6231dc7b7fb2b2a7c95da8459ab846a1b2ac6`. The original specification governs
unless superseded by the approved grid decisions below. Implementation is now authorized.

Changes stay in intersect-views. No Model/Text update or other repository edit is
assumed. M8 regions/structured labels, M9 lanes, and SysML remain outside scope.

## 1. Approved decisions

| Topic | Approved decision | Consequence |
| --- | --- | --- |
| Versioning | Scene v3 is a strict graph/grid union; rule sets become v2 | Update the local graph producer, validators and fixtures together; no implicit v2-to-v3 conversion |
| Query representation | Embed Model's existing QueryPlan expressions, predicates and projections inside an axis query template | No new query operators or evaluator; the host supplies schema identity, limits and the hidden element-ID projection |
| Scope | Query candidates are the ordered visible root elements from scope | An empty scope produces an empty grid; contained elements require explicit seeds; graph expand/collapse ops are rejected in a grid |
| Matrix meaning | A row function returns related column elements, called once per row | Build sparse cells by intersection with the visible column axis, without calling a function for every pair |
| Cell provenance | Editable matrices also select relation members per row and map each member to its column | Cells can reveal/delete an actual Trace; multiple members in one cell require an explicit member choice |
| Editing | Tables project values read-only in M7; authored matrix cells support create/delete through language commands | No inline attribute setter, generic text generator, or optimistic source mutation |
| Empty-cell applicability | Add a focused `views/gridTargets` method | No dense transmission of every empty matrix coordinate; existing graph targets stay unchanged |

The additional member selector resolves a gap in the M7 outline: a function
`(row: T) -> Sequence<U>` identifies columns, but cannot identify which relation
declaration should be revealed or deleted. It remains the cell-occupancy function;
member selection supplies provenance, rather than replacing that function.

## 2. Source facts and implementation gates

These facts were checked in source at the exact current pins, not executed in
this drafting session. Model is `9f026067f71721909ea508177127fccf5e7efd44`; Text is
`3d026308b87a40d6a9548f1307c694558cbbaa30`. See the inspection record in
[m7-spec-review.md](qualification.md).

- `core::query::QueryPlan` is serde data with `schema_uri`, `schema_revision`,
  `from`, `filter`, `select`, `order_by`, and `limit`. Its expression/predicate
  types reject unknown fields. `prepare` validates and returns `PreparedQuery`;
  `execute` accepts `&dyn ModelRead` and `QueryLimits`.
- `Expression::Field { path: "$id" }` projects the candidate identity. QueryOutput
  has projected rows, column names, schema revision, `has_more` and work statistics;
  it does not separately return the subject identity of each row.
- Plans support up to 32 projected columns and eight orderings, with native path,
  predicate-depth and expression-count checks. A singular reference path such as
  `kind.name` is supported; arbitrary collection flattening in a field path is not.
- `QueryOutput.has_more` means the native result was truncated to plan.limit.
  M7 must reject that result rather than publish a partial grid.
- Query execution creates an internal QueryBudget from `QueryLimits.max_steps`.
  There is no public external-budget argument on `PreparedQuery::execute` at this pin.
  Candidate enumeration uses `ModelRead::id_page` or an anchored `query` lookup.
- FrozenStore implements ModelRead. Reuse M0's public revision initialization and
  M6's one store per accepted revision. Query/store schema revisions must agree.
- SourceModelFunction supports a model receiver and element-sequence results.
  The current host admits exactly one element parameter and caches referenced
  functions. The matrix design keeps that interface; no row/column pair parameter
  or collection argument is introduced.

After approval, the first implementation slice must prove native and WASM
QueryPlan execution over the existing frozen store, hidden `$id` decoding,
candidate restriction, overflow detection and aggregate budget accounting. If
those routes require an upstream change, stop and report it. The source
inspection here is not an M7 feasibility/performance qualification.

## 3. Contracts and versioning

`SceneResponse` remains `{ scene, capabilities }`. Scene schemaVersion becomes 3
for both forms. Shared fields remain `ruleSet`, `revision`, `view`, `palette` and
`problems`. Exactly one form payload is allowed:

| form | Required payload fields | Forbidden payload fields |
| --- | --- | --- |
| graph | layout, nodes, edges, with their M6 meanings | grid |
| grid | grid | layout, nodes, edges |

Grid has a second strict discriminator, `kind: "table" | "matrix"`. Rust uses
checked tagged types; TypeScript uses discriminated unions. Do not combine
serde flattening with an ineffective unknown-field check. All objects, including
nested query AST nodes and command metadata, reject unknown fields at acceptance.

Rule-set schemaVersion becomes 2: graph rules retain the M6 layout/symbols/edges
fields; grid rules require `grid` and forbid layout/symbols/edges. Existing local
graph rule files and fixtures are mechanically updated to v2. Graph symbol IDs
and graph behavior remain unchanged. Old versions fail explicitly; no automatic
rewrite of external documents is introduced.

ViewDocument, Scope, Palette, NotationProfile, Presentation, PreparedEdit and the
language protocol retain version 1. View documents continue to select a rule set
by ID and save scope. Model's separate scene v1/client copy stays untouched.

### 3.1 Grid wire types

The following are normative wire shapes, not implementation code. `Binding`
is the existing model/source binding; no empty cell gets a fabricated binding.

```typescript
type AxisEntry = { id: string; label: string; binding: Binding };
type ProjectionColumn = {
  id: string;
  label: string;
  scalar: "string" | "integer" | "boolean" | "reference";
  many: boolean;
};
type GridAtom =
  | { kind: "string"; value: string }
  | { kind: "integer"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "reference"; label: string; binding: Binding };
type GridValue = GridAtom | { kind: "list"; items: GridAtom[] };
type GridMember = { id: string; label: string; binding: Binding };
type GridCell = {
  id: string;
  row: string;
  column: string;
  origin: "query" | "relation" | "derived";
  value: GridValue;
  binding: Binding;
  members: GridMember[];
};
type Grid =
  | { kind: "table"; rows: AxisEntry[]; columns: ProjectionColumn[]; cells: GridCell[] }
  | { kind: "matrix"; rows: AxisEntry[]; columns: AxisEntry[]; cells: GridCell[] };
```

Integer values are canonical signed decimal strings within int64 range; the
host decodes native EInt/int64 results with Model's scalar contracts and never
converts through a JavaScript floating-point number. Reference values retain a
real target binding and a label derived using configured name_features (falling
back to the target key). Lists are homogeneous and non-empty; nested lists,
floating-point, nominal custom datatypes and enum projections are outside M7.
Unsupported projection types are load errors, not stringified JSON.

Rows and matrix columns have unique element keys within each axis. This is a
flat element grid: repeated graph occurrences collapse to one entry, with
binding.context `[]`. The same element can occur on both axes with distinct IDs.
Table column headers are projection metadata, with no model binding.

### 3.2 Cell presence and provenance

- Table cells: null or an empty collection is absent. Zero, false and an empty
  string are present values. Each transmitted cell has origin query, the query
  subject's binding and an empty members list. A reference value additionally
  carries its target binding. The primary binding denotes the subject whose
  projection was evaluated, not a claim that a traversed feature is declared there.
- Authored matrix cells: present when the related-columns function includes the
  visible column and at least one selected relation member maps to it. Origin is
  relation; members contains every distinct relation member. Value is an integer
  count equal to members.length; the primary binding is the first member's binding.
- Derived matrix cells: when no member selector is configured, related-column
  membership produces origin derived, boolean true, the row binding and no members.
  These cells are read-only in M7 and do not pretend to be Trace declarations.
- Empty cells never appear in `cells`; the client infers them from the two axes.
  Matrix false values, zero member counts and empty member arrays on relation
  cells are invalid wire data.
- Duplicate `(row, column)` cells, dangling axis IDs, invalid types, duplicate
  member IDs or bindings inconsistent with provenance are contract errors.

IDs are `"symbol:" + sha256(UTF-8(JSON tuple))`. Tuples are:

| Symbol | Tuple |
| --- | --- |
| row | ["grid", viewKey, ruleSetId, "row", elementKey] |
| matrix column | ["grid", viewKey, ruleSetId, "column", elementKey] |
| projection column | ["grid", viewKey, ruleSetId, "projection", columnRuleId] |
| cell | ["grid", viewKey, ruleSetId, "cell", rowId, columnId] |
| member | ["grid", viewKey, ruleSetId, "member", cellId, elementKey] |

Tuple encoding uses ordinary compact JSON arrays in the listed order. Row/column
reordering does not change IDs. Model elementId values remain revision-local;
named key stability and anonymous-key limitations remain as in M6.

## 4. Rules and QueryPlan bridge

Each `query` below is a QueryPlan template with exactly `from`, `select`, optional
`filter` (default null), and optional `order_by` (default []). Nested nodes use
Model's existing snake_case JSON representation and operators unchanged. Authors
cannot provide schema_uri, schema_revision, limit, parameters or executable text.
Expression::Parameter is not admitted in M7; use literals or stored fields.

The host builds the actual QueryPlan with its prepared schema identity, appends
`__element = Field("$id")`, sets the bounded result limit, and validates/prepares
it using the native Model types and `NoDerivedValues`. The name `__element` is
reserved. Rust must deserialize embedded expressions/predicates into Model's
types rather than implement another evaluator. Engine/contracts may retain
bounded query JSON as opaque data until host validation; such data is not an
accepted loaded rule set until native validation passes. TypeScript/JSON Schema
mirror structural shape only. No derived-feature provider or conversion registry
is added in M7; unsupported paths/types fail at load.

The engine receives a language-neutral GridQueries adapter returning element
handles, typed projected values and ordered columns. Model/QueryPlan types stay
in the host, not in the engine or visualization package. Production crates do
not acquire a harness dependency. Grid and graph dispatch share ViewModel,
ViewFunctions, source binding and transaction services.

### 4.1 Table example

```json
{
  "schemaVersion": 2,
  "id": "harness.box-table",
  "label": "Boxes",
  "language": "urn:intersect:harness:1",
  "form": "grid",
  "grid": {
    "kind": "table",
    "query": {
      "from": "Box",
      "select": [
        { "name": "name", "expression": { "op": "field", "path": "name" } },
        { "name": "kind", "expression": { "op": "field", "path": "kind.name" } },
        { "name": "fields", "expression": { "op": "count", "path": "fields" } }
      ],
      "order_by": [{ "expression": { "op": "field", "path": "name" }, "descending": false }]
    },
    "rowLabel": "name",
    "columns": [
      { "id": "kind", "label": "Kind", "value": "kind" },
      { "id": "fields", "label": "Own fields", "value": "fields" }
    ]
  }
}
```

QueryPlan chooses the rows and calculates the projected columns; the columns
array only assigns stable IDs, labels and display order to named projections.
rowLabel names a required singular String projection. Every authored select is
used exactly once, as rowLabel or a displayed column; display IDs and value names
are unique. Query select admits at most 31 authored fields, reserving one of
Model's 32 slots for __element: one rowLabel plus at most 30 displayed columns.
There must be at least one displayed column. Expressions, types and paths are
checked before any scene request, even for an empty model.

The example deliberately counts stored own fields. It makes no claim about
inherited/effective fields; a derived query provider is a separate future choice.

### 4.2 Matrix example

```json
{
  "schemaVersion": 2,
  "id": "harness.trace-matrix",
  "label": "Traces",
  "language": "urn:intersect:harness:1",
  "form": "grid",
  "grid": {
    "kind": "matrix",
    "rows": {
      "query": { "from": "Box", "select": [{ "name": "name", "expression": { "op": "field", "path": "name" } }] },
      "label": "name"
    },
    "columns": {
      "query": { "from": "Box", "select": [{ "name": "name", "expression": { "op": "field", "path": "name" } }] },
      "label": "name"
    },
    "cells": {
      "related": "traceTargets",
      "members": { "select": "outgoingTraces", "column": "traceTarget", "label": "traceLabel" },
      "edit": {
        "create": { "tool": "trace-add", "command": "harness.createTrace", "rowAccepts": "canTraceRow", "columnAccepts": "canTraceColumn" },
        "delete": { "tool": "trace-remove", "command": "harness.deleteTrace", "accepts": "canDeleteTrace" }
      }
    }
  }
}
```

Each matrix axis query selects exactly one singular String label projection;
the host adds its identity projection. Row and column classes/filters/orderings
may differ. Load checks require:

| Function | Signature/check |
| --- | --- |
| related | row class -> Sequence<column class or subtype> |
| members.select, if present | row class -> Sequence<member class> |
| members.column | member class -> Sequence<column class or subtype>; exactly one result per selected member at runtime |
| members.label | member class -> String |
| rowAccepts / columnAccepts | corresponding axis class -> Bool |
| delete.accepts | member class -> Bool |

Receiver supertypes are permitted by normal conformance. Other signatures,
unknown names and Construct effects fail at load. All members fields are required
together. edit is optional but requires members; create and delete are separately
optional within edit, which must contain at least one action. Derived matrices
omit members and edit. Tool IDs are unique within the grid, including palette
navigation IDs; palette overrides cannot replace rule-authorized commands.

## 5. Scope, evaluation and limits

1. Apply addSeed/hide/removeSeed in order using M4's de-duplication/origin rules.
   Skip missing keys with scene problems. A grid rejects expand/collapse with a
   named `grid.scope.unsupported` error; it never silently ignores them. Each
   axis's candidate universe is the resulting flat visible root list.
2. Execute each axis/table QueryPlan over a candidate-restricted ModelRead view
   of the accepted store. id_page and anchored query enumeration expose only
   candidate IDs, in scope order. Value/class/reference reads still delegate to
   the full immutable store, so `kind.name` can read a non-axis Kind. Apply native
   query filtering and ordering before the axis result cap. Never query a capped
   global result and intersect scope afterwards.
3. With no order_by, preserve scope order after class/filter selection. With
   ordering, use native ordering with scope order as the stable tie order. The
   adapter's query and id_page paths must agree on that order and cursor progress.
4. Decode __element through Model::lookup and make axis bindings. Reject malformed
   IDs, wrong schema revision, duplicate subjects or has_more. Emit no partial grid.
5. A table iterates query rows and configured projection columns, omitting absent
   cells as defined above. It does not re-read fields through a second evaluator.
6. A matrix calls related once per row and de-duplicates its returned identities.
   Intersect with the visible column axis. Out-of-axis targets produce deterministic
   scene problems and no cells. A declared-compatible function returning an element
   of the wrong class is an evaluation error.
7. When members is present, call select once per row. De-duplicate member identity;
   call column and label once per selected member. Group visible members by column.
   The visible target set must equal the visible member-column set, or fail with
   `grid.provenance.inconsistent`. Outside-axis members are omitted with problems.
   Preserve member selector order, including parallel relations.
8. Emit cells in row-axis then column-axis order, independently of hash-map order
   or relation result order. A zero-result axis is valid and produces zero cells.
   Validate the complete scene before returning it.

There is no per-coordinate semantic loop: complexity follows candidate queries,
row functions and selected members. Wire size is O(rows + columns + non-empty
cells + members), not O(rows * columns). The client may represent empty coordinates
locally, without serializing fake cells or caching them in the host.

Approved finite defaults:

| Limit | Default |
| --- | --- |
| Scope ops / visible candidate roots | 4096 / 4096 |
| Grid rows | 500 |
| Matrix columns / displayed table columns | 128 / 30 |
| Non-empty cells / relation members / list items, total per scene | 5000 each |
| Label / scalar string | 4096 / 65536 UTF-8 bytes |
| Encoded grid scene | 8 MiB |
| Aggregate semantic work | 2,000,000 units |

Native query AST bounds also apply. Every exceeded limit names the limit and
fails the request; no hidden pagination, overflow summary cell or truncated label
changes model meaning. These defaults need M7 fixture measurements, not a claim
that maximum axes or dense tables fit every work budget.

Because QueryPlan uses an internal ledger, the host must reserve quotas before
each execution: native steps and candidate-adapter operations each receive at
most `min(100000, remainingSceneWork / 2)`. If that is zero, fail. The adapter
charges its own bounded enumeration/lookup work and rejects exhaustion; on a
successful query subtract both native stats.reads and adapter work from the
scene ledger. Release unused quota. Rcore invocations then consume the same
remaining scene allowance. A query error aborts the scene. This conservative
accounting may count a read in both layers; it must never grant extra allowance
or assume that QueryLimits bounds backend allocation. The first gate in section
2 must prove this accounting and candidate-adapter behavior.

## 6. Commands and protocol

M6 prepare/commit/abort, exact full-project receipts, one pending edit, revision
reservation, candidate isolation, structured rejections and undo groups remain
the authority. No cell is toggled optimistically. Successful commit refreshes the
grid from the accepted revision; rollback restores buffers only while they are
still owned by that transaction.

prepareCommand gains a form-specific dispatch path, with its existing shape.
For a grid action, viewKey and scope identify the current grid; ownerKey must
equal the selected row's binding.key. Reserved arguments are row and column
axis symbol IDs, and member for delete. Any name input is language-owned. The
host recomputes the grid, resolves all IDs and applicability, and passes a typed
grid target (row binding, column binding, optional member binding) to Commands.
Do not pass grid edits through graph node/edge matching or require a fake Node.
CommandContext must expose a checked graph-or-grid scene/target abstraction.

Creation is available only for an empty matrix coordinate, supported command,
writable row and column, and successful row/column Bool predicates. Candidate
analysis decides the remaining domain rules. Delete requires a present, writable
member, supported command and its Bool predicate. The row/column need not be
writable merely to delete an independently writable relation. A multi-member
cell never means delete-all: the user must select a member. Deleting the last
member removes the sparse cell; deleting another member decrements its count.

The client uses a focused applicability request, avoiding dense empty-cell DTOs:

```json
{
  "method": "views/gridTargets",
  "params": {
    "revision": 12,
    "viewKey": "trace-matrix-1",
    "toolId": "trace-add",
    "row": "symbol:row-a",
    "column": "symbol:column-b"
  }
}
```

Optional params are scope, palette and member. The response has exactly revision,
viewKey, toolId, row, column, member (nullable), enabled (Bool) and reason (String;
required non-empty when disabled). IDs are opaque; the example IDs are placeholders.
Membership/version/unknown-ID errors fail explicitly; legal but inapplicable
coordinates return enabled false and a reason. Target results are hints, never
permission tokens. Prepare repeats the checks. Existing views/targets and its
graph response remain unchanged. No new public arbitrary-query execution method
is introduced.

Rule-derived grid palettes contain Select and declared create/delete actions
with gesture action; supplied palette tools must match rule tool/command IDs.
Unrelated graph modeling tools are disabled with a reason in a grid. M7 adds no
table attribute-edit commands. Table source reveal and projection copying are
read-only operations.

## 7. Client behavior

Introduce a form-dispatching view surface around the existing DiagramCanvas and
a GridCanvas. ViewSession keeps host/buffer transaction and sequence guards;
it does not gain DOM, language or editor dependencies. A grid bypasses ELK,
geometric drag, border ports and connection gestures. Switching forms cancels
armed tools and outstanding applicability/selection requests.

- Render rows/columns in transmitted order, with sticky headers and visible row
  and column counts. Empty cells remain visibly distinguishable from zero/false.
  Matrix relation cells display counts; derived cells display a distinct marker
  with a read-only explanation. Scalar/list/reference values have explicit renderers.
- Use ARIA grid roles, labels and row/column indices. Arrow keys move focus;
  Home/End move along a row, Ctrl+Home/End to corners. Enter opens details or
  reveals a sole binding; Space selects. Focus remains navigable without a mouse.
- Header selection reveals that axis element. Table cell details reveal its
  query subject and any referenced targets. A matrix cell reveals/selects its
  actual member or opens a labeled member picker; derived cells identify their
  row origin. Empty coordinates have focus and create actions but no source reveal.
- Create/Delete action availability follows focused gridTargets replies. Guard
  replies by revision, view, scope/request sequence, tool and coordinate/member.
  A stale grid disables model edits; typing during commit retains M6 protections.
  No source edit follows from selecting, scrolling, sorting or focusing a cell.
- Virtualize both axes: at most 40 data rows and 20 data columns are mounted at
  once, plus headers and one retained focused cell. Sticky headers/focus must
  remain correct when scrolling to a blank or off-screen coordinate. Do not build
  the full Cartesian DOM. Reuse only an in-memory index of transmitted cells.
- Header click sorting, column drag/reorder, widths, frozen panes, range edits,
  pagination and export are not M7 requirements. Row order is query-defined.
  Empty axes get an explanatory empty state. An axis with rows but no cells
  remains visible and supports empty-cell creation when applicable.
- Existing Presentation v1 remains graph-only. Grid scroll/focus are transient
  client state keyed by view; no grid coordinates are written into graph positions.
  Saved scope remains a ViewDocument, and reloading it produces the same grid.
- Escape cancels the active action/picker. Delete opens a checked delete action
  and member chooser when necessary. Source undo/redo remain separate from
  exploration undo, and all strings are rendered as escaped text.

## 8. Harness extension

Add Trace extending Element, contained by Space.traces, with required references
source: Box and target: Box. Proposed syntax:

```text
space Traces {
  box Alpha {}
  box Beta {}
  trace first from Alpha to Beta;
  trace second from Alpha to Beta;
}
```

Scope both references to top-level Space.boxes in that Space. This initial Trace
syntax has no contextual nested-box paths. Require distinct source and target
with `harness.trace.ends`; existing unique-name validation also applies to Trace
names. Parallel, differently named Traces are valid and occupy one cell. Do not
add Group, Step, Lane or a second containment/navigation interpretation.

Add pure Rcore traceTargets, outgoingTraces, traceTarget, traceLabel and unary
applicability functions. The related function and member functions use the same
Trace navigation definitions. Add harness.createTrace and harness.deleteTrace in
Rust. Create inserts into the Space owning both endpoints; delete removes only
the checked Trace declaration/span, preserving neighboring source/comments.
Provider and host independently enforce source ownership/editability; only the
candidate loader decides final validity. Deletion must not guess a declaration
by display name or row/column indices.

Fixtures include the box table, editable Trace matrix, read-only derived matrix,
an empty axis, hidden/out-of-axis targets, parallel Traces, an invalid self Trace
and a duplicate name. View documents seed the intended Box keys; initialization
must not reseed an explicitly saved empty scope. Show both graph and grid views
in the same browser harness and preserve existing graph editing tests.

## 9. Acceptance after approval

| Area | Required evidence |
| --- | --- |
| Public query route | Native and WASM frozen-store query, $id decode, revision mismatch, candidate paging and indexed lookup with the same order, reference reads outside scope, has_more refusal, aggregate budget exhaustion |
| Strict contracts | Shared Rust/TypeScript accepted/rejected graph v3, table, matrix, rules, typed values and grid-target fixtures; wrong version/form fields, dangling/duplicate axes/cells/members and malformed provenance all rejected |
| Evaluation | In-memory query/function fakes; flat scope, deterministic byte output, native ordering/ties, null/empty collections versus zero/false/empty string, sparse output, duplicates, off-axis targets, provenance mismatch, every limit |
| Real harness | Dispatch-only table values equal native QueryPlan output; both axes use QueryPlan; row function called per row, not per pair; parallel Traces yield one cell with two real bindings |
| Editing | Create empty cell, delete selected member, last-member removal, read-only/unsupported/stale/occupied/wrong-member rejection, four M6 transaction invariants and complete receipts retained, self-Trace Issue mapped directly, candidate isolation and source undo/redo |
| Browser | Render table/matrix, header/cell/source selection, keyboard navigation and virtualized focus, highlighted/disabled focused-cell actions, create/delete/member choice, rejected edit and source undo, form switching, stale and typing-during-commit guards |
| Regression | M0 two-second call gate, all graph evaluation/editing/notation/browser tests, saved empty scope, all applicable fmt/clippy/quick-tier/WASM/npm checks |

Count function calls in fakes and compare sparse payload sizes; do not claim
production scalability from DOM virtualization or from a native work counter.
Record commands, failures, timings and qualification limits under docs/evidence.
No required probe is replaced by a source-only assertion. If a new native test
takes ten seconds or more, follow the existing milestone-only test policy.

## 10. Approval boundary

The user approved the decisions in section 1, including scene/rule version
changes, explicit flat scope, relation-member provenance and focused gridTargets.
The implementation evidence is [M7 qualification](qualification.md). Limits are
finite fixture-qualified defaults, not production performance claims. No upstream
changes were authorized or required. M8 remains a separate specification/review step.
