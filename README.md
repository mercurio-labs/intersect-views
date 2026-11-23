# Intersect Views

Turn a checked model into an interactive diagram, table, matrix, or lane view.
People can follow a symbol back to its source, explore related elements, and
invoke edits the language package supports. The browser renders a versioned
scene and keeps layout and appearance in a separate presentation document.

This source release includes M14 routing and movable source-bound labels.
The playground and FMEA example demonstrate the generic engine. The
[M14 specification](docs/view-engine-m14-spec.md) describes the wire contract
and the SysML adapter's supported projection profiles.

## Try the playground

Use the pinned Rust toolchain with the `wasm32-unknown-unknown` target, Node
22.15 or newer, and Python 3.11 or newer. Run from the repository root after
installing those prerequisites. Set `PYTHON` to a Python 3.11+ executable
if the `python` command uses a different version.

```sh
rustup target add wasm32-unknown-unknown
cargo fetch --locked
npm ci
npm run build:harness
npm run dev
```

Open the URL printed by Vite with `/harness/web/` appended. The playground runs
in a WASM worker on loopback and needs no backend. For the independent FMEA
example, run `npm run build:fmea` and open `/languages/fmea/web/`. See the
[FMEA language guide](languages/fmea/README.md).

| Path | What to try |
| --- | --- |
| `/harness/web/` | Select an example and use **Capabilities** for the active example's walkthrough. Double-click a symbol to reveal its source. |
| `/harness/web/m12.html` | Switch between checked presentation packages with reusable graphics, ports, rich text, and typed slots. |
| `/harness/web/m14.html` | Try routing and bound-label placement in the M14 playground. |
| `/previews/m12/` | Review the earlier visual prototype. [Prototype notes](previews/m12/README.md) |

## Embed and extend

A language package supplies its definitions, projection rules, navigation
functions, and any source-edit providers. The generic host runs those rules
against a checked model and validates the proposed source changes. Applications
provide buffers, source navigation, transport, and storage for presentation
documents. See the [architecture](docs/architecture.md) and
[language-neutral host integration traits](crates/intersect-view-host/src/integration.rs).

| Surface | Start here |
| --- | --- |
| Rust contracts | Scene, binding, catalog, and command types in [intersect-views](crates/intersect-views/src/lib.rs). The [rules and document types](crates/intersect-views/src/documents.rs) describe inputs. |
| Rust engine | Deterministic evaluation through `ViewModel` and `ViewFunctions` in [intersect-view-engine](crates/intersect-view-engine/src/lib.rs). |
| Rust host | `Host`, `LanguageDefinition`, and the `Commands` provider in [intersect-view-host](crates/intersect-view-host/src/lib.rs). |
| TypeScript | The [ViewSession](packages/visualization/src/session.ts), [ViewCanvas](packages/visualization/src/view-canvas.ts), and [wire types and validators](packages/visualization/src/protocol.ts) are exposed through the [package exports](package.json). |
| Working implementation | Follow the [harness](harness/src/lib.rs) or an authored [FMEA view](languages/fmea/README.md) from model source to scene. |

Generate the contracts and engine API reference with rustdoc.

```sh
cargo doc --locked --offline --no-deps -p intersect-views -p intersect-view-engine
python -B tools/compiler_build.py -- doc --locked --offline --no-deps -p intersect-view-host
```

Open `target/doc/intersect_views/index.html` or
`target/doc/intersect_view_engine/index.html`. If you set `CARGO_TARGET_DIR`,
look in its `doc/` directory. The wrapper generates the host reference at
`target/doc/intersect_view_host/index.html` with a fresh loader build context.

### Install the M14 SDK preview

The npm preview contains ESM JavaScript, TypeScript declarations, CSS, JSON
schemas and the graph layout worker. Build the tarball from a clean SDK checkout
with Node 22.15 or newer.

```sh
npm ci
npm pack
```

In a separate Vite application, install the resulting tarball and import the
shared surface. The Vite build resolves the packaged layout worker and styles.

```sh
npm install /path/to/intersect-visualization-0.1.0-m14.2.tgz
```

```ts
import { ViewCanvas } from "@intersect/visualization/view-canvas";
import { ViewSession } from "@intersect/visualization/session";
```

For the Vite development server, keep the SDK's worker import visible to
Vite and prebundle the CommonJS layout dependency. Add this to `vite.config.ts`.

```ts
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@intersect/visualization"],
    include: ["@intersect/visualization > elkjs/lib/elk.bundled.js"],
  },
});
```

Pass your application's source and editing callbacks to `ViewCanvas`, and your
language host and buffer adapter to `ViewSession`. The client accepts M14 scene
v7, rules v8, protocol v2 and presentation v4. It adds outline and sequence
layout strategies to the graph form. The language host and its WASM module are
built separately. Use the [FMEA example](languages/fmea/README.md) for adapter
registration and Mercurio's SysML examples for the read-only GridView,
BrowserView and SequenceView profiles.

For Rust embedding, use the immutable preview Git revision for
`intersect-views`, `intersect-view-engine` and `intersect-view-host`. Copy the
Model/Text git patches in [Cargo.toml](Cargo.toml) to the root of your Cargo
workspace when using the host, so the language and host share one set of
runtime types. Fetch the locked dependencies before invoking the compiler
build wrapper.

### Arrange graph views

