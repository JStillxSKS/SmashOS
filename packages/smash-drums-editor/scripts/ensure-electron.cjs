const { downloadArtifact } = require("@electron/get");
const { execFileSync } = require("node:child_process");
const extract = require("extract-zip");
const fs = require("node:fs");
const path = require("node:path");

const electronDir = path.join(__dirname, "..", "node_modules", "electron");
const distDir = path.join(electronDir, "dist");
const pathFile = path.join(electronDir, "path.txt");
const { version } = require(path.join(electronDir, "package.json"));

const platformPath = process.platform === "win32" ? "electron.exe" : "electron";

function isInstalled() {
  try {
    const installedVersion = fs
      .readFileSync(path.join(distDir, "version"), "utf8")
      .replace(/^v/, "")
      .trim();
    const installedPath = fs.readFileSync(pathFile, "utf8").trim();
    return (
      installedVersion === version &&
      installedPath === platformPath &&
      fs.existsSync(path.join(distDir, platformPath))
    );
  } catch {
    return false;
  }
}

async function extractElectronZip(zipPath) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  if (process.platform === "win32") {
    const psZip = zipPath.replace(/'/g, "''");
    const psDest = path.resolve(distDir).replace(/'/g, "''");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${psZip}' -DestinationPath '${psDest}' -Force`,
      ],
      { stdio: "inherit" }
    );
    return;
  }

  await extract(zipPath, { dir: path.resolve(distDir) });
}

async function main() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD || isInstalled()) return;

  const zipPath = await downloadArtifact({
    version,
    artifactName: "electron",
    platform: process.env.npm_config_platform || process.platform,
    arch: process.env.npm_config_arch || process.arch,
  });

  await extractElectronZip(zipPath);
  fs.writeFileSync(pathFile, platformPath);
  fs.writeFileSync(path.join(distDir, "version"), `v${version}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});