// Runs `slu.exe resource <action> widget <abs path>`. The CLI forwards the path
// to the running Seelen process, which resolves relative paths against its own
// working directory, so the path must be absolute.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2];
if (!["load", "unload", "bundle"].includes(action)) {
  console.error("usage: node scripts/slu.mjs <load|unload|bundle>");
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const widgetDir = join(root, "widget");
const result = spawnSync("slu.exe", ["resource", action, "widget", widgetDir], { stdio: "inherit" });
if (result.error) {
  console.error(`could not run slu.exe (is Seelen UI installed?): ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0 || action !== "bundle") process.exit(result.status ?? 1);

// Seelen writes `widget/bundle <timestamp>.yml`; move the newest one to dist/ so it
// is not shipped inside the widget folder, and drop the local path Seelen records.
const bundles = readdirSync(widgetDir)
  .filter((n) => /^bundle .*\.ya?ml$/i.test(n))
  .map((n) => join(widgetDir, n))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
if (!bundles.length) {
  console.error("slu.exe reported success but no bundle file was found in widget/");
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const text = readFileSync(bundles[0], "utf8").replace(/^( {2}path: ).*$/m, "$1''");
mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, "dist", `uranus92-gcal-agenda-store-v${version}.yml`);
writeFileSync(out, text);
for (const b of bundles) rmSync(b);
console.log(`store bundle: ${out}`);
