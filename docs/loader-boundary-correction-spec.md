# Shared loader and compiler-cache boundary correction

Status: explicitly approved for implementation, 2026-11-18. The user replied
"approve" after reviewing this completed contract. Implementation and qualification
are in progress; this document does not claim acceptance gates have passed.

## Problem and intended result

Headless `intersect-kerml` currently requires `intersect-view-host` to obtain
language-neutral frozen loading and diagnostics. View host also requires the view
engine and contracts. Its complete source identity participates in KerML's
program compiler identity. A graphical transaction or publication change can
therefore invalidate a language program cache. This entered with M10 and remained
in M13; see [the inspected evidence](qualification.md).

Extract the existing loader without duplicating it. Headless language loading
must have no normal or build dependency on Views crates. Graphical preparation,
commands, persistent graphical identity, scene publication and browser interaction
remain in Views. Cache compatibility remains checked and fails closed.

## Ownership and dependency direction

Create an unpublished, WASM-compatible `intersect-load` crate in the Text
repository. It depends on Text, Model and the existing small serialization/runtime
dependencies actually used by the loader. It has no Views, language-package,
application, filesystem or network dependency. This placement reflects its text
construction/linking/completion/validation responsibility.

The resulting directions are:

```text
KerML language runtime ----------> intersect-load -> Text -> Model
Views host -> Views engine
          -> intersect-load
KerML IDE integration -----------> Views host + KerML language runtime
Mercurio -----------------------> KerML IDE integration + Views client
```

Physical repository placement is not a runtime dependency. The Text runtime must
not depend back on `intersect-load`. No new public repository or registry product
is introduced by this local correction.

Move the current `intersect-view-host/src/load.rs` implementation and its
provenance into the new crate, retaining the existing public signatures and
semantics for `FrozenLoad`, `LoadDiagnostic`, `LoadPhase`, `load_frozen`, `check`,
`violation_code` and `violation_object`. View host may retain compatibility
reexports under `load`; KerML imports the neutral crate directly. View-host
adapters such as prepared graphical-host initialization can call the neutral
loader without migrating their graphical policy into it. There must be one
implementation of parse/link/implicit/default/validate/check orchestration.

## Compiler identity and the necessary upstream scope

Extraction alone is insufficient: the current Model-owned build-support emitter
also hashes the available whole-workspace Cargo manifest and lockfile. KerML's
owned identity can consequently change when only its Views dependency pin changes.
The existing helper has no scoped-context mode. Do not work around this by
copying its scanner into KerML, disabling pack checks or supplying a constant key.

Add a host-only scoped identity API to `intersect-build-support`, reusing its
single source scanner. Retain the existing `emit` entry point and conservative
behavior for callers that do not opt in. Model and Text runtime APIs remain
unchanged. This explicitly expands M14's frozen upstream source boundary only
for build support, the new loader package, their pairing manifests/locks, tests,
and documentation. It requires separate approval before upstream source edits.

The scoped identity contract is:

- Hash the owning production sources, recursively embedded inputs, build script,
  package identity, enabled owning features and identity-policy version.
- Include the resolved relevant normal/build dependency context: immutable source
  identities or source revisions/checksums, versions, effective features and
  target distinctions that affect compiler/loader behavior. Relevant transitive
  dependencies and build/procedural dependencies cannot be omitted.
- Normalize paths and ordering. Moving an unchanged qualified checkout must not
  change its identity. Unrelated workspace packages and unrelated lock entries
  must not contribute to the semantic compiler key.
- Workspace manifests/locks may remain rebuild and freshness-validation inputs.
  An unrelated change can trigger recomputation without changing the resulting
  semantic key. Excluding bytes from the key does not mean ignoring their ability
  to change dependency resolution or effective features.
- Any separately prepared dependency-context record must be checked against the
  current manifests, lock, target and feature configuration before use. Missing,
  stale, incomplete or ambiguous context refuses scoped mode. Do not assume
  owning `CARGO_FEATURE_*` variables describe dependency feature unification.
