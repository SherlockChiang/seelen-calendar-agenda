// Runs `slu.exe resource <action> widget <abs path>`. The CLI forwards the path
// to the running Seelen process, which resolves relative paths against its own
// working directory, so the path must be absolute.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const action = process.argv[2];
if (!["load", "unload", "bundle"].includes(action)) {
  console.error("usage: node scripts/slu.mjs <load|unload|bundle>");
  process.exit(2);
}

const widgetDir = fileURLToPath(new URL("../widget", import.meta.url));
const result = spawnSync("slu.exe", ["resource", action, "widget", widgetDir], { stdio: "inherit" });
if (result.error) {
  console.error(`could not run slu.exe (is Seelen UI installed?): ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
