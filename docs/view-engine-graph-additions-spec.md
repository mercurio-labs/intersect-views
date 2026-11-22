# M8: graph additions — approved specification

Status: **approved by the user’s continuation on 2026-11-17; M8 implementation authorized**.
Prepared 2026-11-17 against completed M7
`157d32b431a1d3b02fd1cb706160b8ff3a1b0c60` in intersect-views.

This supplies the graph-additions section requested by milestone M8 of Model's
`docs/view-engine-spec.md` at `e5f6231dc7b7fb2b2a7c95da8459ab846a1b2ac6`.
That specification governs except for the proposed decisions explicitly listed
here. The proposal is background; the approved M7 grid specification and its
qualification remain the baseline for grids.

The approved M8 scope includes the Group language, wire types, functions,
commands, rendering and fixtures specified below.
Model, Text, KerML, Examples and Mercurio stay untouched. M9 lanes/order/span,
semantic-axis dragging and SysML remain outside scope.

## 1. Approved decisions

| Topic | Approved decision |
| --- | --- |
| Regions | A node may contain ordered partitions, each backed by a real selected model element, with its own bound header and child nodes |
| Occurrences | A region contributes its element key to its children's context; it is a visual container, not an edge endpoint or fake Node |
| Membership | Direct children and partition members must be disjoint within one owner occurrence; moving a symbol cannot change membership |
| Labels | Graph title/subtitle/port/row/edge/region labels become flat ordered parts; each part is explicitly bound to one subject or is an unbound literal |
| Editing | A label part may declare a language command. A focused `views/labelTargets` check and typed command target extend the existing transaction path |
| Scope | Existing collapse can target a node or a region occurrence. Regions retain their header when collapsed; root hide/remove/expand stay root/node operations |
| Versions | Scene v4 and rule v3, including mechanical grid envelope version changes. Other document/protocol versions stay unchanged |
| Notation | No new notation language/profile version: partitions use the owner's existing fill/stroke. Partition-bearing containers require rectangular or rounded notation |
| Harness | Add Group under Box and Kind, group-qualified End paths, empty-Group creation and one checked Field-value label command |

The extra label edit route follows the proposal's separately selectable/editable
parts, while avoiding a general inline text editor or generic grammar-driven
setter. Review should explicitly accept or narrow that editing slice.

## 2. Established baseline and implementation gates

M7 already proves the frozen-model pipeline, cached unary Sequence/Bool/String
Rcore calls, source bindings, native/WASM execution and candidate transactions.
No new function ABI, Model query operator, collection argument or upstream change
is assumed. Keep the exact pins:

- Text `3d026308b87a40d6a9548f1307c694558cbbaa30`.
- Model/build-support `9f026067f71721909ea508177127fccf5e7efd44`.

Source inspection at M7 shows:

- Node has direct children, ports and compartment rows. Its title/subtitle and
  every port/row/edge label are Strings. There are no region or label-part types.
- The endpoint index uses `(context, element)`. Paths contribute the keys of all
  intermediate elements, not layout-wrapper IDs. Current traversal only visits
  Node.children; validation, legality and rendering must also visit region children.
- ELK currently receives nested nodes with INCLUDE_CHILDREN; the client stores
  node positions relative to visual parents and recomputes routes from final
  endpoints. It has no partition layout, label-part geometry or editing route.
- End.part and End.pin already have dependent scoping in the harness. Three-stage
  group/part/pin resolution has not been executed.
- Public string-function slots already return arbitrary bounded String values;
  M8 must not add formatting semantics in Rust or JavaScript to replace them.

These are inspected facts, not executed M8 feasibility results. After approval,
the first implementation slice must prove these gates:

1. In native and actual WASM execution, an inherited Group appears under two Box occurrences with distinct region and
   child IDs, and a Link resolves a group/part/pin path within each occurrence.
2. In the browser, the current layout/rendering adapter can keep two partitions non-overlapping,
   preserve their children and port positions, and route a cross-partition edge
   after owner move/resize and saved-position reload.
3. Native bindings and browser SVG label parts select/reveal the correct source without
   accidentally initiating node drag or connection gestures.

Use the existing loader, VM and renderer adapters. If a gate needs an upstream
change or an unplanned canvas rewrite, stop and report the missing capability
before broad implementation. Do not silently replace the reviewed endpoint,
scoping or layout model. Run the unchanged M0 two-second gate separately from
builds and browsers, as learned in M7.

