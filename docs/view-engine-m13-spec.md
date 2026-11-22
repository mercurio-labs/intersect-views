# M13: model-defined rendering and three SysML projections

Status: explicitly approved for implementation by the user on 2026-11-18.
This specifies the choices left open by section 7 of the staged specification;
M13 implementation starts with the native semantic-resolution gate. M12 stays qualified
at `efd14d0` in its original checkout.

## Outcome and scope

One accepted SysML model produces structured definition/usage compartments, a
parts tree with distinct relationship edges, and nested interconnection with
contextual ports. Effective model-defined rendering selects its projection.
Changing representation never duplicates declarations or changes semantic ownership.

Only Intersect Views and isolated KerML/Mercurio integration are in scope.
Model/Text APIs, standard-library source contents, originals and release branches
stay unchanged. Reuse the approved immutable M10 Model/Text pair. A missing upstream
capability must be reported before changing those repositories. M14 routing,
shared trunks, route editing, action/state topology and execution remain separate.
Movable bound labels and Symbol properties remain proposals; Symbol properties
was expressly deferred by the user.

## Baseline, ownership and isolation

| Repository | develop base | Qualified prerequisite |
| --- | --- | --- |
| Views | 376b846 | M12 efd14d0 |
| KerML | 86fb572 | M10 d27c0d8 |
| Mercurio | 55ae88d | M10 a6bae8f |

Each prerequisite is a descendant of its develop base. Create branches explicitly
from develop, then advance to the qualified prerequisite without merging release
branches. `codex/view-engine-m13` is isolated under the current task's C: `m13/views`
directory; the earlier `.worktrees/views-m13` draft is preserved detached. The
original Views checkout and live harness remain on M12. Isolated KerML/Mercurio
M13 checkouts under the same C: task root were created after approval. Preserve dirty originals, linked worktrees and M10
artifacts; the baseline receipt records source/status hashes.

Model/build-support remain at `9ebf0d1d168d2de8e8d5f4f0b340a140b0328496`, paired
Text at `4247679db656caa3126ae3282ca66b644d97300f`. Continue the M10 exception for
full immutable local Git pins in isolated consumers. No mutable sibling path,
second runtime identity, archive recovery, push, merge, installer or server change.
Update every maintained Cargo graph and exact NPM resolved ref together. Public
registry/canonical dependency migration is separate work.

## Semantic resolution and the first feasibility gate

KerML/SysML owns effective membership, typing, specialization, redefinition,
exposure, filtering and rendering references. Extend its checked read-only Rcore
navigation functions over the existing accepted frozen model, cached and charged
through ModelViewContext. Native glue maps verified targets to registrations;
it does not implement a parallel inheritance resolver. Mercurio and the canvas
never parse source or compare human names to choose a rendering.

The pinned metamodel marks ViewUsage/ViewDefinition.viewRendering and
ViewRenderingMembership.ownedRendering/referencedRendering as derived. An empty
stored value is not evidence that no rendering exists. Resolve effective members
from stored memberships/ownedRelatedElement, typing, ReferenceSubsetting and
Redefinition using qualified language semantics. The effective rendering
membership has cardinality at most one. A local declaration does not win merely
because it is nearer; only lawful redefinition replaces an inherited feature.

Before broad implementation, prove explicit selection, inheritance, lawful
replacement, unresolved reference and competing-membership refusal in a native
compiled SysML fixture. Use existing grammar/validator syntax, not constructed
JSON or copied ASTs. If public frozen APIs or checked source functions cannot
express the resolution, report the exact missing capability before proceeding.
Never bypass linking, admission, pack checks or source receipts.

## Canonical identity and dispatch

At checked library preparation, build an immutable canonical declaration map
from accepted library ownership, exact source identity/content and actual linked
handles. Find declarations only inside those verified sources. Resolve targets
in each accepted model to that map. Display names, URI prefixes, project read-only
flags and stale object indices are insufficient authority.

