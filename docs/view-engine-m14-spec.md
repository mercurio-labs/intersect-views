# M14: routing, bound label placement, action and state projections

Status: explicitly approved for implementation, 2026-11-18. The user selected
"Approve M14 implementation as specified" after reviewing this completed contract.
Implementation and qualification are in progress; this document does not claim
that any acceptance gate has passed. Record executed results separately.

## Outcome and scope

Use one generic renderer to display source-derived structural, action-flow and
state-transition scenes. Connections follow their actual contextual endpoints,
avoid measured content, survive arrangement and saved presentation changes, and
support deliberate manual bends. Shared tree trunks preserve separate edges and
provide an explicit picker. Bound text can move independently without changing its
source target. Qualify these behaviors through native language models and the
actual WASM/browser consumer, including source edits and reload.

Implementation is sequential: repair/qualify the outstanding bulk-input failure;
prove native action/state semantics; implement generic routing and presentation;
integrate and qualify all profiles. Do not label the complete milestone done
after structural routing alone. Report each gate separately.

Included repositories: Intersect Views and isolated KerML/Mercurio consumers.
Dependency direction stays application -> language -> Views -> Text -> Model.
Views owns geometry, contracts and generic interaction. KerML owns semantic
selection, effective membership, endpoints, source labels and edit admission.
Mercurio owns application wiring, Monaco, filesystem/export and status display.
There is no language-name switch or semantic parser in the canvas or application.

Excluded: Symbol properties/style inspector; action/state execution or simulation;
new semantic create/connect/delete providers; electrical-net inference; implicit
junction creation; sequence, geometry or tabular projections; installers, server
changes, publication, branch promotion, push or merge. A graphical crossing does
not connect model elements. Movable labels are included explicitly in this review;
the independently deferred Symbol properties proposal remains a proposal.

## Baseline, worktrees and dependency identities

The reviewed M13 prerequisites are:

| Repository | Immutable prerequisite | develop base used for new branches |
| --- | --- | --- |
| Views | a4816a6a51874dfd95a1398def93829818b28507 | 376b846cabe711151c421f743faf56ca1d33f75e |
| KerML | 1d55882a2909f87b98dec1f81c8de9586684f49e | 86fb57239f07fea054eed4f4ce9c4faddffc964f |
| Mercurio | 89a4d555d9fc9fa13924af61d3668df04d7bbc4f | 55ae88dfa0da8cd9a55f4a898f403c4307d6952e |

M14 Views is isolated under the task's `m14/views`, branch
`codex/view-engine-m14`: create explicitly from develop, verify ancestry, then
advance to the qualified M13 prerequisite without a merge. After approval use the
same procedure for `m14/kerml` and `m14/mercurio`. Preserve the clean M13 commits,
M13 preview on 1433, M10 preview on 1432, original M12 harness on 5175, original
checkouts and the 17 original Mercurio working files. Use a separate M14 preview
port, 1434. Do not move the original checkouts to these branches.

The separately approved shared-loader correction is now qualified through L01-L08.
Its immutable Model/build-support `ef2b43fdc0963270b2c729bca4a8078d3b107551` and
Text/loader `a4b66da578e655c83ef17d19ffaabcb37713de31` supersede the original
9ebf0d1/4247679 prerequisite pair. Model and Text runtime sources/APIs remain
unchanged. Views `563067c`, KerML `fa035759` and Mercurio `ddb65b8` are the corrected
consumer prerequisites; the original M13 table above is preserved as history.
See [integration and preservation evidence](qualification.md).
The correction's full qualification record is Mercurio
`docs/loader-boundary-qualification.json` at `ddb65b8`.

Retain that corrected pair while implementing M14. This contract continues the isolated full
immutable local Git-pin exception; one runtime identity, no committed mutable
path patch. No Model/Text source or API change is included. Stop and report a
missing upstream capability before changing those repositories. Final Views and
KerML pins must match all maintained Cargo/NPM locks and installed client sources.
Keep one local milestone commit per affected repository, no merge or push.

The M13 consumer receipt is the authoritative completed M13 result, rather than
older roadmap status paragraphs. See `docs/evidence/m14-baseline.json` for the
observed heads, sources and preserved artifacts at the start of this stage.

## Observed gaps and feasibility gates

