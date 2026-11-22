# Architecture

Shared frozen parse/link/completion/validation orchestration and diagnostics are
implemented once by Text's `intersect-load`. This graphical host consumes it and
retains candidate transactions, graphical identity and scene publication. The
compatibility `intersect_view_host::load` module reexports the neutral API; a
headless language runtime depends directly on Text's loader instead of this host.

The harness owns its grammar, metamodel, bindings, view functions, rules and
notation. Host::new prepares these sources once, checks the rules and caches
their referenced SourceModelFunctions. Analyze accepts source buffers, loads and
checks a candidate, then publishes a clean frozen model plus one initialized
FrozenStore. Project documents are retained without being parsed as model text.

The engine sees only opaque ElementIds, ViewModel, ViewFunctions and contracts.
It computes roots from ordered scope, renders nodes in preorder with enclosing
element-key contexts, then resolves edges through a context/element endpoint
index. It emits no geometry. Limits fail rather than truncate. The host's one
QueryBudget covers all Rcore invocations in a scene. Engine tests use no Rcore.

Reference edges have no model element. Their synthetic hash identity encodes
source key, source occurrence context and target key. Including the source
context is necessary when repeated source occurrences both reference one root.
Bindings retain the source occurrence's context. Rows carry IDs as required by
the symbol algorithm; view detail fields remain separate. ViewModel.class_is_a
lets the evaluator rank rules without depending on Model's metamodel types.

The browser runs the same host through three WASM exports: input_buffer, execute,
output_buffer (plus linear memory). The export_host macro and WasmTransport are
generic; the harness supplies only a Host factory. Requests are bounded at
16 MiB, then the host enforces model/document input limits. The application owns
I/O, workers, source buffers, local storage and revision allocation.

ViewSession injects HostClient, BufferAdapter and a SceneSurface. It holds clean
analysis, selected view, per-view Exploration, refresh/cursor sequence guards,
and one pending transaction. View, scope, palette and source revision define
the asynchronous request context; refresh revokes editing before requesting the
catalog. Once an edit is applied, its source revision owns commit/rollback, so
later view navigation cannot undo it or overwrite newer typing.
BufferAdapter.apply must synchronously apply the
whole validated batch as one undo group, enforcing editability; undo must restore
that group. reserveRevision advances the allocation clock without changing the
current buffer revision; publish accepts a clean committed revision. Typing must
allocate a newer revision and call invalidate. The adapter's sources are the
complete receipt sent on commit. This session currently accepts one patch per
URI (explicit refusal of duplicate-URI batches), matching the ported provider
shape; multi-edit normalization requires a future contract decision.

Notation accepts only fixed shape/line/marker enums, safe color tokens or hex,
bounded glyphs and numeric radii. SVG text/attributes are escaped; no executable
markup or external URL is interpreted. Layout and rendering remain client-side.
Presentation changes and scope changes do not edit model source. The harness
page saves JSON to local storage or exports a download; it has no filesystem API.

M6 preparation uses the same immutable candidate loader as analyze. A pending
candidate contains its own frozen model, initialized store, navigation, source
buffers and analysis. Prepare changes none of the published baseline. Every
patch URI must be editable model source; the host verifies ranges and whole
buffer hashes. Commit requires the token, base revision and exact complete
project buffer receipt, including non-model documents. Only then is the candidate
published atomically. Analyze invalidates pending tokens; abort is token scoped.
One pending edit is allowed, with monotonic `edit:<revision>:<n>` identities.

Commands are language-owned Rust. CommandContext supplies the rule-authorized
command ID, frozen model, source buffers, named keys and scene occurrence bindings.
Harness end paths are derived from those bindings, not from a global name search.
They support a direct part, owner pin or direct part pin; cross-owner occurrences
and deeper paths are explicitly refused. Insert_member uses Text's lexer and
assumes a body ending in `}` or `;`, preserving CRLF and UTF-16 patch positions.