## 3. Contract versions and compatibility

- Scene schemaVersion becomes **4** for graph and grid; rule schemaVersion
  becomes **3** for both forms. Preserve the strict graph/grid and table/matrix
  discriminators. No automatic upgrade of supplied old-version documents.
- Graph payload changes below are mandatory at the new version. Grid payloads,
  provenance and IDs are unchanged apart from their enclosing version numbers.
- ViewDocument, Scope, Presentation, Palette, NotationProfile, PreparedEdit and
  protocolVersion remain **1**. Existing graph/grid target methods retain their
  shapes. The new focused method has its own strict request/response shape.
- Update local authored rules, producers, Rust/TS validators, schemas and shared
  fixtures together after approval. Preserve legacy files for rejection tests.
- Existing node/port/row/edge IDs and geometry keys remain identical when their
  rule, element, context and role are unchanged. Model's separate scene/client
  copy stays untouched until M10.

Unknown fields are rejected at every nested object. Optional rule fields may be
absent but not explicitly null; the explicitly nullable wire fields below must
be present even when null. No serde flattening loopholes or untyped catch-all
fields. Labels remain plain text, never markup, CSS, SVG fragments or URLs.

## 4. Wire shapes

These TypeScript shapes describe contracts to implement after review. Existing
Binding means the real model key/elementId/source range/readOnly/context tuple.

```typescript
type Label = { parts: LabelPart[] };
type LabelPart = {
  id: string;
  text: string;
  binding: Binding | null;
  editTool: string | null;
};

type RegionSet = {
  direction: "row" | "column";
  items: Region[];
};
type Region = {
  id: string;
  rule: string;
  label: Label;
  binding: Binding;
  collapsed: boolean;
  children: Node[];
};
```

Graph Node gains required `regions: RegionSet | null`. Null means no region
rule. An empty items array means that a rule exists but selected no visible
partitions (or that its owner is collapsed). Direct Node.children remain for
unpartitioned children. A Region has no ports, compartments, owned edge rules,
independent geometry DTO, notation token or arbitrary constraints.

Replace these graph String fields with required Label objects:

- Node.title and Node.subtitle;
- Port.label and compartment Row.label;
- Edge.label;
- Region.label, introduced here.

View names/details, compartment headings, palette captions, problem messages,
styleClass, port side, grid labels and values stay in their current shapes.
Accessible names/tooltips concatenate part texts in order without inserted
spaces. M8 graph Labels are single-line: CR, LF and tab are explicit unsupported-text
errors at load for constants and at evaluation for function results. Preserve
ordinary Unicode and spaces. Empty labels are valid; text is never truncated
to make layout fit.

A bound part's context equals the decorated symbol's primary binding.context.
A label part does not introduce a context level. Selection may reach a reference
target that is absent from the graph, such as a Kind named in a Box title. Its
key/elementId/URI/range/readOnly must describe that target, not the Box. The
part ID and containing symbol identify which annotation occurrence was selected.

Unbound literal parts have binding null and editTool null. A non-null editTool
requires a real binding and an action tool in the scene palette. Writable source
does not imply that every part is editable: the rule must declare that action.
Parts are never graph endpoints, standalone seeds or saved geometry objects.

## 5. Rule additions

### 5.1 Part subjects and label templates

Keep the existing Slot syntax: a String is a public function name, and
`{ "text": "literal" }` is a constant. Introduce LabelRule only in the graph
label positions listed in section 4:

```typescript
type LabelRule = Slot | { parts: PartRule[] };
type Subject =
  | { kind: "self" }
  | { kind: "select"; select: string }
  | { kind: "none" };
type PartRule = {
  id: string;
  subject: Subject;
  text: Slot;
  when?: string;
  edit?: { tool: string; command: string; accepts: string };
};
```

- Part IDs are non-empty and unique within that label template. IDs beginning
  `__` are reserved. There are no recursive part groups or template interpolation.
- when is an optional unary Bool function on the decorated element. False omits
  the part without calling its selector, text function or edit predicate.
- self uses the decorated element. select is a unary Sequence function on it:
  zero results omit the part, exactly one chooses its subject, more than one is
  `graph.label.subjectCardinality`, including duplicate results.
- A bound text function is called on the selected subject, not on the decorated
  element. A constant may also be bound. none permits a constant only and no edit.
