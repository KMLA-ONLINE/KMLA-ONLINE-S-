import { cp, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("node_modules/@twemoji/svg");
const destination = resolve("public/twemoji/15.0.0");

await mkdir(destination, { recursive: true });
const files = (await readdir(source)).filter((file) => file.endsWith(".svg"));
await Promise.all(
  files.map((file) => cp(resolve(source, file), resolve(destination, file))),
);
console.log(`[twemoji] copied ${files.length} SVG files`);
