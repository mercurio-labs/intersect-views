import { compilerBuild } from "./compiler_build.mjs";
import { resolve } from "node:path";
import { mkdir, copyFile } from "node:fs/promises";
const result = compilerBuild(
  [
    "build",
    "-p",
    "intersect-fmea",
    "--lib",
    "--target",
    "wasm32-unknown-unknown",
    "--profile",
    "test-fast",
    "--locked",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir("harness/web/public", { recursive: true });
await copyFile(
  resolve(process.env.CARGO_TARGET_DIR ?? "target", "wasm32-unknown-unknown/test-fast/intersect_fmea.wasm"),
  "harness/web/public/fmea.wasm",
);
console.log(
  "Built harness/web/public/fmea.wasm. Run npm run dev, then open /languages/fmea/web/.",
);
