# Harness language

An M1 fixture language, not a language for users. See `models/structure.harness`
for kinds, typed/nested boxes, pins, fields and links. End syntax is
`s (part Child pin p)`; either reference may be omitted to exercise validation.
Field values use the existing Int32 runtime representation of integer values.
The M0 `peer` reference remains supported for the original feasibility fixture.

`navigation.rcore` is the single implementation of effective (own, then kind)
members. Both bindings and view functions import it. View functions cover every
slot of the specification's structure example. Rust edit commands belong to M6.

The two-reference End form works. The fixture has Local.outgoing and
Mirror.outgoing; its ends resolve the same spelling to different pins using
End.part. Scoping prefers the contextual pin. When absent, a unique visible
candidate is retained so ownership mistakes produce a located `harness.end.owner`
validation issue. This does not choose among ambiguous fallback candidates.
The spec's single-reference fallback is not used.

The four validation codes are `harness.link.ends`, `harness.end.target`,
`harness.end.owner`, and `harness.names.unique`. Each has an invalid source
fixture and an assertion for one issue with the expected object, resource and
nonempty source span, severity, feature and code. Host UTF-16 diagnostics remain
M2 work; these tests inspect frozen-model issue locations directly.

`views/structure.viewrules.json`, its palette/notation, and the project view
document are data fixtures. No engine or host interprets them in M1.
