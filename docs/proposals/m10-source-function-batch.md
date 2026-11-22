# M10 source-function batch construction proposal

Status: explicitly approved by the user on 2026-11-17, including the paired
local Text pin update. Implementation and qualification are in progress.

## Observed problem

The actual SysML navigation module takes about 12 seconds to compile one
selected function with SourceModelFunction::from_prepared. The generic host
compiles every referenced function once, but does so separately. A subsequent
instrumented fixture measured load_pack at 314.679 seconds and source analysis
at 1.101 seconds (20261117-191731). Mercurio's worker timeout is 120 seconds.
No timeout has been raised to mask this.

Model already exposes compile_functions_with_source_limits and
compile_functions_with_schema_stores. They compile several entries of a source
with shared lowering preparation and independent verification. Their results
cannot be attached to SourceModelFunction through its current public API.
The wrapper has private fields; the shared invocation runtime is crate-private.
No private-field construction, duplicate interpreter or schema substitution is
proposed.

## Proposed public API

Add SourceModelFunction::from_prepared_many, with the existing constructor's
arguments except a slice of EntrySelection instead of one selection. Return a
Vec<SourceModelFunction> in the original selection order. An equivalent
from_rcore_many may share the same implementation.

Preflight the original and supplemental bundles, source kinds, URI uniqueness
and entry counts before allocation. Group entries by exact SourceId and use the
existing public batch lowering implementation for each group. Check every
verified image with the existing signature and exact retained-schema checks.
Share the immutable retained definition bundle through Arc; never copy model
objects or manufacture checked authorities. Keep the single-entry constructors
source-compatible and preserve runtime construction refusal.

The generic host can resolve all names first, invoke the batch constructor, then
perform its existing receiver/result/effect/rule checks before publishing the
cache. No request selects executable source or execution limits.

Qualify single/batch parity, ordering across source groups, malformed/foreign
sources and signatures, failed-batch atomicity and runtime refusal of new.
Re-run the original M0 timing gate, real SysML fixtures and both actual-WASM
Mercurio browser suites. An API addition alone does not qualify M10.

## Dependency constraint requiring a decision

Views pins Text 3d026308b87a40d6a9548f1307c694558cbbaa30. That Text revision
itself Git-pins Model 9f026067f71721909ea508177127fccf5e7efd44. A new Model
runtime revision therefore needs a deliberate paired pin update. KerML's
AGENTS.md forbids a committed local patch or default sibling checkout. M10
explicitly authorizes Model, KerML and Mercurio changes; it does not explicitly
authorize Text changes; the user subsequently approved that paired update. The original session also requires stopping on a
Text/Model pin conflict.

Do not silently add an override, mix runtime identities, or change Text. The user explicitly approved the paired local Text pin and maintained-lock
update on 2026-11-17. Final immutable local revisions must still be recorded
and requalified before this API is a reproducible consumer dependency. All branches, commits and artifacts stay
local; there is no push, remote creation or publication.

## Separate runtime storage result

The default 16 MiB execution-storage limit rejects viewKind on the actual
fixture. The existing public limit set to 64 MiB returns interconnection in
22 ms. The language registration now explicitly selects that bounded storage
profile. SysML explicitly selects an 8,000,000-unit aggregate work profile;
harness/FMEA retain the 2,000,000-unit default. This result
needs no Model API change and does not solve compilation startup. A subsequent
full-catalog check reached viewProblem and still exhausted 64 MiB; independent
admissibility predicates are being qualified. The 64 MiB profile is currently
proven only for the explicitly tested functions, not complete SysML rendering.
