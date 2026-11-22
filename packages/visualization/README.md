# Intersect Views browser client

Render a checked scene in a browser and connect its symbols to model source.
The client manages interaction and presentation. The language host builds the
scene, validates commands, and adopts source edits through a checked transaction.

Start with the [Views playground and setup guide](../../README.md#try-the-playground).
The private Git package exports TypeScript source for a browser bundler such
as Vite. Use a bundler that transpiles the dependency, its CSS and the layout
worker when embedding the client.

| Package entry point | API |
| --- | --- |
| `@intersect/visualization` | [Scene and presentation types, bindings and validators](src/protocol.ts) |
| `@intersect/visualization/session` | [ViewSession, host transport and editable buffer adapter](src/session.ts) |
| `@intersect/visualization/view-canvas` | [ViewCanvas for graph, grid and lane views](src/view-canvas.ts) |
| `@intersect/visualization/wasm-worker` | [WASM request transport](src/wasm-worker.ts) |

Use a `ViewSession` to associate revisioned host responses with the current
buffers and presentation. Mount a `ViewCanvas` in the app and forward its
source navigation, view selection and command callbacks to the session and
editor. The [harness browser app](../../harness/web/) shows the full setup. The
[Views architecture](../../docs/architecture.md) and
[Rust API entry points](../../README.md#embed-and-extend) describe the host side.

The current client consumes protocol v2, scene v7 and presentation v4. Load and
validate the saved presentation alongside its project. Layout changes, including
moving a part or placing a port on a border, are stored separately from model
source. The language host receives occurrence IDs for connection commands and
resolves them in their visible scope.

From the repository root, run `npm ci`, `npm run check` and `npm test`.
The [M14 playground](../../harness/web/m14.html) exercises routing and
source-bound labels. The Mercurio Workbench's General View browser test checks
gestures against the language host. See [provenance](PROVENANCE.json) for the
earlier Model client and migration history.
