# Configurable view generation: staged specification

Status: **M12 implemented and locally qualified on 2026-11-18 under the user's
approval. M13 is locally qualified; M14 is approved and in progress.**
See [M12 evidence](qualification.md). This turns
the [vehicle exploration](sysml-vehicle-view-exploration.md) and
[configuration roadmap](configuration-roadmap.md) into staged contracts.
Private source checkpoint: `376b846cabe711151c421f743faf56ca1d33f75e`;
the [receipt](qualification.md) records the push and
independent clone verification. M0–M11 and their approved additions remain the
implementation baseline.

## 1. Outcome and scope

A package author defines reusable graphics and selects projections/renderings
to generate several views of one model. The same renderer build must draw the
selected SysML, electrical and fault examples from definitions, without
domain-specific drawing branches.

| Proposed stage | Deliverable | Repository boundary |
| --- | --- | --- |
| M12 | Loadable presentation definitions, reusable compositions, rich text, custom ports/markers and bound hit parts | Views only, including harness/FMEA fixtures; existing consumer pins retained |
| M13 | Model-defined rendering dispatch and a first SysML profile: compartment, parts-tree and interconnection projections of the same model | Views plus isolated KerML/Mercurio integration, after scope review |
| M14 | Qualified tree branching, nested routing and action/state topology | Shared Views capabilities and reviewed integration fixtures |
| Later specifications | View index/navigation, further SysML profiles, full language-package loading and declarative source edits | Scope assigned by those specifications |

M12 is presentation authoring, not completion of the language configuration
roadmap. Prepared semantic languages and Rust command providers retain their
current integration route. It must not be advertised as an unchanged binary
loading arbitrary new metamodels, grammars or edit providers. The full
definitions-first native/WASM host goal remains in the charter.

The SysML edition and normative requirement inventory remain to be selected.
These screenshot-derived cases are acceptance examples, not normative clauses.
Keep unsupported requirements visible. Analysis execution, verification execution
and state simulation are separate from generating their graphical views.

## 2. Invariants

- Model/Text retain storage, semantic execution, parsing/linking and source
  capabilities. Languages own domain interpretation and projections. The engine
  uses its existing abstract model/function interfaces.
- Semantic view functions remain read-only, cached and charged to the shared
  query/work budgets. No model query or domain algorithm moves into graphical
  expressions or the browser.
- The client measures text and computes geometry. The engine emits semantic
  content, occurrence identities, selected definitions and parameters, without
  laying out the diagram in pixels.
- Preserve contextual bindings/endpoints, exact receipts, candidate validation
  and transaction guards. Decorations do not create domain elements or change
  semantic ownership.
- Retain [decision 0001](decisions/0001-cross-language-models.md). Separate hosts
  do not establish cross-language model semantics.
- No Model/Text API change is assumed. Report a missing upstream capability
  before changing those repositories. Canonical dependency publication is
  separate from these private-workspace slices.

## 3. M12 presentation package

Introduce a versioned, data-only **presentation package** for an already prepared
language, distinct from the future complete language package. Its manifest has
an identity/exact version, prepared language namespace/schema compatibility,
required presentation capabilities, explicit resource IDs/hashes and exact
dependency identities/versions/hashes. Resources comprise symbol libraries,
graph rules, palettes, legacy notation inputs and projection registrations.
There is no implicit global search or latest-version selection.

The host accepts a manifest and an application-supplied resource map/resolver.
Core performs no filesystem/network access, credential lookup or automatic
download. Missing resources, duplicate IDs, dependency cycles, incompatible
schemas and unavailable capabilities fail preparation. Raw SVG, HTML, CSS,
JavaScript, external image URLs and native callback code are not symbol inputs.

The M12 acceptance fixture loads two independent presentation packages over one
prepared semantic language, using unchanged Rust host and browser builds.
Referenced functions must already exist in that checked language; unknown
functions fail preparation. Loading new semantic behavior modules is outside
this presentation-only contract.