- Edit accepts is unary Bool on the subject. Subject predicates and text functions
  are signature-checked against the selector's declared result class at load.
- At runtime reject returned subjects of an incompatible class. An empty text
  String remains a part; accessible hit/focus affordances must still make an
  editable empty part reachable. Omission is controlled by when/selection.
- A legacy scalar label Slot normalizes to one self-bound part with reserved
  part ID `__legacy` and no edit tool. A missing optional label slot normalizes
  to `{ parts: [] }`. Legacy label text and default interactions remain equivalent.
- styleClass and side remain scalar Slot fields; they cannot contain parts.

A Box title can bind its name and optional Kind separately, without a dangling
separator. kindTitle is a Kind -> String function including any desired prefix:

```json
{
  "parts": [
    { "id": "name", "subject": { "kind": "self" }, "text": "boxTitle" },
    { "id": "kind", "subject": { "kind": "select", "select": "boxKindRef" }, "text": "kindTitle" }
  ]
}
```

### 5.2 Region rule on a node

A node rule gains optional regions. It is invalid on a port rule:

```json
{
  "id": "box-groups",
  "select": "boxGroups",
  "label": "groupLabel",
  "children": { "select": "groupParts" },
  "direction": "row"
}
```

The regions object is a single rule, not an array of ad-hoc layout fragments.
Its id is globally unique across the rule set's symbol, edge and region rule
IDs. select is owner class -> Sequence<region class>; label is LabelRule on that
region class; children.select is region class -> Sequence<child class>.
The host infers result classes from cached function signatures, as for rows.
Each selected child uses normal node-rule matching and precedence. An unmatched
region child is omitted with a named scene problem, rather than treated as a Node.
No function takes an owner plus a region or a set of children as arguments.

Region rule fields are all required. direction controls only presentation:
row means partitions ordered left-to-right, column top-to-bottom. It is not a
semantic order/lane axis. Reordering a rule selector's results changes order;
there is no client partition-reordering gesture in M8.

## 6. Evaluation, identity and scope

1. Retain graph scope/root order and rule precedence. For each node occurrence,
   compute its usual child context `c + [ownerKey]`.
2. Evaluate direct children and region selectors once, in rule/result order,
   de-duplicating returned identities within each selector while preserving first
   occurrence. A region element must not also be a direct child at that context.
3. Each region binds to its element at the owner's child context. Its children
   bind at `c + [ownerKey, regionKey]`. Thus a real Group adds a level to occurrence
   paths; no visual-only wrapper ID ever enters Binding.context.
4. A materialized child identity may occur in at most one direct/region membership under the
   same owner occurrence, even if selected through different functions. Violation
   is `graph.region.membership`, never silent movement or duplication. The same
   inherited element under different owner occurrences remains legal.
5. Nested Boxes may themselves have regions. Depth counts both nodes and regions.
   A repeated/cyclic selector graph must terminate at the depth/work limits.
6. Register only nodes and ports as endpoints. Region keys may be intermediate
   path elements, but a path ending at a region does not resolve an endpoint.
   Edges resolve after both direct and region child traversal is complete.
7. A missing endpoint remains a deterministic scene problem and the edge is
   omitted, including endpoints hidden by collapse. No geometry-based lookup or
   search by display name is permitted.
8. Evaluate a Label's parts in authored order. Optional subjects/false conditions
   omit only those parts. Use the existing shared 2-million-unit VM ledger for
   all selectors, conditions and label functions; no per-part allowance reset.
9. Preserve node preorder: owner, direct children, then regions and their child
   subtrees. Region headers and part traversal have deterministic authored order.
   Evaluate twice and compare bytes, including problems.
10. Validate the entire scene and all budgets before returning it; never truncate.

Existing graph IDs keep their M7 algorithm. A region uses that same algorithm
with its region rule ID, region key, owner child context and role `region`.
Label-part IDs use `symbol:` plus SHA-256 of the UTF-8 JSON array:

```text
["graph-label", viewKey, ruleSetId, ownerSymbolId, slot, partRuleId, subjectKeyOrNull]
```

slot is one of `node.title`, `node.subtitle`, `port.label`, `row.label`,
`edge.label`, `region.label`. Literal subjects use JSON null. IDs do not include
text, ordinal, geometry or revision-local elementId. Text edits preserve IDs
unless an existing model key changes; rename/move durability is still excluded.
Every region/part ID is unique across the whole graph scene. A part's target
need not be an endpoint or an emitted node. Authored IDs are opaque in requests;
the host recomputes them before authorizing edits.