Create rules associate tool IDs, command IDs and owner Bool predicates. Connect
rules associate command IDs and source/target Bool predicates. A supplied palette
connect tool maps by its command; the default palette uses edge rule IDs as tool
IDs and generic name inputs. A language palette supplies richer inputs/placement
hints (the harness's Pin tool uses border placement). Target responses contain
revision, viewKey, toolId, nullable source symbol and ordered symbol IDs. With no
source they identify legal connection starts; with a source they identify targets.
Narrow endpoint predicate receiver classes exclude incompatible classes without
invoking the VM. Creation predicates must accept their node rule's match class.
Hints exclude read-only bindings; prepare rechecks them. Candidate analysis is
the authority for full language legality. Issue code/message/feature map directly
to rejection fields, with the candidate object's element key when available.

The browser applies diagram patches synchronously in one undo group, retains
typing revision guards, and reanalyzes source undo/redo. Source and exploration
undo are separate. It makes no SysML, durable rename identity, notation
conformance, deployment or production performance claim.


M7 scenes are a strict graph/grid union at version 3; rule sets use version 2.
Graph scenes require explicit layout hints. Grid wire data carries axes and
sparse cells only. Axis IDs, cell IDs and relation-member IDs hash separate
role tuples with the view/rule identity; all bindings retain real source ranges.
Query cells bind their subject, reference values additionally bind the target,
relation cells bind their first member, and derived cells bind the row. The
contract enforces these distinctions, portable int64 strings and finite limits.

The host prepares native Model QueryPlan templates against its exact schema,
adds a reserved __element projection using Field("$id"), and rejects unsupported
paths/types before accepting rules. There is no second query evaluator. A scoped
ModelRead exposes only ordered candidates through enumeration/lookup while
reference/class/value reads delegate to the complete accepted FrozenStore.
Native query and adapter quotas each reserve at most half the remaining scene
budget, capped at 100000; both actual read counts are charged before VM calls
continue against that same ledger. Overflow/exhaustion fails without truncation.

Grid scope applies ordered addSeed/hide/removeSeed over flat roots. Expansion
and collapse fail explicitly. The generic GridQueries interface returns typed
projections and opaque element handles; the engine never imports Model or Text.
A table uses those projections directly. A matrix calls related/select per row
and column/label per relation member, intersects visible columns, verifies equal
occupancy/provenance sets, then emits cells in axis order. It never calls a
semantic function for every Cartesian coordinate. Core evaluation has no I/O.

Grid prepare recomputes the scene, resolves row/column/member IDs, verifies
ownerKey against the row, writable flags, palette/rule command mapping and Bool
predicates, then supplies a typed GridCommandTarget to the language provider.
The M6 candidate loader, one-pending-edit rule, exact complete buffer receipts,
token-scoped abort and atomic publication are shared. Harness providers verify
Space ownership and Trace endpoints independently. Delete removes only the
selected declaration span; parallel Traces are never interpreted as delete-all.

ViewCanvas routes graph responses to DiagramCanvas and grid responses to
GridCanvas. ViewSession stays independent of the DOM; it guards focused target
replies by revision, view, scope, request and coordinate/member identity. The
DOM surface adds its own sequence guard when focus/actions change. GridCanvas
mounts at most 40 rows by 20 columns plus headers and one retained focused cell,
restores keyboard focus after scrolling, and caches only transmitted sparse
cells. Empty coordinates have no fabricated binding. All strings use textContent.
Clipboard writes belong to the application's optional copy adapter. Grid focus
and scroll are transient per-view state and never enter graph Presentation.


M8 graph scenes use v4 and all rule sets v3. Regions are actual containers with
Group bindings, headers and child nodes; their keys extend occurrence contexts.
Only nodes/ports enter the endpoint index. Direct/region memberships are disjoint
per owner; selectors deduplicate before rendering. Region collapse retains its
header and suppresses children in just that context.

Graph labels are flat parts with explicit nullable bindings/edit tools. Their
IDs hash view/rule/owner/slot/template/subject tuples independently of text and
layout. A selected Kind or End may bind a label without being a graph endpoint.
The host recomputes the current scene for labelTargets and prepareCommand,
resolves the exact label template and hash, checks action command/gesture,
subject writability and its Bool predicate, then supplies LabelCommandTarget.
The primary decorated binding supplies ownerKey. Literal parts cannot edit.
The language provider replaces a Field numeric token using Text's lexer and
preserves comments, CRLF and UTF-16 boundaries. M6/M7 transactions remain shared.

The layout adapter composes immediate child ELK layouts into measured row/column
bands. Regions and parts have ephemeral geometry; Presentation persists node/
port geometry only, relative to the immediate visual parent. Member drags clamp
to their band. Owner resizing retains untouched root placements before composing
again. Absolute ports and edge paths use the resulting geometry. This is bounded
partition composition, without a general obstacle-avoidance guarantee. Full labels
are measured, empty bound parts have accessible hits, and incompatible regional
owner shapes fail explicitly while retaining the last usable notation.


## Current lane and integration profile

Scenes/rules are now v5; the preceding M7/M8 version descriptions record their
historical milestones. Presentation v2 is a strict graph/laneGraph union. Lane
scenes contain source-bound flat lanes/Steps, ranks, predecessors, spans and stable
order, with no geometry. The engine computes bounded stable Kahn order and rejects
cycles, foreign visible-container references, backward spans and partial bands.
M8 label evaluation and focused label command checks are shared across forms.

The host validates all lane selectors and nested label/condition/edit functions
at initialization. views/laneTargets echoes a focused revision/view/tool/Step/
Lane/gap/end request. Prepare recomputes the trusted scene and supplies a typed
LaneCommandTarget; no graph Node is fabricated. The harness's lexical provider
checks all affected Steps, preserves token gaps/comments/line endings, and rewrites
a total chain through one source patch. Other languages own their command policy.

LaneCanvas measures complete labels, assigns semantic rank slots and lane bands,
and draws spans on deterministic secondary tracks behind events. Both orientations
use the same typed placement form and source transaction. The form warns about
the harness policy via palette data. Presentation stores only lane order and
viewport; no Step geometry/rank/span is persisted. Late target replies are guarded
by request, revision, view, scope, palette and exact target echoes. Source undo
and later typing retain ViewSession's existing authority. Legacy layouts are
refused with an export/reset message and remain stored until explicit replacement.

PreparedLanguageProvider, SourceLoader and ModelViews allow a language-owned
standard library, archive metadata and model-defined views without duplicating
analyze or transaction logic. Cached source functions use the approved checked
Model batch API and retain one exact prepared owner/schema and paired Text/Model
identity. Read-only reference sources remain separate from complete editor receipts.
The SysML adapter owns semantic navigation and dynamic palette name suggestions;
core has no SysML class/feature dispatch. Final consumer evidence is in m10.md.


Source-to-view lookup gives linked references priority, then selects the smallest
containing object extent. Among equally small extents it prefers objects with a
configured non-empty name, preventing anonymous parser wrappers from hiding a
named declaration with the same source span. Smaller anonymous declarations keep
their own bindings. This rule uses language registration data, not class names.
