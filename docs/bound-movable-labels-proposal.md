# Bound, movable text labels

Requested by the user on 2026-11-18. Design proposal; the interaction is not yet
implemented or included in M12 completion claims.

A label remains bound to the same semantic occurrence and logical text part while
its placement can be adjusted independently of its owner. Moving a label changes
presentation only. Source reveal, selection and any authorized editing continue
to use the host-validated binding. Decorations have no invented source target.

Store an offset in the owner's local coordinates, keyed by occurrence, graphical
reuse path and logical label/block identity, with package/projection compatibility.
Do not key it by text, fragment index, source line or screen coordinates. Move a
whole logical block, not one wrapping fragment; reflow regenerates fragments under
the same placement. A symbol move, resize, rotation or port rearrangement carries
its anchored label. Label movement must not move a port or alter an edge endpoint.

A dedicated label-move mode or modifier distinguishes presentation movement from
symbol dragging, text selection and semantic source edits. Keyboard movement,
visible focus, reset-to-authored-position and save/reload are required. Long text
remains inspectable and is not silently clipped. A moved label participates in
fit/extents and hit testing. A leader line is optional authored presentation.

Node and port labels can use stable local owner anchors. Edge labels additionally
need a reviewed route anchor policy (segment/tangent or normalized path distance),
including behavior after rerouting and collapse; this connects to the M14 route
contract rather than choosing the nearest screen point. Unsupported or changed
anchors require an explicit reset/compatibility diagnostic.

Acceptance cases: repeated inherited labels move independently with unchanged
source/semantic IDs; wrapped paragraphs remain bound after resize; rotated ports
retain wire attachment; offsets survive save/reload; reset restores authored
placement; stale package/projection layouts are refused; label movement during a
pending source command cannot authorize or redirect that command. Test real WASM
bindings, keyboard/pointer behavior, transformed hit rectangles and owner/edge
movement. Review the saved-layout version and exact placement contract before
implementation.

The proposed [Symbol properties inspector](symbol-properties-spec.md) exposes the
label placement/reset controls through the same per-occurrence presentation model.
