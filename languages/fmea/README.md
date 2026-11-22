# FMEA language package

A small editable language for failure mode and effects analysis, built from the
Intersect harness template. It owns its metamodel, grammar, Rcore validation and
navigation, view rules, notation and Rust source commands. It has no harness,
KerML or Examples dependency. The generic engine/host/client own the shared
mechanics. The package is qualified against the shared M9 graph/grid/lane
contracts; its own views use graph and grid forms.

Run `npm run build:fmea` and `npm run dev` from the repository root, then open
http://127.0.0.1:5173/languages/fmea/web/. The existing playground links to it.
The browser runs the same host as WASM, without a backend. Source and saved
projects stay in local storage; Export project downloads a complete JSON receipt.

The [Pump example](models/pump.fmea) contains an Analysis, an Item with its
function, two FailureModes with effect/cause/current control, three ratings,
and corrective Actions with description/owner/status/evidence.

- Ratings are Int32 values from 1 through 10. The graph's RPN label computes
  severity × occurrence × detection in Rcore. This follows the conventional
  RPN calculation described by [ASQ](https://asq.org/quality-resources/articles/failure-mode-and-effect-analysis-fmea?id=191be3dc32e1431a81bdd867614ab2f3).
  The language does not encode a standard-specific ranking handbook or Action
  Priority table. The sample's severity >= 8 color is an explicit view rule.
- Item function, failure mode/effect/cause/control, and action description cannot
  be empty. Sibling names must be unique. A done Action requires owner and evidence.
- Choose Failure worksheet for native QueryPlan projections of failure text and
  ratings, or Action register for descriptions/owners/status/evidence. The graph
  displays the computed RPN. Tables expose source bindings and copy/navigation;
  model edits use the graph's declared label commands.
- Select an RPN part and press F2, enter Severity/Occurrence/Detection and Apply.
  Select an Action status and press F2 to change Status (planned or done), Owner
  and Evidence. The host validates an isolated candidate before publication.
  Enter/double click reveals the exact declaration. Labels never drag nodes.
- Add items, failure modes and actions by editing the `.fmea` source, then Analyze
  source. Show all seeds all subjects appropriate to the current view. A tree +
  adds an individual subject. Clear scope and Undo exploration only affect scope.
- Undo source / Redo source reanalyze source edits. Later manual typing retains
  ownership if it races a commit. Save project saves every view's exploration;
  an intentionally empty saved scope stays empty after reload.

Current scenes/rules use the qualified v5 contracts and Presentation v2. Definitions use
namespace `urn:intersect:fmea:1` and extension `.fmea`. No pack or external
semantic library is required. Cross-language models follow the separate
[decision record](../../docs/decisions/0001-cross-language-models.md).

Validation from the repository root:

```powershell
$env:INTERSECT_TEST_REPORTS=Join-Path $PWD 'test-reports'
$env:PYTHONIOENCODING='utf-8'
python -B tools/test_report.py run -- --profile test-fast -p intersect-fmea --lib --tests --locked
cargo clippy -p intersect-fmea --all-targets --profile test-fast --locked -- -D warnings
cargo check -p intersect-fmea --lib --profile test-fast --target wasm32-unknown-unknown --locked
npm run check
npm test
npm run build:fmea
npm run test:fmea
```

Exact Model/Text pins are inherited from the workspace; no runtime changes or
additional query language are introduced. [Provenance](PROVENANCE.json) records
the template, adaptations and dependencies. Evidence is in docs/evidence/m11.md
at the repository root. These tests qualify this language profile and example,
not an organizational safety/rating process or a standard conformance claim.