Choose **Layered** to follow the view's direction, **Top to bottom** for a
vertical layered layout, or **Compact packing** to group symbols by size.
Edges are routed against the resulting geometry. The choice is kept per view
while the workspace is open. Sequence, outline, grid and lane views retain
their own layouts.

### Wire versions and saved layouts

M14 reads rule-set v8, emits scene v7, uses protocol v2, and saves presentation v5.
The initialization response advertises the scene and presentation versions
used by the Rust contracts.
Use the [scene schema](crates/intersect-views/graph.schema.json), [rule schema](crates/intersect-views/graph-rule-set.schema.json),
[routing schema](crates/intersect-views/routing.schema.json), and
[presentation schema](crates/intersect-views/presentation.schema.json) alongside
the code reference. Presentation v5 tracks layout, manual routes, and movable
bound labels by occurrence. Preview compatible v3 data through
[`previewPresentationV3`](packages/visualization/src/presentation-state.ts).
Export or reset older or incompatible layouts. The [v6-to-v7 rule preview tool](tools/migrate_rules_v7.mjs)
covers the older M13 transition. See the [M14 compatibility contract](docs/view-engine-m14-spec.md)
for the v8 changes.

## Playground walkthroughs

- **Structure.** Alpha and Beta inherit the same nested part, pins, fields, and
  link. The repeated parts have distinct occurrence IDs. Double-click a box in
  the tree, or click its **+**, to add a root. Right-click a node to explore its
  relations, hide or collapse it, or remove its seed. Use **Undo exploration**
  to undo the last scope operation.
- **Source editing.** In the structure example, pick **Box** or **Pin**, fill in
  its details, and drop or click on an eligible owner. Use **Link** to drag
  between eligible endpoints in the same owner occurrence. Applying a command
  validates the candidate model and shows any rejection. Use **Undo source** or
  **Redo source** to replay command-generated changes. Later manual typing can
  make a source history entry unavailable.
- **Nested regions.** Choose **Regions** or **Regions column**. Select a
  field's `low` or `high` part and press F2 to set an explicit value. The
  shared declaration updates both occurrences. Right-click a region header to
  collapse that occurrence. Member drags remain inside their region. Use a
  rectangle or rounded notation for a region-bearing box.
- **Trace grid.** Choose **Boxes**, **Traces**, **Derived traces**, or
  **Structure**. In **Traces**, select an empty cell to create a relation or
  choose a named relation in an occupied cell to delete it. Parallel traces
  retain individual bindings. Arrow keys and Home/End navigate the grid. Enter
  reveals source or opens the member picker, and Space selects.
- **Ordered lanes.** Choose the horizontal or vertical view and use **Place
  Step**. Select a lane, insertion gap, and optional span end. Apply orders all
  steps in that space as a total chain. Lane arrows reorder visual bands.
  Pan, zoom, and band order save as presentation. A source ordering cycle displays
  a view-constraint error and marks the last scene stale.
- **Notation and persistence.** Try `shapes.box.shape: "ellipse"` in the
  notation editor. **Save project** saves buffers, scope, and layout in browser
  storage. **Export project** downloads JSON. **Reset example** clears its saved
  local state.

## Verify changes

Use a Python 3.11+ executable for the compiler wrapper commands below.

```sh
cargo fmt --all --check
python -B tools/compiler_build.py -- clippy --workspace --all-targets --locked -- -D warnings
python -B tools/compiler_build.py --report -- test --profile test-fast --workspace --lib --tests --locked -- --skip timings_500_objects_and_5000_invocations
python -B tools/compiler_build.py -- check --workspace --lib --target wasm32-unknown-unknown --locked
npm run check
npm test
```

For browser checks, install Chromium with `npx playwright install chromium`
and build the relevant WASM harness first. Select the applicable test scripts
from [package.json](package.json). Run the timed M0 case separately on a quiet
machine with `RUST_TEST_THREADS=1`.

## Design and provenance

- [M0–M11 specification](docs/specifications/model-m0-m11/view-engine-spec.md)
- [M12 presentation contracts](docs/view-engine-m12-contracts.md)
- [M13 rendering selection](docs/view-engine-m13-spec.md)
- [Cross-language boundary](docs/decisions/0001-cross-language-models.md)
- [Renderer provenance](packages/visualization/PROVENANCE.json) and [license](LICENSE)

## Symbol properties

The shared canvas now has an opt-in Symbol inspector for exact node, port, edge
and logical bound-text occurrences. It provides typed appearance/text controls,
package/owner/local origins, mixed-selection eligibility, checked worker previews,
Apply/Cancel, scoped reset, independent style undo/redo, and manual/automatic sizing.
Read-only model dependencies may be styled; a read-only presentation store cannot
be saved. Styles never rewrite source or grant semantic command authority.

Run `npm run build:symbols` and open `/harness/web/symbols.html` to inspect the
actual WASM fixture with two inherited read-only occurrences, transformed ports
and captioned markers. It is also in the shared capability navigator.
`npm run test:symbols` exercises the actual browser and layout worker.

Presentation v5 retains M14 routes, logical label placements, positions and
viewport, adding bounded qualified style values. `previewPresentationV4` produces
a detached compatibility preview; v3 first uses `previewPresentationV3`. Original
files are never upgraded silently. A changed package needs an explicit reset until
a checked cross-package mapping exists. Language-specific display toggles and
project/global defaults remain separate work. See [the contract](docs/symbol-properties-spec.md).