Preparation is atomic: failure leaves the accepted package set unchanged.
M12 package replacement creates a new host/session rather than hot swapping
during a transaction. Tear down the previous worker/session, abort its candidate
and reject late replies; retain application buffers and reanalyze in the new
host. Tokens cannot cross prepared owners.

A package-set fingerprint covers ordered manifest identities, resource hashes,
dependency closure and prepared-language identity. Scene responses, validation
and saved-presentation compatibility use it. It is not a model element key and
does not silently advance source revision numbers.

## 4. M12 reusable graphical definitions

Add a `SymbolLibrary` document, schema version 1. A definition has a
package-qualified ID, exact version, role (`node`, `port`, `marker`), declared
parameters/content slots, composition and named anchors. All object variants
reject unknown fields. Rust and TS validators share fixtures and JSON Schemas.

| Generic part | Required behavior |
| --- | --- |
| Geometry | Rectangle/rounded rectangle, ellipse, line/polyline; bounded move/line/quadratic/cubic/close path commands; fill/stroke/width/dash tokens |
| Group/use | Ordered composition and qualified reuse with explicit parameter/slot forwarding; stable authored part names |
| Transform | Translation, rotation and finite nonsingular scale, applied identically to drawing, bounds, anchors and hits |
| Text | Bound runs, explicit breaks, paragraph wrapping, alignment, bounded font size/weight/italic tokens |
| Stack/overlay | Row/column/overlay composition, padding/gap, minimum/preferred size and explicit content allocation |
| Content slot | Ordered labels/rows, compartments, nested child nodes or regions supplied by the scene |
| Anchor | Named local point and outward direction, transformed with its owning composition |
| Hit part | Semantic role referencing an existing occurrence/label binding, or explicitly unbound decoration |

Names such as requirement, resistor or fault gate must be authored definition
IDs, never renderer dispatch cases. Validate imports, role compatibility and
reuse cycles before evaluation. Check arguments at each reuse site; missing,
unknown or wrong-type arguments fail. Occurrences do not share mutable graphics.

### Parameters and measurement

Support checked String, Bool, finite Number and finite Choice parameters.
Strings/Bools can come from constants or existing compatible read-only unary
functions. A Choice is a String checked against declared values; unknown values
fail rather than selecting a fallback. **Number parameters are authored
constants in M12.** Dynamic numeric Rcore results need a later typed-function
extension and feasibility evidence. Never parse label strings as numeric
parameters or imply today's adapter already supports numeric results.
Calculated values may still be displayed as bound text.

Graphical expressions reference declared parameters, measured slot bounds and
the assigned local box dimensions. Allow bounded arithmetic/min/max and
Bool/Choice selection only: no loops, model reads, I/O, callbacks or general
scripting. Division by zero, nonfinite results, invalid dimensions and singular
transforms are errors. This is graphical constraint evaluation, not a second
model-query language.

Measure intrinsic content, allocate a box, then arrange parts. Wrap at a
determined width with an explicit unbreakable-text policy. Constraint
dependencies must be acyclic: height can depend on wrapping at a fixed width;
width cannot simultaneously depend on that height. Reject unsatisfiable/cyclic
constraints and conflicting ownership of a dimension by child and slot.

### Content, text and bindings

Projection rules select compartments, rows, children and ports. Graphics arrange
the supplied slots without selecting additional model elements. Showing a
feature as both a row and a border port creates distinct visual roles with
their actual semantic bindings.

Add stable authored compartment rule IDs and evaluated compartment IDs in the
new graph contract. Preserve row IDs from their existing semantic tuples.
Slot item keys use those IDs, never label text or array positions.

Keep flat, separately bound label parts within each run. Introduce TextBlock
for runs, explicit breaks and paragraphs. Reflow produces visual fragments of
a logical part, not new semantic identities. Source reveal and qualified edits
still target that logical part; punctuation stays unbound and empty bound parts
retain accessible hits. Do not silently truncate text. Intentional elision
requires an explicit display policy plus full-text inspection.

