# M12 symbol lab — visual prototype

Open `/previews/m12/` on the existing Vite dev server. For example:

```powershell
npm run dev -- --port 5175
```

Then visit http://127.0.0.1:5175/previews/m12/.

Try the three libraries, symbol width/documentation reflow, port rotation and
fixture-part selection. Edit a JSON composition and apply it to every reuse.
Invalid definitions/cycles are refused while retaining the accepted drawing.
Save layout retains the example, appearance, width, rotation and documentation
settings in browser local storage. Edited definitions are intentionally not saved.

The renderer interprets the same bounded vocabulary for every fixture library;
it has no SysML/electrical/fault dispatch. Fixtures and the vocabulary are review
material, not accepted M12 contracts. Fixture keys are illustrative, not parsed
source ranges. The production scene evaluator, Rust/TS validators, native/WASM
presentation loader, semantic generation and edit transactions are not exercised.
Existing harnesses retain their qualified production engine paths.

Run the isolated real-browser checks:

```powershell
node previews/m12/browser.test.mjs
```

The test owns an ephemeral Vite server and browser and closes both. Reports and
screenshots are written under ignored `target/m12-preview/`.