Scope v1 collapse extends naturally to a region occurrence using its key and
binding.context. The header and its label remain; children disappear. Collapsing
a node suppresses its direct children, regions, ports and owned edges as before.
Node compartments remain visible as in M7. A collapsed region's membership
selector need not run; uniqueness is checked over materialized memberships.
Node/region roles may not collide at the same `(key, context)`, so collapse is
unambiguous. Region headers offer collapse and source reveal, not root hide,
removeSeed or expand. Exploration undo/save/reload retain existing behavior.

Default limits to add to existing graph limits:

| Bound | Proposed default |
| --- | --- |
| Regions total / per node | 256 / 16 |
| Parts per label / total in graph | 32 / 20000 |
| Text per part / concatenated label | 4096 / 4096 UTF-8 bytes |
| Encoded graph scene | 8 MiB |
| Nesting | Existing 16, counting region containers too |
| Semantic work | Existing shared 2000000 units |

Existing 500 nodes, 1000 ports, 2000 edges and 5000 rows remain separate caps.
Region elements are not charged as nodes. Scene validation enforces counts,
text bounds, unique IDs, bound/unbound/edit-tool consistency, readOnly/source range shape,
no part/region edge endpoints, empty collapsed children, and no mixed form fields.
The engine/host additionally verify subject class and rule provenance against
the model and cached rules; a wire-only validator cannot establish those facts.
Limits fail with their names. These are defaults to qualify and measure
in M8, not production capacity claims.

## 7. Layout, rendering and selection

The host emits partitions and labels, never dimensions or coordinates. The
client measures complete labels, reserves their space and lays out children.
No rule supplies arbitrary placement or executable formatting.

Required geometry invariants:

- Each owner has a content area below title/subtitle and compartments. Direct
  children and the region band occupy disjoint areas. Regions tile that band's
  secondary extent and appear in transmitted order along direction.
- Each region reserves a header and a content rectangle. Empty regions remain
  visible with a useful minimum size. Children and their ports belong to that
  rectangle; they must not overlap another region or its header after layout,
  owner resize, saved-position reload or an internal child move.
- Layout may use nested ELK and a deterministic local partition-placement pass.
  The implementation gate must prove that adapter rather than assuming a
  particular untested ELK option. If necessary, grow the owner to its minimum
  content size. Do not compress labels, discard children or overlap partitions.
- Saved node geometry remains relative to its immediate visual parent, now a
  region for partition members. Ordinary node IDs/parents are unchanged. Region
  bounds derive from the owner/content; region/part geometry is not persisted.
- Recompute absolute nodes, port centers and routes from final geometry after
  applying presentation. Cross-region edges must remain attached to the correct
  occurrence. M8 does not promise general obstacle-avoiding routing.
- Measure full labels rather than silently keeping the old 340-pixel width
  clamp. All geometry must be finite and fit existing Presentation coordinate
  bounds; otherwise report `graph.layout.extent` instead of clipping text or
  accepting unsavable positions.
- Dragging a member stays within its current region; crossing a separator cannot
  reparent it. Regions/separators are not independently draggable or resizable.
  These are presentation constraints, not M9 semantic-axis commands.

For non-empty regions, the effective owner notation must be rectangle or rounded.
Use its existing fill/stroke for partition surfaces and separators, with the
client's existing safe text styling. No new region-style map or arbitrary part
fonts are introduced. An incompatible profile/shape is an explicit client error;
reject applying it while retaining the last usable profile/scene. Never mark a
retained old-revision scene current. Applying a compatible profile must refresh
the current accepted scene without needing a model edit. The same shapes remain
valid for nodes without regions. This contextual check must be tested.

Render part text through escaped text nodes and deterministic bounded measurement.
A click/Space selects the exact bound part, Enter/double click reveals that
subject's source; events must not start node drag, owner creation or connection.
Unbound punctuation has no invented binding or edit affordance. The surrounding
symbol is still selectable through its body. Empty bound parts need a visible
focus/edit affordance and an accessible name based on owner/slot/part identity.

Label parts and region headers enter keyboard/focus and cursor-highlight maps.
Tab order follows scene order; Escape cancels an armed part edit. A part edit
opens the action form with language-owned inputs, not a text overlay interpreting
the displayed String. Stale scenes disable edits. Late selection/applicability
responses after view, scope, revision or part changes cannot affect current UI.