M8 Label remains single-line. Multiline data uses TextBlock, not CR/LF/tab
smuggled through Label fields. Define LF separators in TextBlock inputs,
normalize CRLF at that boundary, and reject tabs in this first text profile.

### Ports and markers

A port definition supplies its body, local anchor, border attachment constraint
and outside-label slot. Direction/conjugation is a checked language-supplied
parameter. Rotation transforms anchors/directions without detaching a wire or
reversing semantic direction.

A marker attaches to an edge's start/end tangent with an explicit reference
point/size. Hollow/filled composition diamonds and triangles are library
compositions. Decorative marker parts normally share the edge's selection/reveal
target and do not become endpoint model objects.

M12 retains binary semantic edges. Shared connector branches, multi-terminal
relationships and route editing require M14/later contracts. Drawing a shared
segment must not fabricate a model junction.

## 5. M12 identity and compatibility

Preserve node/port/row/edge occurrence IDs when semantic rule, element, context
and role are unchanged. Derive graphical part IDs separately from occurrence,
qualified definition ID, authored reuse path, authored part ID and stable slot
item ID. Do not include text, geometry, version strings or array positions in
logical part identity. Definition fingerprints separately guard stale targets.

Graphic grouping adds no semantic context level. A bound hit resolves to an
existing validated binding/label part; a decoration has no invented source
location/edit tool. Commands recompute trusted scene targets; client geometry
is never command authority.

| Contract | Proposed change for review |
| --- | --- |
| SymbolLibrary / presentation package | New version 1 documents with explicit imports, parameter/slot types, roles and limits |
| Scene / rules | Version 6: graph adds graphic instances, compartment IDs and TextBlocks; grid/lane only change envelope version |
| Graphic instance | Definition reference, checked parameter values and named mappings to scene-owned content; no duplicate model store or arbitrary markup |
| Scene response | Include checked graphics resource closure/fingerprint, deduplicated by definition ID/hash |
| Presentation | Version 3 graph/lane union with package/projection compatibility identity; graph keeps node/port geometry, lane retains semantic-order authority |
| Host protocol | Version 2 capability negotiation and presentation-package setup; reject incompatible clients explicitly |
| Existing notation | Version 1 retained as legacy primitive-style input, mapped to equivalent built-in compositions |

Exact schemas, field names, nullability and shared accepted/rejected fixtures
are the first post-review implementation deliverable. No unvalidated JSON
catch-all or executable markup is an extensibility shortcut. Carry part and
fingerprint context through all affected focused targets, prepared commands
and responses, reusing the current transaction authority.

Preserve old scene/rule fixtures for version refusal. Provide an explicit,
lossless offline v5-rule migration preview for built-in mappings and authored
compartment IDs; migrate maintained harness/FMEA files in the milestone commit.
Never silently upgrade supplied inputs. A v2 presentation can be exported, then
explicitly imported with a preview reusing only valid node/port keys under new
minimum sizes. Acceptance writes v3; retain original bytes until then. Report
unmatched geometry and incompatible package/projection identities.

Color-only definition changes need not discard valid positions, but reuse must
be explicitly compatible with new measured roles/anchors. Do not promise
durable identity across rename/move beyond the existing key policy. Pinned
SysML consumers retain their qualified runtime until M13 coordinates new
contracts/protocol and rebuilds matching artifacts.

## 6. M12 limits and failures

Proposed bounds, enforced by both validators and tested at boundaries:

