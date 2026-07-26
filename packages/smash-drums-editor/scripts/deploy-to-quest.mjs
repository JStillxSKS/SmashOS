/**
 * Deploy a single .indies map to a connected Meta Quest (Smash Drums).
 * Requires: Quest in Developer Mode, USB debugging on, `adb` on PATH.
 *
 * Usage:
 *   node scripts/deploy-to-quest.mjs [path/to/map.indies]
 *
 * For day-to-day installs on the headset (pull from Indies-DB without USB),
 * use Smash Indies (Desktop/SmashIndiesApp) sideloaded via SideQuest instead.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const DEFAULT_MAP =
  "C:/Users/JStillxSKS/Desktop/Smash Drums Editor/output/quest-deploy/Took Her To The O - Metal Cover.indies";

const INDIES_DIRS = [
  "/storage/emulated/0/Android/data/com.PotamWorks.SmashDrums/files/Indies",
  "/sdcard/Android/data/com.PotamWorks.SmashDrums/files/Indies",
];

const TOOK_HER_PATTERNS = [/took\s*her/i, /took.*\s*the\s*o/i];

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function adb(...args) {
  return run("adb", args);
}

function listIndiesFiles(dir) {
  const ls = adb("shell", `ls "${dir}" 2>/dev/null`);
  if (!ls.ok || !ls.stdout || ls.stdout.includes("No such file")) return [];
  return ls.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("No such file"));
}

function matchesTookHer(filename) {
  return TOOK_HER_PATTERNS.some((re) => re.test(filename));
}

const mapPath = path.resolve(process.argv[2] ?? DEFAULT_MAP);
if (!fs.existsSync(mapPath)) {
  console.error("Map not found:", mapPath);
  process.exit(1);
}

const devices = adb("devices");
if (!devices.ok) {
  console.error("adb not found. Install Android platform-tools and add adb to PATH.");
  process.exit(1);
}

const lines = devices.stdout.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("List"));
const online = lines.filter((l) => l.includes("\tdevice"));
if (online.length === 0) {
  console.error("No Quest/device connected.");
  console.error("Enable Developer Mode + USB debugging, plug in via USB, accept the prompt on headset.");
  console.error("\nPrepared map is ready at:");
  console.error(mapPath);
  process.exit(2);
}

console.log("Device:", online[0].split("\t")[0]);
console.log("Deploying:", path.basename(mapPath));

let indiesDir = null;
for (const dir of INDIES_DIRS) {
  const probe = adb("shell", `test -d "${dir}" && echo ok`);
  if (probe.stdout.includes("ok")) {
    indiesDir = dir;
    break;
  }
}

if (!indiesDir) {
  console.error("Smash Drums Indies folder not found on device.");
  console.error("Open Smash Drums on the Quest at least once, then retry.");
  process.exit(3);
}

console.log("Indies dir:", indiesDir);

const existing = listIndiesFiles(indiesDir);
const toRemove = existing.filter(matchesTookHer);
if (toRemove.length === 0) {
  console.log("No existing Took Her maps on Quest.");
} else {
  console.log("Removing from Quest:", toRemove.join(", "));
  for (const file of toRemove) {
    const rm = adb("shell", `rm -f "${indiesDir}/${file}"`);
    if (!rm.ok) console.warn("Could not remove:", file, rm.stderr);
  }
}

const remoteName = path.basename(mapPath);
const push = adb("push", mapPath, `${indiesDir}/${remoteName}`);
if (!push.ok) {
  console.error("adb push failed:", push.stderr || push.stdout);
  process.exit(4);
}

console.log("Pushed:", remoteName);
console.log("Done. Launch Smash Drums and check Custom / Indies for the map.");