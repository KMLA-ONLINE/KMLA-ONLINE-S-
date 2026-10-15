// Links each `.agents/skills/<name>` into `.claude/skills/<name>` so Claude Code
// discovers project skills. Runs from `prepare` (npm install/ci). Windows uses
// directory junctions, which need neither admin rights nor Developer Mode.
// Never fails the install: problems are reported as warnings.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(root, ".agents", "skills");
const linkDir = path.join(root, ".claude", "skills");
const isWindows = process.platform === "win32";

function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function resolvesTo(link, target) {
  try {
    return fs.realpathSync(link) === fs.realpathSync(target);
  } catch {
    return false;
  }
}

const skills = fs
  .readdirSync(sourceDir, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() &&
      fs.existsSync(path.join(sourceDir, d.name, "SKILL.md")),
  )
  .map((d) => d.name);

fs.mkdirSync(linkDir, { recursive: true });

// Drop links whose skill no longer exists. Real directories are left alone.
for (const name of fs.readdirSync(linkDir)) {
  const link = path.join(linkDir, name);
  const stat = lstat(link);
  if (stat?.isSymbolicLink() && !skills.includes(name)) fs.rmSync(link);
}

for (const name of skills) {
  const target = path.join(sourceDir, name);
  const link = path.join(linkDir, name);
  const stat = lstat(link);
  try {
    if (stat?.isSymbolicLink() && resolvesTo(link, target)) continue;
    if (stat?.isDirectory() && !stat.isSymbolicLink()) {
      console.warn(
        `link-skills: skipped ${name}: .claude/skills/${name} is a real directory`,
      );
      continue;
    }
    // Stale link or a text placeholder from a checkout without symlink support.
    if (stat) fs.rmSync(link);
    if (isWindows) fs.symlinkSync(target, link, "junction");
    else fs.symlinkSync(path.relative(linkDir, target), link, "dir");
  } catch (error) {
    console.warn(`link-skills: could not link ${name}: ${error.message}`);
  }
}
