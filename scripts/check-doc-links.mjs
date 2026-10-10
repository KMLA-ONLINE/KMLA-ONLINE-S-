/** Check project Markdown links without fetching URLs or editing documents. */
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import remarkParse from "remark-parse";
import { unified } from "unified";

const root = path.resolve(
  process.argv[2] ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const files = globSync(
  [
    "docs/**/*.md",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "supabase/*.md",
    "app/**/AGENTS.md",
  ],
  { cwd: root },
).sort();
const parser = unified().use(remarkParse);
const documents = new Map();

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function text(node) {
  return node.value ?? node.alt ?? (node.children ?? []).map(text).join("");
}

function document(file) {
  if (documents.has(file)) return documents.get(file);
  const tree = parser.parse(readFileSync(file, "utf8"));
  const anchors = new Set();
  const definitions = new Map();
  const links = [];
  walk(tree, (node) => {
    if (node.type === "heading") {
      // GitHub-style heading IDs: rendered text, punctuation removed, spaces replaced,
      // and duplicate IDs suffixed. Keep Korean, combining marks, underscores and hyphens.
      const base = text(node)
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, "")
        .replaceAll(" ", "-");
      let anchor = base;
      let suffix = 0;
      while (anchors.has(anchor)) anchor = `${base}-${++suffix}`;
      anchors.add(anchor);
    }
    if (node.type === "definition") definitions.set(node.identifier, node.url);
    if (
      ["link", "image", "linkReference", "imageReference"].includes(node.type)
    ) {
      links.push(node);
    }
  });
  const parsed = { anchors, definitions, links };
  documents.set(file, parsed);
  return parsed;
}

const errors = [];
let checked = 0;
for (const relative of files) {
  const file = path.join(root, relative);
  const parsed = document(file);
  for (const link of parsed.links) {
    const url = link.url ?? parsed.definitions.get(link.identifier);
    if (!url || /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//")) {
      continue;
    }
    checked++;
    const report = (message) =>
      errors.push(
        `${relative}:${link.position.start.line}: ${message} — ${url}`,
      );
    const hash = url.indexOf("#");
    const target = hash === -1 ? url : url.slice(0, hash);
    let pathname;
    let anchor;
    try {
      pathname = decodeURIComponent(target.split("?")[0]);
      anchor = hash === -1 ? "" : decodeURIComponent(url.slice(hash + 1));
    } catch {
      report("invalid URL encoding");
      continue;
    }
    const destination = pathname
      ? path.resolve(
          pathname.startsWith("/") ? root : path.dirname(file),
          pathname.replace(/^\//, ""),
        )
      : file;
    const fromRoot = path.relative(root, destination);
    if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`)) {
      report("target is outside the repository");
    } else if (!existsSync(destination)) {
      report("missing target");
    } else if (
      anchor &&
      path.extname(destination).toLowerCase() === ".md" &&
      statSync(destination).isFile() &&
      !document(destination).anchors.has(anchor)
    ) {
      report("missing heading anchor");
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.error(
    `  docs: ${files.length} documents · ${checked} local links match`,
  );
}