M13 scenes retain exact binary edge bindings and occurrence contexts. Authored
graphics feed sibling edges to layered placement, but the canvas reconstructs
midpoint routes in `packages/visualization/src/canvas.ts`. Its directional stubs
do not establish obstacle avoidance. `Layout.edges` has no route-status, shared
segment or label-anchor contract; authored graphic placement leaves it empty.
Saved presentation v3 has symbol geometry and viewport only. The current semantic
navigation has no qualified action/state projection.

The checked Systems Library contains `Views::asTreeDiagram` and
`Views::asInterconnectionDiagram`; it does not provide separate action/state
rendering declarations. `StandardViewDefinitions::ActionFlowView` and
`StateTransitionView` specialize `InterconnectionView`. Their source documentation
lists nested actions, parameters, flows, states, transitions and entry/do/exit
content. This is a source inventory, not proof that the runtime resolves those
derived features. M14 must prove that separately.

### G0: close the retained browser-input failure

Reproduce the M13 whole-document Monaco `keyboard.insertText` stall with bounded
diagnostics. Compare Source and Split perspectives, one real bulk replacement and
an equivalent small-token edit; record renderer/worker progress without logging
unrelated source. Isolate application, Monaco/input automation and language-host
work before choosing a fix. Do not substitute a direct model update, mocked
analysis, longer timeout, disabled feature or token-only test as a passing bulk
replacement. Qualify the repaired route with the actual pinned WASM/pack, exact
final source bytes, clean analysis, rendering-change layout rejection, undo/redo
and stale-command guards. Retain the failure and root-cause evidence. If the
input driver alone is responsible, prove the same user paste through an actual
clipboard/paste route and record the driver limitation; a timeout is not proof.

### G1: generic routing vertical proof

Before broad integration, route one transformed port pair around an obstacle,
one nested boundary crossing and one branched containment tree with distinct
bindings. Measure real compositions; move/resize, collapse, save/reload and pick
branches in a real browser. Assert route geometry and exact source targets.

### G2: native semantic vertical proof

Use authored multi-file SysML fixtures under the checked library. Prove effective
ActionFlowView and StateTransitionView selection, real nested/control/state
members, exact contextual endpoints and trigger/guard/effect/entry/do/exit source
bindings in native KerML. Use the existing stored-model/Rcore route. No text scan,
class-name guess, fake graph or Mercurio fallback may supply missing semantics.
Preserve stored/imported/consumed/semantically verified as distinct observations.
Failure of a required derived feature is an upstream capability gap, not permission
to skip the case or expand Model/Text scope.

## Semantic scenes and rendering selection

Add two language-owned registrations: `sysml.actionFlow` and
`sysml.stateTransition`. Both use nested graph projection. Keep the three M13
registrations and their structural behavior. Resolve verified canonical view
definition ancestry before choosing a compatible rule profile:

| Verified most-specific view profile | No rendering | Explicit/inherited asInterconnectionDiagram |
| --- | --- | --- |
| ActionFlowView | sysml.actionFlow, default origin | sysml.actionFlow, actual rendering origin |
| StateTransitionView | sysml.stateTransition, default origin | sysml.stateTransition, actual rendering origin |
| InterconnectionView | sysml.interconnection | sysml.interconnection |

A specialized canonical definition dominates its verified ancestor; it must not
create a false competing-default error. Incomparable action/state specializations
are a located refusal. GeneralView defaults and explicit tree selection retain
M13 rules; incompatible action/state roots selected as a parts tree are refused.
Explicit unknown or incompatible renderings never fall back to a default.

Canonical trust still requires actual loaded library ownership, linked identity
and checked source contents, not spelling, URI or readOnly alone. Genuine aliases
and lawful inherited redefinitions work. A spoofed ActionFlowView cannot acquire
capabilities. The closed semantic policy now admits these two context-specific
profiles for the verified interconnection rendering; registry data cannot remap
them to a tree or invent another semantic profile. Rendering resolution v1 retains
its origin/canonical bindings, diagnostics bounds and request sequencing.

Action profile: nested action usages; directed parameters as real endpoint
occurrences; initial/final and fork/join control nodes; succession/control edges;
data/item-flow edges; parallel, return and cyclic topology. State profile: nested
state groups, initial/final occurrences where provided by the accepted model,
self/parallel/return transitions, bound trigger/guard/effect content and bound
entry/do/exit actions. Concurrent state groups retain their actual grouping.