| Resource | Bound |
| --- | --- |
| Presentation resource closure | 64 resources, 2 MiB definition input |
| Definitions | 256 in checked dependency closure |
| Authored structure | 256 parts per definition, depth 16, reuse depth 8 |
| Parameters/slots | 32 each per definition; at most 64 values per Choice |
| Expanded graphics | 50,000 parts per scene, charged before allocation |
| Paths | 2,048 commands per path; 65,536 aggregate per scene |
| Text | Existing 4,096-byte logical-label and 32-part limits retained per run; 64 runs per block; 1 MiB aggregate scene text |
| Numeric geometry | Finite; absolute extent at most 1,000,000; positive dimensions and schema-defined stroke/scale bounds |

Supplement existing model/scene/VM/query/transport limits without raising the
16 MiB transport bound, semantic scene limits or M0's two-second/5,000-call gate.
Charge aggregate expansion before copying repeated definition trees; deduplication
does not exempt rendering cost. Fail rather than truncate. These bounds are not
performance guarantees.

Malformed resources fail preparation. Invalid evaluated parameters/content fail
the scene with package/definition/rule/part context. Layout/render failure keeps
the previous usable display marked stale and disables source editing there.
Never return a clean-looking partial view by dropping unsupported graphics.
Existing unresolved semantic-endpoint problems remain explicit under their
current contract, distinct from resolved topology assertions.

## 7. M13 model-defined rendering dispatch

SysML owns resolution of view inheritance, exposes, filters, viewpoints and
effective rendering. Core receives an opaque registered rendering/projection
identity and checked view/source bindings, without inspecting SysML classes or
guessing from human titles.

Register canonical language-owned rendering identities against a rule set,
symbol package and compatible layout policy. Resolve library identities through
the accepted dependency/source identity and actual linked declarations: a
user package with a standard-looking name must not impersonate the library.
Shared graphics code never compares labels to GeneralView or asTreeDiagram.

1. SysML semantics determines effective explicit/inherited rendering and lawful
   redefinition. Graph rules do not invent inheritance rules.
2. A supported explicit rendering selects its compatible registered projection;
   validate exposed kinds and required capabilities.
3. An unknown/incompatible explicit rendering produces a located diagnostic.
   Never silently substitute General/Interconnection and report success.
4. With no effective rendering, a language registration may supply a documented
   default for the view definition. Record default selection; absence of a
   compatible default produces an unsupported-view diagnostic.
5. Conflicts, unresolved rendering references, unqualified exposure/filter
   semantics and ambiguous selection remain explicit. A renderer cannot bypass
   these semantic checks.

Qualify three projections of one fixture with inherited/redefined features and
repeated nested usages: structured definition/usage compartments, parts tree
with relationship edges, and nested interconnection with ports. Projection
identity guards saved presentation even if view name/key is unchanged. Pure
visual configuration does not duplicate declarations or mutate ownership.

Native/actual-WASM cases cover explicit/inherited rendering, lawful redefinition,
absent-rendering default, conflicts, unresolved and unsupported requests,
misleading library names, and view/source changes during refresh. Current
type-based classification is the limitation to replace, not the expected result.

Read-only generation is the first acceptance route. Preserve existing compatible
commands; new semantic edits need their own qualified intent/source-realization
contract. A new glyph does not make an unsupported edit legal.

## 8. M14 routing and topology requirements

Complete and review the M14 contract before implementing it. Required cases:

- Shared tree trunks preserve distinct semantic edges, endpoints and hit targets.
  Clicking a shared segment needs an explicit selection/picker policy.
- Deep nesting and boundary/delegation ports route through intended containers,
  avoid bodies/content/labels and remain attached after resize, move, collapse
  and reload. Manual route constraints are presentation, not source changes.
- Parallel/self/return edges and cycles remain graph topology. Tree layout or
  routing must not impose laneGraph's DAG constraint on the language model.
- Action projections preserve initial/final, fork/join topology, parameters,
  data/control connections and nested actions. State projections preserve nested
  groups, transitions, trigger/guard/effect and entry/do/exit content. Drawing
  the symbols alone does not establish these semantics or their execution.
