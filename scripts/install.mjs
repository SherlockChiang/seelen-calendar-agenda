// Installs the built widget into Seelen's user widgets folder so it survives
// Seelen restarts (`slu resource load` only lasts one session). Seelen watches
// that folder and reloads widgets when it changes.
//
//   node scripts/install.mjs            install or update
//   node scripts/install.mjs --remove   uninstall
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const appData = process.env.APPDATA;
if (!appData) {
  console.error("APPDATA is not set; this script only runs on Windows.");
  process.exit(1);
}

const seelenDir = join(appData, "com.seelen.seelen-ui");
const widgetsDir = join(seelenDir, "widgets");
const target = join(widgetsDir, "uranus92-gcal-agenda");

if (process.argv.includes("--remove")) {
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${target}`);
  process.exit(0);
}

if (!existsSync(seelenDir)) {
  console.error(`Seelen UI data folder not found: ${seelenDir}`);
  process.exit(1);
}

const source = fileURLToPath(new URL("../widget", import.meta.url));
if (!existsSync(join(source, "index.js"))) {
  console.error("widget/index.js is missing; run `npm run build` first.");
  process.exit(1);
}

// Stage next to the watched folder, then swap it in, so Seelen's watcher never
// sees a half-copied widget.
const staging = join(seelenDir, ".gcal-agenda-staging");
rmSync(staging, { recursive: true, force: true });
cpSync(source, staging, {
  recursive: true,
  // skip `slu resource bundle` output
  filter: (path) => !/\.yaml$/i.test(path),
});
mkdirSync(widgetsDir, { recursive: true });
rmSync(target, { recursive: true, force: true });
renameSync(staging, target);

// Seelen's watcher ignores directory events, so the rename alone is not noticed.
// Rewriting a file inside the now-complete folder triggers the widget reload.
const metadata = join(target, "metadata.yml");
writeFileSync(metadata, readFileSync(metadata));
console.log(`installed to ${target}`);
