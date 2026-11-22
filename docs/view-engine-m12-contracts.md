# M12 implementation contracts

Status: implemented and locally qualified M12 representations, 2026-11-18.
See [qualification evidence](qualification.md). The
[generation specification](view-engine-configurable-generation-spec.md) governs.
This document fixes the representations used by the feasibility implementation;
generated schemas and shared fixtures accompany their Rust/TS definitions.

## Preparation and identity

A presentation input supplies an explicit root package, a list of manifests and
a list of resource ID/content pairs. Manifests contain exact ID/version,
language namespace/fingerprint, required capabilities, dependency manifest
ID/version/hash and resource ID/kind/hash. Hashes cover exact UTF-8 resource
bytes and canonical serialized manifests. No URI is fetched by core. Preparation
resolves only the supplied closure and fails atomically on missing/conflicting
inputs, wrong hashes, capabilities or dependency cycles. Resource IDs are data,
not filesystem paths. Limits include all supplied input, not only used resources.

The prepared-language fingerprint covers the registered source identities and
content, rather than using the namespace alone as a schema identity. Preparation
can reference only the checked function cache supplied by that language. No new
metamodel, behavior module or native callback is loaded by a presentation input.

Install a package once on a new host, after protocol-v2 initialization and before
source analysis. Successful replacement requires a new host/session; failing
preparation may be retried without changing accepted state. The application
tears down the old session and retains its buffers. Package fingerprints are
separate from source revisions and occurrence IDs.

## Graphics and text

Symbol libraries declare qualified definitions, roles, typed parameters, typed
content slots, a root part, and an optional named connection anchor. A part has
an authored ID, optional visibility expression, local anchors and typed content.
Content variants are frame, stack, overlay, geometry, text, content-slot, reuse
and transform. Geometry consists of typed rectangle, ellipse, polyline or path
commands. There is no raw SVG/HTML/CSS/JavaScript. Transforms and local numeric
expressions are data, with finite limits and acyclic measurement dependencies.

Number parameters are constant-only at rule evaluation. String/Choice and Bool
parameters may use the registered unary functions. Definition reuse forwards
parameters and slots explicitly; references/cycles/types are checked before
rendering. Expressions read parameters and local box dimensions, never models.

Graphic instances contain the selected definition, evaluated parameter values
and slot mappings. Slot sources are existing title/subtitle/port labels,
compartments, nested children, regions, or named scene TextBlocks. They retain
the corresponding model bindings. Scene TextBlocks contain authored run IDs and
bound logical parts, supporting LF separators. Existing Label remains single-line.
Literal text has no binding/edit tool. Reflow fragments retain logical part IDs.

Node/port occurrences gain required nullable graphics and named TextBlocks;
edges gain required nullable start/end marker instances. Compartment rules and
occurrences gain stable IDs. The response carries one checked presentation
closure/fingerprint, deduplicated across occurrences. It never embeds a second
semantic store. Existing semantic occurrence hashes remain unchanged.

## Client and saved state

The generic client measures content, arranges parts, applies transforms to
geometry/anchors/hits, and attaches edges/markers to the resulting anchors.
Text and graphical hit parts resolve to trusted scene bindings. Graphical
grouping adds no semantic context levels or model objects. Legacy primitive
node-body styles map to equivalent checked built-in geometry compositions; the
legacy label/port and SVG-marker adapters retain their v1 presentation behavior.

Presentation v3 records package and projection compatibility alongside existing
graph node/port geometry or lane band order/viewport. Explicit migration previews
preserve source bytes; no silent version upgrade is accepted. M12 keeps the
current binary edge/routing semantics; shared trunks and general route editing
are outside this stage. Unknown graphics and failed layout leave the prior
display stale with source editing disabled, never a falsely successful partial
diagram.

Scene/rule envelopes become v6, protocol becomes v2, and the new package/library
documents use v1. Palette, Scope and ViewDocument remain v1. Grid/lane payloads
retain their semantics apart from envelope/presentation compatibility changes.
Pinned external consumers stay on the previous qualified runtime until M13.

## Sizing and measurement qualification

Definitions may declare minimum/preferred width and height. Width is chosen
before wrapped height is measured. `slotWidth` reads intrinsic content width;
`slotHeight` reads content height at the allocated local width, using the standard
content profile (14px body, 11px compartment heading). These expressions reference
only declared slots. Width constraints cannot refer to local allocated width,
height or wrapped slot height; height constraints cannot refer to unresolved
height. The dependency order is acyclic by construction rather than iterated to
an approximate answer. Invalid/unsatisfiable extents fail, without clipping.

Frame and geometry dash tokens are solid/dashed/dotted. Per-run fragments retain
logical bindings through translation/rotation; newline-only bound parts retain an
accessible hit. Defaults of every supplied definition receive the same checks as
instances, including definitions not selected by the current scene.

The proposed [movable bound labels](bound-movable-labels-proposal.md) and
[Symbol properties](symbol-properties-spec.md) are follow-up design work. The user
explicitly requested retaining Symbol properties as a proposal; neither is an
implemented M12 interaction.
