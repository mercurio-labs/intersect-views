# Decision 0001: cross-language models

Status: accepted for this implementation profile on 2026-11-17. Required by M11
of Model's view-engine-spec.md. This records a boundary and future direction;
it does not add cross-language execution, which the governing plan excludes.

## Decision

Each running Host owns one prepared LanguageDefinition, accepted frozen model,
initialized function store, source revision, command provider and pending edit.
A project is served by that language's host. The browser FMEA package and engine
harness use separate workers/hosts and do not combine their catalogs, bindings,
ElementIds, scope, revisions, caches or transaction tokens. Application routing
uses the selected language and initialize.fileExtensions, not guesses from a
label or opaque element key.

Non-language extensions remain project documents, as the existing host protocol
requires. Their presence in an analysis receipt does not mean they were parsed,
linked, consumed as semantics or validated. FMEA's grammar has no foreign-model
reference syntax. No new cross-language reference is admitted by this milestone.
A mixed folder therefore needs explicit application routing or a future composed
language; a clean FMEA analysis only qualifies its `.fmea` sources.

If models need semantic references across languages, the proposed direction is
an explicitly composed prepared language/schema and one accepted ModelRead over
all participating model sources. Preparation must resolve namespace/schema
versions, reference scopes, semantic delegates, resource access/editability and
which provider owns each command. Functions and bindings must see the same
snapshot; candidate analysis must validate the whole affected model and publish
one complete buffer receipt. That design needs its own specification and tests.
A shared multi-language registry and composite project syntax remain deferred.

## Why

Current SourceModelFunction invocation operates on one initialized store and
QueryBudget. Scene identities/bindings are interpreted against that accepted
snapshot. Opaque ElementIds and tokens have no cross-host meaning. Joining two
JSON scenes or catalogs cannot establish cross-model resolution or transaction
atomicity. Separate independent stores do not supply a combined ModelRead to
semantic functions. Federation would require new lookup, identity, revision and
transaction contracts; it is not an invisible extension of the current protocol.

The consumer experiments need no such extension: FMEA owns its domain and uses
existing graph/grid rules, Rcore functions, native QueryPlan, the generic host
and language-owned commands. No core dispatch arm recognizes `fmea` or harness
classes. Explicitly keeping these hosts separate gives a real second language
without claiming shared-model semantics that have not been implemented.

## Executed evidence and consequences

- FMEA registration, source loading, source bindings, graph and two native query
  tables execute through dispatch. The Rust dependency tree contains no harness,
  Examples or KerML package. The same language runs through its own WASM exports.
- A native test includes a foreign `.harness` file as a retained document; FMEA
  semantics stay unchanged and an unknown foreign view is refused. This proves
  document retention, not foreign parsing/linking or language interoperability.
- WorkerHost tests correlate simultaneous replies in two isolated workers with
  overlapping request numbers, and cover teardown, errors and late replies.
  Browser tests use the real FMEA worker and the separate real harness worker.
- No durable rename/move identity, cross-language reference, merged catalog or
  multi-host source transaction is claimed. A future combined model must prove
  those capabilities rather than treating this decision as their implementation.

Qualification commands and pinned revisions are in evidence/m11.md. Revisit this
decision when an actual cross-language model and its ownership/transaction
requirements are authorized, not by adding ad-hoc foreign lookups to a view rule.