- Routing errors report affected relationships and stale state. Never connect
  to a nearby same-named port or silently introduce a model junction.

Edge-label anchors, route constraints/persistence, branch hit identity and exact
failure rules still require a completed stage specification. These requirements
do not authorize implementing an unspecified general router.

## 9. Feasibility and qualification

After review, M12 starts with three vertical proofs before broad implementation:

1. Reuse a compartment definition for two occurrences with distinct part IDs,
   correct bindings, wrapped documentation and stable reveal targets.
2. Render a rotated port and custom endpoint marker with correct attachment
   through measurement, resize and reload in a real WASM/browser flow.
3. Load alternate presentation definitions with the same host/client builds;
   prove native/TS parity and atomic refusal for bad packages, cycles and limits.

If a gate requires an unplanned upstream API, semantic-language loader or
transaction replacement, report it before broad implementation. Hand-authored
SVG/screenshots or mock-only tests do not establish these gates.

| Requirement | Acceptance evidence |
| --- | --- |
| CG-01 | Version/capability/resource validation, exact hash/dependency closure, missing/duplicate/conflicting inputs and atomic refusal |
| CG-02 | Reuse/parameters/slots/transforms; undefined inputs, bad Choice/Number values, cycles and expansion limits |
| CG-03 | Package tab, folded note, initial/final, fork/join, directed port and hollow/filled markers from compositions without domain dispatch |
| CG-04 | Requirement paragraphs and transition-style blocks; bound runs remain selectable/revealable after wrapping and resize |
| CG-05 | Repeated inherited symbols/ports retain contextual bindings and attached edges through transforms/reload |
| CG-06 | Separate electrical resistor/transformer-terminal and fault event/gate libraries using the same renderer; graphics qualification only |
| CG-07 | Explicit legacy-rule/presentation migration previews preserve originals and reject incompatible versions/keys |
| CG-08 | Package/session teardown, late replies, stale hit/command context and read-only failures preserve transaction authority |
| CG-09 | M13's three source-derived SysML projections and rendering-resolution cases with exact binding/topology assertions |
| CG-10 | M14 branch/routing/action/state cases after its complete specification is reviewed |

Run applicable Rust formatting, strict lint, changed quick suites through the
report runner, WASM, TS/unit/shared-schema checks and actual browser fixtures.
Retain graph/grid/lane and independent FMEA behavior as regression coverage.
Run unchanged M0 timing separately on a quiet machine; retain failures without
waiving or retrying the gate until green. Keep expensive pack/integration checks
at milestone boundaries. Receipts record exact source/package/build identities,
commands, results, supported cases and gaps.

Screenshots support visual review; binding/topology assertions and actual client
execution establish behavior. Reconstructed vehicle fixtures are identified as
reconstructions until the project's actual source/export is available.

## 10. Review decisions and current result

Review the M12 presentation-only boundary, vocabulary, constant-only numeric
parameters, versions/migration policy and resource bounds, plus the staged M13
integration scope. Optional native extensions and the full semantic/edit package
loader remain separate charter decisions, not implicitly solved here.

The private push and initial visual prototype are complete. The user approved
continuing M12 after viewing the prototype. M12 now implements the exact
contracts and passes the three feasibility gates above; the local qualification
receipt records supported cases, source/build identities and retained limits.
M13 is now locally qualified in the isolated consumer at Mercurio 89a4d55; its
exact result and retained limits are in that commit's docs/m13-validation.json.
The complete [M14 contract](view-engine-m14-spec.md) is explicitly approved and
implementation is in progress. Status and executed checks are recorded separately from
this specification.

## Follow-up idea: bound, movable labels

The user requested independently movable, source-bound text on 2026-11-18.
The [label proposal](bound-movable-labels-proposal.md) records presentation-only
offsets, stable logical identity, anchoring, reflow, reset and qualification cases.
It is not an implemented M12 capability; edge anchoring requires the M14 contract.