| Effective request | Registered projection | Supported profile |
| --- | --- | --- |
| Verified Views::asTreeDiagram | sysml.partsTree | Named supported PartUsage roots; distinct containment edges; layered DOWN |
| Verified Views::asInterconnectionDiagram | sysml.interconnection | Named PartUsage roots; nested parts/ports/connections; layered RIGHT |
| No rendering, verified GeneralView ancestry | sysml.compartments | Supported named structural definitions/usages and bound compartments |
| No rendering, verified InterconnectionView ancestry | sysml.interconnection | The interconnection profile above |
| Unknown explicit request, conflicting candidates/defaults or incompatible content | Unsupported | Located diagnostic, no substitute scene |

GeneralView has no explicit rendering in the pinned StandardViewDefinitions
source. Its compartment default is an explicit language-profile policy, not an
invented standard rendering. Explicit compatible selection precedes type-based
defaults. Record the default's origin. Never fall back from an unsupported
explicit rendering to General/Interconnection. Custom renderings are recognized
only when qualified semantics proves one compatible registered ancestor.

Keep the bounded M10 expose profile. Unsupported imported/aliased/recursive
exposes and unqualified filter semantics remain located refusals; do not ignore
filters and report success. Validate supported roots and capabilities first.
A misleading user package named StandardViewDefinitions/Views cannot impersonate
a library, while a genuine linked alias retains the actual target identity.

## Registrations and observable resolution

Add a strict RenderingRegistry v1 presentation resource with required capability
`views.rendering.v1`: qualified registration IDs, exact rule-set IDs and compatible
generic projection policies. Package identity covers the resource and closure.
Unknown fields/versions, duplicates/conflicts, missing rules, incompatible policies
and unavailable capabilities fail atomically. It adds no queries or callbacks.

The prepared language owns semantic-ID-to-registration policy. A presentation
cannot impersonate a library or remap canonical tree semantics to incompatible
nested topology. The host verifies the language's expected policy against the
accepted registration, rule set and package. Drawing uses opaque IDs only.

Add `views/rendering`, request `{revision, viewKey}`, with a strict v1 response:

- schemaVersion, revision, viewKey and status: resolved/unsupported/unmanaged.
- Required nullable selection: registration ID, rule-set ID, package fingerprint,
  projection policy, origin (explicit/inherited/default), actual origin Binding
  and required nullable canonical-rendering Binding.
- Located diagnostics: opaque code, bounded message and accepted Binding.

A default has null canonical-rendering Binding and identifies the verified
view-definition policy in its origin Binding. Explicit/inherited choices retain
both the origin and canonical target. Revalidate every Binding against accepted
model/source ranges. Retain the 500-view limit; bound diagnostics to 32 per view
and messages to 4096 UTF-8 bytes.

Extend native ModelViews results to represent resolved and unsupported model
views separately. Unsupported views stay in the catalog, without a fabricated
General rule document. Their scene/target requests fail; other valid views remain
usable. Ordinary non-model ViewDocuments are unmanaged and keep existing behavior.

Recompute resolution for scene/command preparation. Client metadata is not command
authority. Existing revision/view/scope/selection/fingerprint guards and ViewSession
sequencing discard stale resolution, scene and target replies after changes.

## Three projections and generic tree topology

Language-authored rules use the single semantic navigation layer and M12 composed
symbols for titles, types, attributes, ports and bound rows. No SysML drawing branch.
The same feature can be a row in one view and a port in another with its real binding.

Add an explicit graph-rule projection policy: nested or containmentTree. Evaluate
ordinary contextual child occurrences first. containmentTree then flattens the
selected part-child hierarchy into graph roots and emits one relationship per
parent/child occurrence. Preserve node/port/row bindings and original occurrence
contexts; visual flattening must not reset inherited occurrences to root context.

Tree edge IDs hash view/rule/role plus parent and child occurrence IDs, never
labels, positions or array order. Their source Binding is the represented child
feature/usage declaration in its context. They are projection relationships,
not new domain elements, connectors or junctions. Authored rules declare their
edge role/notation. Charge existing node/edge/depth limits before allocation;
collapse/hide remain occurrence-specific. Failures leave a stale view, never
successfully drop unsupported relationships. Do not impose laneGraph DAG rules.

Interconnection preserves contextual binary endpoints. Tree edges have distinct
hits; shared trunks/branch picking and general obstacle routing belong to M14.

## Versions and saved layout