Every displayed node, parameter, transition and independently bound text run must
retain the accepted source element/range/context. Use actual membership kinds and
linked endpoints, not row order, labels, nearby shapes or parsed source strings.
Implicit syntax is supported only when the accepted model supplies a validated
binding for the represented occurrence. Unresolvable endpoints or unsupported
membership semantics produce located refusal of the affected projection; do not
quietly drop a transition or manufacture a clean General scene.

Rules and reusable graphics express all glyphs: no action/state shape enum or
language dispatch in the generic renderer. Distinguish graph cycles from lane
ordering; these projections never inherit laneGraph's DAG requirement. New
action/state semantic editing tools remain explicitly disabled with a reason.
Compatible M10 editing on structural views remains qualified.

## Contract and version changes

| Boundary | M14 decision |
| --- | --- |
| Rules | v8; graph requires routing policy; grid/lane retain their projection contracts |
| Scene | v7; graph adds required routing policy, endpointProxies and nullable edge branchGroup; grid/lane only change envelope version |
| Presentation | v4; graph adds routeConstraints and labelPlacements; lane gets no graph-only fields |
| Worker routing request/result | strict v1 DTOs, internal to the generic client |
| Protocol | v2 envelope retained; no new semantic edit method or geometry authority |
| Rendering registry/resolution, view catalog/document/scope, graphics/package | retain v1 |
| Package capabilities | require views.routing.v1 and, for movable text, views.labelPlacement.v1 |

Source-bound role blocks use an explicit v8 scalar slot `{ "sourceText": true }`.
It reads only the selected accepted stored element's existing source span, with a
4096-byte raw bound; no source parser, semantic inference or external I/O is
involved. Empty, inferred or invalid spans refuse the projection. CRLF becomes LF
and tabs become four spaces for display; the original source bytes and binding
remain unchanged. This slot is read-only and cannot carry a label edit provider.
Multiline role text uses a TextBlock; ordinary labels replace line separators with
spaces and retain their single-line wire limits. The client can wrap the complete
bound edge label for display without changing its parts or source targets.
Model and Text APIs remain unchanged.

Strict Rust, TS and JSON schema validation must agree. Required empty collections
are emitted explicitly. Unknown fields/versions, missing capability, nonfinite or
out-of-range values, duplicate/foreign IDs, incompatible forms, bad references,
unclosed resources and incorrect hashes fail atomically before acceptance. Package
fingerprints cover the routing rules and graphic closure. No new callbacks or
executable presentation resources are introduced.

Graph routing policy has exactly `algorithm: "orthogonal"`, `clearance`,
`stubLength`, and `trunks: "none" | "siblings"`. Defaults for explicit migration
are clearance 8, stubLength 18, trunks none; clearance is 0..64, stubLength is
2..128 and at least clearance + 2. Containment-tree rules may opt into siblings;
other projections use none. The graph scene carries the validated policy.
Each edge adds required nullable `branchGroup`: the generic containment projector
derives a group from view/rule/role/source occurrence when siblings is enabled;
ordinary binary edges emit null. It is not a domain relationship or model key.

Provide explicit non-overwriting v7-to-v8 rule and v3-to-v4 presentation migration
previews. Retain original fixture bytes and refusal tests. Migration adds routing,
empty graph route/label maps and the appropriate envelope versions; it cannot
guess a new package fingerprint or silently authorize old geometry under a new
package. Consumer export/reset remains available. Existing compatible v3 content
may be migrated only after checking the old/new package and projection mapping;
otherwise reset explicitly while preserving old bytes. Legacy v2 remains an
explicit chained migration/reset, never an automatic overwrite.

## Collapsed endpoints

Collapse must preserve each incident relationship and logical endpoint identity.
Scene v7 adds `endpointProxies`, each with `id`, `displayOwner`, `binding`, and
`label`. `id` is the original contextual endpoint occurrence ID, not a new model
element. `displayOwner` is its nearest visible collapsed ancestor. Node/port/proxy
IDs are unique across the scene. Edge source/target IDs stay unchanged and resolve
to exactly one visible node, port or proxy. Bindings and labels retain the hidden
endpoint's actual source; selecting the proxy must not select a same-named port
on the container. Render an explicitly distinguishable boundary indicator.

