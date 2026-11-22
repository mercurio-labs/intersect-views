# Configuration platform: proposed roadmap

Status: **draft for review, 2026-11-18**. This is planning after the qualified
M0–M11 foundation. This initial roadmap is historical; current stage status is
recorded below. Numbering, contract
versions and implementation scope will be assigned in reviewed specifications.
The [charter](repository-charter.md) supplies the proposed goal and boundaries.

The [Simple Vehicle view exploration](sysml-vehicle-view-exploration.md) maps
20 supplied screenshots to concrete generation cases, current source limitations
and proposed qualification slices. It also identifies the separate gap between
recognizing a model-defined view and honoring its rendering selection.

The [configurable generation specification](view-engine-configurable-generation-spec.md)
defines the staged direction. M12 presentation authoring and isolated M13 SysML
rendering/projections are now locally qualified. The complete
[M14 routing/topology contract](view-engine-m14-spec.md) is approved and its
implementation is in progress. Symbol properties follows under the user's
explicit goal. The initial gap matrix below records
the earlier design baseline rather than current qualification status.

## What is established

The [M0–M11 review](qualification.md) is the implementation baseline.
It proves bounded view evaluation, shared contracts/client, frozen-model
invocation, native QueryPlan, occurrence-specific bindings, graph/grid/lane
forms, isolated source transactions and two real consumer integrations.

Current source configuration is substantial but incomplete. Notation maps tokens
to four node shapes and fixed renderer structures. Ports have fixed square
glyphs. Language packages provide Rust commands and compile their own WASM
factories. Adding another package in the same pattern would test reuse but would
not prove definitions-only authoring or general graphical expressiveness.

## A. Requirements and language-package contract

First select the intended SysML edition and inventory its complete requirements
with stable source references. Define incremental qualification profiles while
retaining the remaining requirements in the matrix. Separately define electrical
schematic and fault-analysis reference cases. The examples below are proposed
tests of expressiveness, not claims about normative requirements.

Define a versioned package manifest: identity, namespaces, dependency versions,
required capabilities, definition entry points, behavior/query resources,
notation/view/tool resources, libraries and source/provenance metadata. Specify
loading, preparation, diagnostics, quotas and native/WASM resource adapters.
Package imports and capability negotiation must fail explicitly when required
definitions or capabilities are unavailable.

Specify a supported source-authoring route before promising declarative edits.
Identify any missing Model/Text API and propose work in its owning repository.
Do not assume a generic grammar-driven source generator already exists.

Done when the contract and requirement matrix are reviewed, each requirement has
an owner and evidence plan, and the definitions-only versus optional-native
extension policy is decided. No implementation is part of this design stage.

## B. Reusable graphical symbol definitions

Specify named, parameterized definitions and composition/import rules. Cover
bounded geometry/path primitives, groups/transforms, text measurement, intrinsic
size and resize rules, compartment/content slots, port glyphs and anchors, edge
markers, conditional parts, hit regions and per-part bindings. Define how
semantic parameters from view evaluation reach the renderer without introducing
a second semantic query implementation. Specify typed numeric, enum and Boolean
parameter contracts and quotas; the current sequence/Bool/String view slots do
not establish an unrestricted symbol-parameter API.

Specify the relationship among definition identity/version, occurrence IDs,
binding contexts, scene contracts and saved presentation. Cover nested reuse,
dependency cycles, resource limits, diagnostics and compatibility/migration.
Semantic geometry such as lane order/span must retain command authority.

Proposed qualification examples:

| Consumer | Package-defined example | Required evidence |
| --- | --- | --- |
| SysML profile | Structured element with reusable compartments, nested content, separately bound labels and ports | Correct bindings, dynamic content, resizing, anchors, source reveal and qualified editing |
| Electrical schematic | Resistor and transformer compositions, rotated terminals and junction symbols | Custom geometry and glyphs; reusable definitions; transformed anchors and attached wires |
| Fault analysis | Event and gate compositions with calculated labels | Definition composition, conditional appearance, distinct subpart bindings and analysis results |

