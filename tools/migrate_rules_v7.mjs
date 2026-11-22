// Explicit preview/write adapter; all rule validation stays in the shared contract.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { migrateRulesV6 } from "../packages/visualization/src/rendering.ts";
const [source, ...rest] = process.argv.slice(2);
if (!source || (rest.length && (rest.length !== 2 || rest[0] !== "--output"))) {
  console.error("Usage: node --experimental-strip-types tools/migrate_rules_v7.mjs SOURCE [--output NEW_FILE]");
  process.exit(2);
}
try {
  const bytes = readFileSync(source);
  const candidate = migrateRulesV6(JSON.parse(bytes.toString("utf8")));
  if (rest.length) writeFileSync(rest[1], JSON.stringify(candidate, null, 2) + "\n", { flag: "wx" });
  else console.log(JSON.stringify({ originalSha256: createHash("sha256").update(bytes).digest("hex"), candidate }, null, 2));
} catch (error) { console.error(String(error)); process.exitCode = 1; }