Keep M7 ViewCanvas form routing and grid virtualization intact. Presentation v1
remains graph-only; grid focus/scroll and selection do not acquire layout entries.

## 8. Editing and protocol

Keep prepare/commit/abort payloads and M6/M7 invariants: one pending candidate,
clean baseline, exact complete buffer receipts, patch URI editability and hashes,
atomic publication, token-scoped abort, source undo and newer-typing ownership.
No label part is changed optimistically in the accepted scene.

Label edit tool IDs must not collide with navigation, node creation or connection
tools. Reuse across label templates is allowed only for the same command. A
supplied palette entry must match the declared tool/command and use gesture action;
parameters cannot authorize a different command. Rule-derived defaults include
an action for each label edit tool; the harness supplies its Value input through
its language palette. Global capabilities describe command support, not current
part legality.

New focused method (shown with opaque placeholder IDs):

```json
{
  "method": "views/labelTargets",
  "params": {
    "revision": 12,
    "viewKey": "structure-1",
    "toolId": "field-value",
    "part": "symbol:field-value-part"
  }
}
```

Optional request fields: scope and palette. All other/unknown fields fail.
Response fields are exactly revision, viewKey, toolId, part, enabled (Bool),
reason (String; non-empty if disabled). Unknown IDs, wrong form/view/revision
are errors. A known but unbound, read-only, undeclared or predicate-refused part
returns disabled with a reason. Hints are not permission tokens.

prepareCommand uses the existing shape, with reserved `arguments.part`. ownerKey
must equal the primary binding.key of the decorated symbol, not a guessed target
or enclosing Box. The host recomputes the current scene, identifies the exact
owner/slot/template part, checks the tool mapping, writable target and unary Bool
predicate, then passes a typed label target to Commands. It includes owner symbol
ID/binding, slot and LabelPart. Do not pass it through node-create matching or
fabricate a Node/endpoint. Preserve checked graph and grid command paths.

Only the subject must be writable; a read-only owner does not by itself prohibit
editing an independently writable referenced subject. Unbound literals and parts
without an edit declaration are never edit targets. Providers independently
verify the target's model type/source ownership and produce bounded patches.
An edit to an inherited subject changes that declaration and therefore every
occurrence that uses it; no occurrence-local override is synthesized. Candidate
analysis decides domain validity. The generic engine does not infer
attribute setters, rename rules or source-token replacements from label text.

## 9. Harness extension

Add Group extending Element, with `parts: Box*` containment. Box and Kind each
gain `groups: Group*` containment. A Box's effective groups are its own plus its
kind's, via one navigation function reused by rules, scopes and commands. Group
has no independent pins, fields or links; its Boxes retain those existing features.
Groups can nest indirectly through their member Boxes, not through Group.groups.

Proposed source fixture:

```text
space Regions {
  kind Shared {
    group Left {
      box Sender { pin outPort : out; field level = 2; }
    }
    group Right {
      box Receiver { pin inPort : in; }
    }
    link across {
      from s (group Left part Sender pin outPort)
      to t (group Right part Receiver pin inPort)
    }
  }
  box Alpha : Shared {}
  box Beta : Shared {}
}
```

Extend End with optional ref group: Group and the optional `group <name>` prefix
before existing part/pin clauses. Group scope uses the Link owner's effective
groups; part scope uses that selected Group's parts, or the existing direct-parts
route when no Group is named. Pin scope still uses the selected part's effective
pins. The group prefix requires a part; it cannot select a Group-owned pin.
The native/WASM gate must establish this third dependent reference, not assume it.

Navigation returns `[group?, part?, pin?]` for these paths. Existing paths without
a Group retain their bytes and semantics. Commands derive qualified end text from
checked occurrence bindings, including the region level. They must reject
cross-owner occurrences and unsupported deeper paths explicitly, rather than
searching globally by part or pin name. Node/port legality traversal includes
region children; region headers and label parts are not connection endpoints.

Groups remain additive; there is no inherited-name shadowing or Group merge.
If own/inherited Groups have the same name, neither silently wins: a reference
requiring that ambiguous name is a linking error, as with existing ambiguous
part names. Existing unique-name validation covers Group siblings within one
lexical owner and its member names. Add
located `harness.end.group` issues for a resolved group prefix lacking a part or
with inconsistent membership. Coordinate existing End target/pin checks so an
invalid group-only fixture reports that intended issue, not duplicate follow-on
issues. Unknown names remain linking diagnostics; do not broaden resolution with
an unrestricted name search to manufacture a validation fixture.