Done when packages define these symbols using one unchanged renderer build,
with native/TS validation and real browser tests. New language-specific shape
enums or renderer branches do not satisfy this acceptance condition.

## C. Layout, anchors and connections

Specify the configurable layout/routing vocabulary and its adapters: attachment
points, orientation, nesting, compartment measurement, obstacles, connection
labels, branch/junction representation and manual presentation constraints.
State the supported cases and failure behavior precisely.

Electrical connectivity and fault relationships remain model semantics. The
package defines whether a junction is a model element, how terminals connect,
and which edits are legal. A graphical crossing must not silently create a
semantic connection. Rendering a multi-terminal relationship needs an explicit
model-to-scene mapping; existing binary edges do not establish it.

Done when the selected profile/reference cases retain correct connectivity and
bindings after layout, transforms, move/resize, persistence and source edits.
Deterministic scene evaluation and explicit quota errors remain required.

## D. Declarative interactions and edits

Specify tools, inputs, applicability, selection/hit roles, keyboard actions,
create/connect/delete intents and drag/resize semantics. Define a bounded edit
plan and its source-realization contract through the owning Model/Text APIs.
Preserve formatting/source identities according to an explicit supported policy.
Distinguish direct property edits from topology and multi-element changes.

Read-only view functions remain read-only. Editing must use an explicit command
route with full candidate validation, editable-source checks, exact buffer
receipts, atomic publish, token-scoped abort and revision/context guards. A
rejected operation changes neither the accepted model nor source buffers.

Done when the selected SysML, electrical and fault-analysis commands are
authored as definitions and execute through the unchanged generic native/WASM
host. Tests must cover refusal, stale context/tokens, newer typing, rollback,
undo/redo and model/source consistency. Existing Rust providers remain qualified
until replacements prove equivalent behavior; their presence is recorded.

## E. Independent consumer and coverage qualification

Load the packages through one generic native build and one generic WASM build,
using separate prepared instances under the current cross-language decision.
Choose at least one reference package authored without knowledge of its renderer
implementation, to expose hidden integration assumptions.

Complete the requirement matrix with explicit statuses: unsupported, imported,
consumed, implemented and semantically verified. Each supported row names its
package definitions, runtime capabilities, fixtures and native/browser results.
The selected SysML scope must have no unexplained gaps before a corresponding
conformance claim. An electrical or fault-analysis demonstration qualifies only
its stated profile and calculations.

Done when the advertised authoring route is reproducible from a fresh checkout
and adding these package definitions needs no domain-specific application/core
changes. Performance and resource measurements must use representative fixtures
and preserve the unchanged M0 gate; they do not imply arbitrary-model guarantees.

## Initial gap matrix

| Capability | Current evidence | Work still needed |
| --- | --- | --- |
| Semantics and textual definitions | Prepared metamodel/grammar/bindings, Rcore and native queries | Full selected SysML requirement audit and package-level dependency/capability contract |
| Reusable notation | Named styles and rule-defined structure | General symbol definitions, geometry composition, slots, transformed anchors and custom port glyphs |
| Views | Graph/grid/lane, regions and bound labels | Profile coverage and any new generic projection/form capabilities established by requirements |
| Connections | Contextual binary edges and basic routing | Configurable routing/anchor contract and explicit topology/junction projections |
| Editing | Rust language providers plus shared transactions | Declarative intent/edit plans and a qualified source-realization route |
| Host loading | LanguageDefinition Rust API and per-language WASM factories | Portable package manifest/loader and unchanged generic binaries |
| Domain analyses | FMEA RPN and package-owned navigation examples | Qualified analyses for the chosen domain profiles; extension policy for unsupported operations |
| Models spanning languages | Explicit deferred decision | Separate composition, identity, scope and transaction specification when authorized |

Source publication can prepare the current bounded foundation while this design
work proceeds. It must describe the gaps above accurately. The publication plan
does not authorize stages A–E implementation, upstream changes or a registry
release.