Resolve the bounded contextual occurrence graph and relationships before applying
collapse visibility; charge hidden work against the existing semantic limits.
This is not an unbounded traversal exception. Expand removes the proxy and
restores the same endpoint. Edges between hidden descendants remain represented
by distinct boundary handles/loops. A proxy is display-only and never an admitted
semantic command target. Hide, as an explicit visibility operation, can hide its
incident relationships but must report their count; it is distinct from collapse.

## Routing request, result and failure behavior

Geometry remains client-side. Keep one generic TS router in the layout worker;
do not duplicate its algorithm in Rust or ask the language facade for coordinates.
Native/WASM tests compare semantic scenes; TS/browser tests qualify routing from
those exact scenes. Rust/TS schemas validate the authored policy and saved state.

Measure compositions first, apply checked user geometry, then build the routing
request from final absolute transforms, logical endpoint IDs, terminal points and
normals, containment chains, proxy owners, measured obstacle boxes and constraints.
Accepted binding context keys retain the logical occurrence ancestry separately
from visual boundary ancestry; a flat projection must not change the persisted
manual route frame or invent geometric boundary gates.
The request includes schemaVersion 1, revision, viewKey, scope/context identity,
package fingerprint and monotonic layout generation. Never reuse ELK route points
computed before user geometry was applied. ELK remains the placement adapter.

Result v1 carries the same context identity and one full path per logical edge,
with start/end terminal, polyline vertices, container gates and ordered segment
IDs; a shared-segment table lists the exact participating edge IDs. It also carries
label frames, extents, consumed work counters and structured diagnostics containing
affected edge/part IDs. Path endpoints are the measured terminal points. Remove
zero-length and redundant collinear vertices; do not remove meaningful gate,
constraint or branch identity. Full logical paths remain available even when a
shared segment is painted once. Logical edge/group/endpoint/label IDs hash context
and logical membership, not text, array position, coordinates or screen pixels.
Segment hit IDs include layout generation and path/segment ordinal; they are
ephemeral geometry addresses, never persisted label anchors or semantic IDs.

Use deterministic rectilinear visibility search with Manhattan distance and a
fixed bend penalty, stable coordinate/edge-ID tie ordering and explicit work
quotas. Route edges in stable ID order, independently of input array ordering.
Core segments are horizontal or vertical. A terminal lead may follow a non-cardinal
transformed graphic normal; the orthogonal core starts at the end of that lead.
Markers follow the first/last nonzero tangent, including custom reference anchors.

Obstacle geometry includes measured symbol content, headers, visible labels,
unrelated container envelopes and decorated terminals, expanded by clearance.
Do not treat an endpoint's entire ancestor interior as blocked. Derive the exact
ancestor/LCA chain and explicit geometric boundary gates outside headers/content.
Only those gates permit crossing an endpoint ancestor's outline. An unrelated
container remains an obstacle. Gates are geometry, not invented ports or junctions.
Actual delegation relationships remain separate edges to their actual ports.

Parallel edges get distinct lanes/hit paths, self edges a nondegenerate exterior
loop, and return/cyclic edges remain legal. Crossings can remain crossings with
distinct hits; routing does not assert electrical connectivity. Shared trunks
require equal non-null branchGroup, exact common source occurrence and compatible
style/marker policy. Never merge wires merely because they overlap or share a name.

Bounded routing maxima: 2,048 logical edges, 4,096 measured obstacle boxes,
512 distinct visibility coordinates per axis, 100,000 search expansions per edge,
2,000,000 expansions per request, 128 vertices per path and 32,768 total segments.
Existing semantic/node/depth/markup limits are additional ceilings, never relaxed.
All counts are checked before allocation. Coordinates remain finite within the
existing 1,000,000-unit extent. Quota exhaustion and impossible constraints are
explicit failures, not truncated output or straight-line fallback. A worker
watchdog can cancel work for responsiveness but cannot convert it into success.

All routes and geometry for one frame publish atomically. A failed request reports
its affected IDs and retains an explicitly stale prior frame with editing/reveal
targets revoked. No previous-view frame may be marked current. Late worker results
are discarded after source, view, scope, package, placement or resize generation
changes. Reset/disposal terminates workers and pending gestures appropriately.

## Shared segments and manual route interaction