Proposed minimal boundary: rule-set envelope v7 adds the projection policy
(nested for existing forms; containmentTree only for graph). Scene v6, protocol
v2, ViewCatalog/ViewDocument/Scope v1, graphics/package v1 and Presentation v3
remain. Registry and rendering-resolution responses are strict v1. Old hosts
refuse the required capability instead of ignoring new fields.

Provide explicit v6-to-v7 rule migration inserting nested policy and retain old
fixture bytes/version refusal. Existing v3 saved layouts already guard package
and projection/rule identity. Changing rendering under an unchanged view key
must reject incompatible geometry, preserve old bytes for export and offer explicit
checked migration/reset. M10 v2 sidecars use the existing explicit v2-to-v3 path.
No silent geometry reuse, source rewrite or sidecar overwrite.

## Acceptance cases

Use one authored multi-file SysML fixture with base/derived definitions, a replaced
inherited feature, repeated usages, two nesting levels, directional ports and real
connectors. Three view usages share its accepted model/revision: General default,
inherited asTreeDiagram and inherited asInterconnectionDiagram. Mark it as an
authored qualification example, not original Cameo Simple Vehicle source.

| ID | Native and actual-WASM acceptance |
| --- | --- |
| R-01 | Explicit compatible rendering selects the registered projection |
| R-02 | Inherited rendering records its actual origin |
| R-03 | Lawful redefinition replaces the inherited choice; proximity alone does not |
| R-04 | Absent rendering uses and records the documented verified default |
| R-05 | Unknown explicit rendering, competing candidates/defaults are located refusals |
| R-06 | Unresolved references remain located linking/selection diagnostics |
| R-07 | Lookalike packages cannot impersonate canonical declarations; real aliases work |
| R-08 | Unsupported filters/exposes/roots/capabilities cannot produce clean fallback |
| R-09 | Three projections preserve source bytes and distinct inherited/repeated contexts |
| R-10 | Tree edges match exact parent/child pairs; interconnection matches exact port occurrences |
| R-11 | Same-key rendering changes reject incompatible layout and preserve exportable bytes |
| R-12 | View/source changes during refresh discard stale resolution/scene/targets |
| R-13 | Compatible M10 editing/undo/receipt flows pass; unsupported intents are explicitly disabled |
| R-14 | Shared Rust/TS/schema registry/version/hash/closure/limit failures are atomic |

Compare exact semantic keys, contexts, source ranges, endpoint pairs, registration
IDs and fingerprints, not screenshots or nonzero counts. ElementIds are transient
across reparses: compare them only within one accepted snapshot. Reuse packs only
through checked compatibility/previous-part builders; never relabel stale caches.

## Execution and completion

1. Review this contract, especially the rule-version boundary and isolated
   immutable-pin exception, before runtime source changes.
2. Prove real native rendering semantics; stop for an upstream capability gap.
3. Add shared registry/resolution contracts and generic tree projection, then
   integrate all three projections natively in isolated KerML.
4. Build its actual WASM/checked pack and isolated Mercurio consumer. Qualify
   R-01 through R-14 plus compatible M10 commands and existing Views/FMEA regressions.
5. Run formatting, strict lint, report-runner quick tests, WASM, TS/unit/schema and
   production builds. Run unchanged M0 timing separately on a quiet machine and
   retain failures. Pack/full integration checks stay milestone-only.
6. Pin final immutable Views/KerML revisions and maintained Cargo/NPM locks;
   audit one runtime identity and original-checkout preservation. Record exact
   source/package/pack/WASM hashes, commands, outcomes and limits.

M13 completes only with source-derived selection and all three projections
qualified natively and in the actual client. A registry, glyph demo, mocked
provider or type-only fallback is insufficient. Keep one local milestone commit
per affected repository; no merge, push or public release.

## Audit references

The [baseline receipt](qualification.md) records exact heads, dirty-file
hashes and source inputs. Relevant pinned library declarations are
Views.sysml lines 23, 130 and 138 and StandardViewDefinitions.sysml lines 7 and 24.
M10's type/name shortcut is view-navigation.rcore lines 137–143; its ModelViews
catalog is view_engine.rs. These sources were inspected, not semantically qualified
as M13. The new semantic feasibility gate remains required.
