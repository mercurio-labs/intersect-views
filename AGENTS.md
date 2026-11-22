# Intersect Views contributor guidance

Read README.md and docs/architecture.md before changing source. Base new
feature work on develop and preserve immutable pins used by downstream projects.

- Keep the dependency direction from application and language adapters to Views,
  Text and Model. Keep language-specific rules and source edits in their adapters.
- Keep the Rust libraries compatible with wasm32-unknown-unknown. Put filesystem,
  browser storage and worker transport behind application adapters.
- Apply source edits through the checked transaction host. Keep scene publication
  and source revision checks deterministic.
- Run the applicable formatting, lint, quick tests and WASM checks in README.md.
  Route native tests through tools/test_report.py. Run timing and full integration
  suites as milestone checks. Record the commands, results and supported scope.
