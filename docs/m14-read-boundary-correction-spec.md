# M14 stored-read preparation correction

Status: explicitly approved by the user on 2026-11-19; implementation and
qualification in progress. M14 and Symbol properties remain incomplete. The
qualified loader correction remains unchanged.

## Observed failure and required result

The real M14 fixture loads cleanly, with 38/38 references resolved. Its `pipeline`
has thirteen actual owned features: seven successions, fork/join, three actions
and one flow. Enumerating those features and filtering their stored `isAbstract`
values both pass. The effective-feature query, which additionally collects and
transitively hides redefined features, fails with `Retained model storage limit
exceeded` at the existing 64 MiB limit. The complete actual-model evidence is in
[the failure receipt](qualification.md).

Retained experiments include one shared redefinition traversal, direct reads of
the actual owned redefinition relationships, and direct owning-membership reads.
The direct redefinition query passes in isolation; its combination with concrete
feature filtering still fails. These experiments qualify no behavior scene.
They do not prove that a larger allowance is necessary or acceptable.

Source inspection identifies repeated effective-member preparation in Model's
`SourceModelReads::singular` and `page`: every scalar or collection-page read calls
`observed_member`, which prepares all effective features of the receiver class.
The VM authority separately caches its own checked member resolution. Repeated
preparation is the leading cause to verify with bounded allocation/work receipts;
the failure itself, rather than an allocation attribution, is currently proven.

The subsequent native profiler (`kerml/20261118-234404`) forwards each actual
stored read through its original VM observation. Candidate enumeration performs
95 reads charging 33,593,099 bytes; concrete filtering performs 108 reads charging
42,142,412 bytes. The redefinition/effective queries fail after 129 reads charging
55,916,734 bytes in this adapter alone; other VM operations also count toward
the unchanged 67,108,864-byte limit. The same ActionDefinition collection member
is read 45 times, charging 20,826,243 bytes, with individual charges between
462,657 and 462,816 bytes. Original work/storage/control remain active.

These are actual delegated-read charges, including metadata preparation and value
output, rather than a separate measurement of metadata allocations. Diagnostic
bookkeeping is outside the VM, no timing result is claimed, and the profiler's
passing test means its observations completed, not that G2 passed. The exact
source hash, full event stream and grouped summary are retained in the receipt.

The result must be successful exact effective membership and endpoints for the
actual fixture within the original limits, with unchanged language decisions,
source/type authority, malformed-input rejection and cancellation. M14's broader
G2 gate still requires its full projections and multi-file cases afterward.

## Scope requiring approval

Permit an isolated internal Model runtime correction on the qualified
`ef2b43fdc0963270b2c729bca4a8078d3b107551` baseline, followed by Text's immutable
Model/build-support pin and maintained-lock updates from
`a4b66da578e655c83ef17d19ffaabcb37713de31`. No public API addition is planned.
If that proves insufficient, report the additional need before expanding it.

First profile the exact existing reader through its public observed read
interfaces. Reuse the existing checked effective-member preparation and retain
its successful resolution in an invocation-local, source/schema-bound cache.
Prefer the narrowest proven cache key, including receiver class and exact source
declaration. Charge retained cache metadata before allocation and charge every
lookup/guard to the original ledger. Keep the real stored-value read and its
source/revision/type checks on every observation. Do not cache object values,
failures, pending links or unavailable results, and do not share the cache across
mutations, independent invocations or schema owners.

Keep one semantic implementation. No copied reader in Views/KerML, alternative
VM, new allowance, numeric-quota increase, permissive fallback, source parser,
fake endpoint or unobserved fast path is included. All existing execution limits
remain unchanged. Do not reinterpret cumulative logical storage as peak memory.

Only after the internal correction is qualified, update the immutable paired
pins/locks in isolated Views/KerML/Mercurio consumers, regenerate checked build
contexts and rebuild the official pack/WASM artifacts. Preserve scoped compiler
identity: a Model runtime source change changes the program compiler identity;
view-host-only changes continue to leave headless language keys unchanged.

## Verification and preservation

1. Retain the current failing queries, exact source/pack/pin identities and
   allocation/work observations. Compare the same actual inputs after the fix.
2. Prove correct cache keying across inherited/redefined declarations and
   receiver classes; preserve rejection of foreign schema/source identity,
   invalid multiplicity, derived/volatile reads, malformed unique collections,
   unavailable/pending references and cancellation. Failed preparation publishes
   no cache entry. Existing quota failures remain terminal and observable.
3. Run applicable Model quick tests, formatting, strict all-target lint and WASM
   checks. Verify Text's paired pin/locks and applicable consumers with one
   runtime identity. No runtime correction to Text is included.
4. Rerun the exact real native M14 fixture and the M13 inheritance, redefinition,
   diamond and rendering regressions. Compare full bindings, contexts, ranges,
   endpoints and fingerprints with actual WASM. Do not turn diagnostics or raw
   stored-shape admission into a successful G2 result.
5. Rebuild and qualify the exact final checked pack/WASM and consumer artifacts;
   preserve the loader cache separation proof. Then resume the full approved
   M14 gates, followed by the approved generic Symbol properties slice.

Create new isolated correction worktrees/branches explicitly from develop, then
advance only those to the frozen prerequisites as recorded for the prior loader
correction. Preserve original checkouts, unrelated develop work, all current M14
working files and backup refs, all qualified artifacts and previews, and the
seventeen original Mercurio working files. Record immutable correction commits
and final consumer pins. Work remains local: no push, merge, public release,
installer or server change.

## Why this is a separate scope decision

The approved M14 specification says: "No Model/Text source or API change is
included. Stop and report a missing upstream capability before changing those
repositories." The active repository AGENTS.md likewise freezes Model/Text
runtime APIs/sources. The goal authorizes finishing M14 and Symbol properties,
but does not explicitly revoke that upstream boundary. This proposal requests
only the internal read-preparation correction and its required paired integration.