Each nonshared segment selects its exact edge binding. A shared segment with
multiple members opens a keyboard-accessible chooser listing owner/context and
edge labels; duplicate names remain distinguishable. Enter selects one edge;
Escape cancels; no arbitrary first-edge selection. A single-member segment selects
directly. Shared starts/decorations use the same chooser. Highlight the selected
edge's complete logical path, including shared portions. Decorative gates and
trunks never acquire fabricated source ranges or command authority.

An explicit Edit route mode is available for one selected logical edge. Vertex
and segment handles support pointer changes and keyboard movement (1 unit,
Shift 10); Delete removes a selected manual waypoint, Escape cancels and Enter
accepts. The mode must distinguish route manipulation from selection, panning,
source-bound text interaction and semantic connection creation. Reset route
removes that edge's manual constraints and reroutes automatically.

Presentation v4 graph `routeConstraints` maps stable edge IDs to exactly
`{ frame, waypoints }`. Frame is the current logical endpoint LCA occurrence ID,
or the reserved root frame; positions are in that frame's local coordinates.
At most 32 ordered waypoints per edge, bounded finite coordinates. Source/target
terminals are always recomputed, never saved as endpoint replacements. Manual
points are hard constraints, excluded from automatic trunk sharing. A moved
ancestor carries its local points; changing endpoint hierarchy requires explicit
compatibility/reset. No same-named rebinding. Obstacles introduced over a manual
point produce a stale/error result and preserve the saved constraint bytes.

Presentation edits have a bounded separate undo history (64 entries per view).
Undo/redo controls act on route/label placement; model/source undo stays separate.
Ctrl-Z may target this history only while its explicit canvas edit mode owns
focus; Monaco keeps its source undo behavior. Saving a presentation edit cannot
allocate a model revision, analyze source or authorize a pending source command.

## Bound, independently movable text

Implement the reviewed core of the label proposal here, without the Symbol
properties inspector. An explicit Move label mode enables pointer drag and
keyboard movement (1 unit, Shift 10), visible focus, Escape cancel, Enter accept
and Reset label. Normal bound-text clicks still select/reveal the original part.
Move an entire logical block; wrapping fragments are regenerated, not saved.

Presentation v4 graph `labelPlacements` maps stable logical label IDs to a strict
union: `{ kind: "owner", dx, dy }` or
`{ kind: "route", fraction, tangentOffset, normalOffset }`. Owner placement is
allowed only for node/port or authored block labels; route placement only for edge
labels. Stable identity includes occurrence, authored graphic reuse path and
logical slot/block ID, never text, source line, wrap-fragment index or coordinates.
The current package/projection fingerprint guards authored definition changes.

Owner offsets are in the authored local text frame and follow owner movement,
resize/rotation and port repositioning. They never change terminal geometry.
Edge fraction is normalized distance 0..1 along the complete logical routed path;
offsets use its tangent/normal frame. At a vertex choose the following nonzero
segment, except fraction 1 uses the preceding segment. Rerouting recomputes that
frame by fraction rather than choosing a nearby screen segment. A drag projects
onto the full path with deterministic earliest-fraction tie-breaking. Validate
offsets/fit against existing extent limits. Unsupported/changed identities require
explicit reset, not nearest-label reassociation.

Moved labels participate in fit, extents, clipping checks and transformed hit
testing; long text remains inspectable. Edge markers and hit targets retain their
original binding/context. No optional leader-line feature is required in M14.
Resolve label/routing dependencies with a fixed measured placement pass followed
by at most three bounded route/label collision passes. A label's own edge is
exempt from its label box; other edges avoid it. Recompute fractional anchors
after every route change. If clearance/placement cannot settle, report the affected
labels/edges and retain stale state instead of an unbounded layout loop.

## Qualification fixtures and acceptance

Keep authored source fixtures distinct from the supplied Cameo screenshots.
Structural fixture: repeated inherited usages, replaced member, three nesting
levels, rotated directional ports, explicit delegation, parallel/self/return
edges, an intentional crossing and collapsed descendants. Action fixture:
nested actions, real directed parameters, initial/final, fork/join, data/control
flows and a return cycle. State fixture: nested/concurrent states, initial/final,
self/parallel transitions and separate bound trigger/guard/effect and entry/do/exit
content. Give repeated occurrences and duplicate labels different contexts.

