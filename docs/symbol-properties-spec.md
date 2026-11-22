# Symbol properties — reviewed implementation contract

Status: implementation authorized by the user's explicit goal to finish M14 and
Symbol properties, 2026-11-18. This supersedes the earlier request to retain the
reviewed contract as a proposal. It follows qualified M14 and does not change
M12's completion criteria. The first slice remains per-occurrence appearance,
text and sizing with inheritance/reset/persistence; language-specific display
options remain a later integration slice. No SysML-specific checkbox is claimed
as supported by the generic harness.

## Result

Selecting a node, port, edge or bound text block exposes a **Symbol** inspector
alongside source inspection. It edits the selected occurrence's display, with
property groups, a search filter, current value, inherited value and origin.
Apply/Cancel previews a checked candidate; Reset selected removes local overrides.
A display edit never changes model text, declarations, semantic direction,
connection endpoints or command authority. Unsupported properties are absent or
explicitly disabled with a reason.

## First implementation slice

- Appearance: fill enabled/color, stroke color/width/dash and radius, where the
  selected definition declares an appropriate purely visual parameter.
- Text: color, bounded font size/weight/italic, alignment and wrapping. Font family
  initially remains the measured system font; arbitrary font names and web fonts
  need a separate loading/measurement contract.
- Size: authored minimum/preferred dimensions and the current allocated size;
  Auto size removes manual allocation and remeasures. Manual sizing cannot
  violate minimum content bounds or clip semantic content silently.
- Placement: show position/size and the separately proposed bound-label offsets;
  label dragging follows its reviewed anchoring/reflow contract.
- Reset: reset one property, the selected occurrence, or the view's local display
  overrides, with an explicit scope label. No implicit project-wide default change.

Use the existing data-only graphical parameters as the actual rendering inputs.
A definition adds typed property descriptors identifying an authored parameter,
label, group, description, default and editability. Bounded color/number/Bool/Choice
editors are generated from those descriptors. A descriptor cannot point to an
arbitrary JSON path, executable callback, model field or undeclared parameter.
Source-derived parameters that express semantic direction or domain state cannot
be overridden through this inspector. Definition authors opt in purely visual
parameters; the renderer does not infer editability from a parameter name.

## Inheritance and persistence

Effective values are resolved explicitly: qualified package defaults, then any
reviewed diagram style, then local occurrence overrides. Each control shows its
origin and allows removing the local override to restore inheritance. Applying
to multiple selections means the explicit selected occurrence IDs; mixed values
stay visible and ineligible properties are reported rather than silently skipped.
A later **Make diagram default** action must state its scope and affected symbols.
It never rewrites a shared package or global preferences silently.

Presentation v5 adds typed per-occurrence overrides after M14's v4 routing and
movable-label state, retaining those fields and the
package/projection fingerprint guard, positions, port fractions and viewport.
Keys combine stable occurrence and qualified authored property identity, never
label text or array position. Bound text styles use the logical block identity,
not reflow fragment IDs. Limits must cover property counts, bytes and evaluated
markup; malformed keys/types/out-of-range values reject atomically. Preserve v4
bytes and provide an explicit compatibility preview; v3 chains through M14's
reviewed migration. Do not silently upgrade.
Color-only package compatibility needs an explicit checked mapping, not an
assumption that equal names mean equal styles.

## Language-owned display properties

Show classifier, qualified names, multiplicity, stereotypes, constraints, slot
type, rake/callout and similar options are supplied by a language/presentation
package with their real typed content and display policy. The shared inspector
uses the same descriptor system and never checks SysML class names or parses a
label to invent missing content. These require a later language integration
slice beyond the reviewed generic Symbol inspector implementation.
Suppressing structure maps to qualified exploration/collapse behavior; it cannot
silently omit nonempty graphical child/region slots from a successful scene.
Fixed connection points additionally need the reviewed port/router constraint
contract. These are not cosmetic toggles that can be inferred from the screenshot.

## Transactions, failures and acceptance

Display changes have their own presentation undo group and preserve source undo.
Reflow/resize reruns measurement and attachment; a failed preview retains the
previous diagram, reports the offending property and commits no partial state.
Package replacement invalidates old descriptors, previews and stale selection.
The host recomputes source command targets independently of client overrides.
Read-only model content may still receive local display changes, but a read-only
presentation store cannot be saved; that distinction is visible in the inspector.

Qualify native/TS descriptor/type/bound parity, two repeated inherited symbols
with independent overrides and unchanged semantic IDs/source bytes, mixed-value
selection, inherited-origin/reset behavior, keyboard controls, transformed text
hit rectangles, port/marker attachments after reflow, presentation undo/redo,
save/reload and explicit v4 migration (plus the retained v3 chain). Prove candidate failures are atomic and
stale package selections cannot apply. Add an actual WASM/browser fixture before
claiming implementation. Existing graph/grid/lane/FMEA regressions remain gates.