Add pure public functions for groups, members, headers, optional Kind label
subjects, End labels and label edit predicates. Required String label examples
use names and conditional constant text (e.g. Field value < 8 -> "low", otherwise
"high"); no unverified numeric-to-String API is assumed. A Field row template
contains name, unbound `" = "`, and that separately identified bound value-band
part. A Box title binds Box and Kind, and a Link label binds its Link and End
subjects, proving genuinely different source bindings.

Proposed commands:

- harness.createGroup: existing node-create route on a writable Box; inserts an
  empty named Group. Name uniqueness and candidate analysis remain authoritative.
- harness.setFieldValue: only the declared field-value part action; accepts an
  explicit non-negative Int32 Value input, verifies the bound Field and source,
  then replaces its numeric literal using Text's lexer/span helpers. Preserve
  CRLF, UTF-16 positions, comments and unrelated tokens. This changes a scalar,
  not model identity; generic rename is not introduced.
- Extend harness.createLink to encode checked group/part/pin paths. Existing
  box/pin/link/Trace commands remain available in their supported contexts.

Populate regions by source editing in the harness. Dropping a Box tool on a
region header does not silently create or reparent a member: that gesture is
unsupported in M8 and must explain why. Existing placement on a Box creates a
direct child. No new reparent/delete-Group command is implied by this milestone.

Fixtures cover own and inherited Groups, repeated occurrences, empty/multiple
regions, nested Boxes with regions, both directions, cross-region links, collapse
of only one inherited Group occurrence, distinct label subjects, absent/empty
parts, read-only/unsupported edits, invalid group ends and duplicate names.

## 10. Acceptance after approval

| Area | Required executed checks |
| --- | --- |
| First gate | Native and actual-WASM inherited Group/three-reference resolution; bounded client partition layout and separately bound label events |
| Contracts | Shared Rust/TS positive and negative graph/grid version fixtures, region/part IDs, required nullable fields, text/count/encoded limits, collapsed children and forbidden endpoints; structural schemas updated where applicable |
| Rule loading | Every new function/class/signature checked even for empty scenes; unknown fields, duplicate IDs/tool conflicts, invalid subjects, none with function/edit, Construct effects and unsupported emit positions refused |
| Engine fakes | Every evaluation step, selector de-duplication, ambiguous membership, part cardinality/type/when behavior, per-element call counts, each limit and byte-identical output |
| Real harness | Same inherited Group keys in Alpha/Beta with different IDs; correct group/part/pin endpoints for each; no global name resolution or graph-derived semantic navigation |
| Labels | Box/Kind and Link/End bindings differ correctly; absent subject omits one part; literal punctuation is unbound; text-only edits preserve part IDs; editing a shared Field refreshes both occurrences; cursor/source selection reaches the right declaration |
| Transactions | Create Group and set Field value; structured Issue rejection, forged/wrong owner/part/tool/read-only/stale refusal, isolation, exact receipts, one pending edit, abort scoping, source undo/redo and typing during commit |
| Browser geometry | Two directions, empty regions, long/Unicode/empty labels, move/resize/reload, stable port centers and attached edges, membership clamp, incompatible notation rejection, region collapse/save/reload and keyboard/source selection |
| Regression | M0 two-second gate unchanged and run without concurrent builds; all graph/notation/editing and M7 grid tests; fmt, strict clippy, quick test reports, WASM, npm check/test/build and browser checks |

Record exact commands, failures, pinned revisions, timings and qualification
limits under docs/evidence/m8.md when implementation is authorized. Quick tests
must remain below ten seconds individually; otherwise follow milestone-only
policy. Never substitute source inspection or a synthetic scene for a required
native/WASM semantic probe. No production scalability, SysML or notation
conformance claim follows from these harness checks.

## 11. Review boundary

The user approved this specification by instructing continuation on 2026-11-17.
The implementation and executed qualification are recorded in evidence/m8.md.
M9 requires its own specification and explicit review before coding.

All bound parts intercept semantic/drag gestures as specified. Symbols retain
body placement and dragging; regressions use body hit points for those gestures.