- Do not invoke a recursively locking Cargo build from a build script. Any
  metadata preparation belongs in an explicit host preparation step, with direct
  Cargo build behavior documented and tested.

First prove this policy with small independent build fixtures before changing
all integration pins or rebuilding full language packs. If a safe context cannot
be established, stop with that failed gate; a source-only hash is not acceptance.

KerML's program component list replaces `intersect-view-host` with
`intersect-load`. Compose the actual installed compiler/loader components, keeping
the existing separation between program and binding recipe inputs. Relevant
context changes must invalidate the affected parts. One intentional initial
compiler-identity transition is expected. Existing packs retain their original
bytes and must be refused when incompatible; rebuild through the checked builder.
No scene, rules, presentation, protocol or pack wire-format change is introduced
solely for this correction.

## Compatibility and preservation

Keep the qualified M13 worktrees, compiler identities, packs, WASM, previews and
all original checkouts intact. Preserve current M14 source edits and failing
native feasibility evidence. The action/state persistent-identity collision is a
separate M14 issue and must not be hidden by loader refactoring.

Use isolated correction worktrees and explicit `develop` bases, with ancestry
receipts for the qualified prerequisite changes. Do not reset or move the original
checkouts. Reuse Model/build-support 9ebf0d1 and Text 4247679 as the qualified
behavioral baseline; review and record how the correction is carried onto the
selected development ancestry before changing pins.

Land local immutable commits in dependency order: Model build support, paired
Text/loader, Views, KerML, then Mercurio integration. Update each affected
maintained standalone manifest and lock with one runtime identity. Use no
committed mutable sibling path override. Keep the corrective commit identifiable
apart from M14 feature implementation. No push, merge, publication, release,
installer or companion-server modification is included.

## Required qualification

| ID | Required evidence |
| --- | --- |
| L01 | Scoped fingerprint fixtures: view-only source and unrelated pin/lock changes preserve keys; owning source/embedded bytes, relevant dependency source/version/features and target changes invalidate the applicable key. |
| L02 | Context fixtures: stale/missing context and ambiguous resolution fail closed; relocation, ordering and native/WASM preparation remain deterministic. |
| L03 | Headless `cargo tree` and metadata for `intersect-kerml` have no Views crates in normal/build closure; IDE and browser retain their explicit graphical integration. |
| L04 | Real model fixtures preserve successful outputs and parse/link/completion/validation diagnostics, including resource, phase, severity, code, object, rule, feature and exact source ranges. Include clean input, unresolved names, invalid structure, language-rule errors/warnings and multi-resource loading. |
| L05 | Existing host edit preparation, candidate isolation, commit/abort, stale-revision and source-receipt checks pass through the extracted loader. No second orchestration remains. |
| L06 | Checked pack build/reload and compatibility tests pass natively and in actual WASM; old incompatible packs refuse without rewriting their bytes. |
| L07 | Integration mutation proof changes actual view-host source and its immutable consumer pin, then compares compiler component maps/program-part keys and reuses the compatible pack. A loader/compiler mutation changes the relevant key and rejects that pack. Restore fixture edits afterwards. |
| L08 | Formatting, strict lint, quick tests and WASM library checks for affected crates; all maintained locks checked for one Model/Text/loader identity; actual consumer smoke test and preserved-preview checks. |

Run Rust tests through the repositories' report runner. Full library/pack and
equivalence runs are milestone-only and must be awaited. Record exact commits,
commands, outcomes, artifact hashes and any limits. Neither extraction alone nor
a fabricated compiler-map test completes this correction.

After L01-L08 pass, resume the approved M14 gates: qualify persistent identity for
synthetic versus authored declarations, source-derived action/state projections,
generic routing and branching, bends, collapsed endpoints and bound movable
labels. M14 remains incomplete until its own complete acceptance contract passes.
