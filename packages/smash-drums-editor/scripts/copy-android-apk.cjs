/**
 * Copy the debug APK to release/apk/ with a friendly name for sharing.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = path.join(
  root,
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk"
);
const outDir = path.join(root, "release", "apk");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version || "0.0.0";
// Single friendly APK name for non-tech distribution (one file, no folder).
const dest = path.join(outDir, `Smash-Drums-Editor-${version}.apk`);

if (!fs.existsSync(src)) {
  console.error("APK not found. Run: npm run android:apk");
  console.error("Expected:", src);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log("Copied APK ->", dest);
console.log("Size:", (fs.statSync(dest).size / (1024 * 1024)).toFixed(1), "MB");