| Case | Required proof |
| --- | --- |
| M14-01 | G0 actual bulk replacement, exact source bytes, clean analysis and undo/redo; retained root-cause evidence |
| M14-02 | Verified action/state rendering defaults, explicit compatible selection, inheritance, aliases, specificity and spoof/conflict refusals |
| M14-03 | Exact native/WASM action nodes, parameter endpoints, nested contexts, fork/join and data/control pairs |
| M14-04 | Exact native/WASM state groups, transition pairs, self/return cycles and bound trigger/guard/effect/entry/do/exit ranges |
| M14-05 | Measured routes clear unrelated bodies/content/labels with correct terminal normals and marker tangents |
| M14-06 | Deep boundary/delegation routing uses intended containment/gates, never a nearby same-named port |
| M14-07 | Exact logical edge set survives shared trunks; pointer/keyboard chooser reveals each correct binding |
| M14-08 | Parallel/self/return/cyclic paths remain distinct, deterministic and selectable; no DAG rejection or junction inference |
| M14-09 | Move/resize/rotate/port movement/collapse/expand retain exact logical endpoints, proxies and attachment |
| M14-10 | Manual bends, reset, independent presentation undo and save/reload preserve source bytes and endpoint IDs |
| M14-11 | Repeated bound labels move independently; wrapped paragraphs and rotated port labels retain source hits and wire attachment |
| M14-12 | Edge label fractional anchors survive rerouting and shared/unshared geometry, keyboard placement and reload |
| M14-13 | Explicit migration/export/reset preserves original v2/v3 layouts and v7 rules; stale identities cannot overwrite old bytes |
| M14-14 | Stale routing/layout/label/picker and source-command races cannot publish or authorize old targets |
| M14-15 | Impossible/manual constraints, bad packages/versions/references, malformed geometry and quotas fail atomically with affected IDs |
| M14-16 | M10/M12/M13, graph/grid/lane and independent FMEA regression suites pass; incompatible new semantic edits stay disabled |

Compare full semantic keys, context arrays, source ranges, IDs, endpoint pairs,
registrations and package fingerprints between native and actual WASM. Exclude
only snapshot-local elementId values across independent loads. For geometry,
assert every terminal, gate, segment/obstacle intersection and logical edge
membership, not nonzero counts or screenshots alone. Verify source-byte identity
before/after each presentation operation; intentional source edits must match
their exact expected full file. Use real layout workers, measured symbols and
actual language packages. Input/IO adapters may be controlled; model/scene results
may not be mocked for acceptance.

## Execution, evidence and completion

After review, create the isolated consumers and baseline their sources/artifacts.
Run G0, G2 and G1 before broad implementation; report an upstream gap immediately.
Implement strict shared contracts/migrations, semantic profiles/proxies, generic
router/hit picker, route and label editing, then Mercurio integration. Keep the
existing previews usable throughout. Update the unified harness capability view
with the implemented M14 cases and an actual SysML consumer entry.

Run changed native quick suites through the repository report runner, Rust fmt,
strict all-target Clippy, WASM builds/checks, TS/unit/schema/migration checks,
production builds and the applicable real browser flows. Full-library/native/WASM
scene equivalence and expensive fixtures stay milestone tests. Run the unchanged
M0 timing separately on a quiet machine; retain failures, no threshold waiver or
timing retries without a documented changed condition. Do not write tests that
merely duplicate implementation decisions; assert the external invariants above.

Freeze final immutable Views/KerML pins, update maintained locks and audit one
runtime identity plus exact installed NPM bytes. Rebuild the final checked pack
and WASM with the official compatibility/previous-part builders, never relabel
stale caches. Qualify the exact final artifacts. Record commands, outcomes,
source/package/pack/WASM hashes, retained failures, quotas, screenshots and any
unsupported cases in stage receipts. Audit original heads, all 17 working-file
hashes, M10/M12/M13 previews and preserved server/build artifacts again.

M14 is complete only when G0/G1/G2 and M14-01..16 pass on native/actual WASM/client
routes as applicable, all three repositories have one clean local milestone
commit and an isolated preview is available. Partial geometry, glyph demos,
token-only replacement or a new registration alone cannot satisfy completion.
Any required unqualified case remains outstanding; do not hide it as a supported
fallback or silently narrow this approved contract during implementation.
