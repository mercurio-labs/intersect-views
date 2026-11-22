// Build glue only. The checked fingerprint/preparation implementation is owned
// by the installed, immutable Model build-support package.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

export function compilerBuild(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const metadata = spawnSync("cargo", ["metadata", "--format-version", "1", "--locked", "--offline"], {
    cwd, env: options.env ?? process.env, encoding: "utf8", windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (metadata.error) throw metadata.error;
  if (metadata.status !== 0) throw new Error(metadata.stderr);
  const support = JSON.parse(metadata.stdout).packages.filter(
    (p) => p.name === "intersect-build-support" && p.source?.startsWith("git+"),
  );
  if (support.length !== 1) throw new Error("Expected one pinned Model build-support package");
  const implementation = resolve(dirname(support[0].manifest_path), "../../tools/compiler_build.py");
  const result = spawnSync(process.env.PYTHON ?? "python", ["-B", implementation, "--", ...args], {
    stdio: "inherit", ...options, cwd, windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}
