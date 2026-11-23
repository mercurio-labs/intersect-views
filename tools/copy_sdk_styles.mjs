import { copyFile, readdir } from "node:fs/promises";

const source = new URL("../packages/visualization/src/", import.meta.url);
const output = new URL("../dist/", import.meta.url);
const styles = (await readdir(source)).filter((name) => name.endsWith(".css"));
await Promise.all(
  styles.map((name) => copyFile(new URL(name, source), new URL(name, output))),
);
